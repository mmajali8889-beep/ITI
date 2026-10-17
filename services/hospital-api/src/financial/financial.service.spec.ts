import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { FinancialService } from './financial.service';

describe('FinancialService', () => {
  const medplum = {
    readResource: jest.fn(), searchResources: jest.fn(), createResource: jest.fn(), updateResource: jest.fn(),
  };
  let service: FinancialService;
  const hospitalExtension = { url: 'https://hospital-ehr.local/fhir/StructureDefinition/financial-hospital', valueReference: { reference: 'Organization/hospital-a' } };
  const patient = { resourceType: 'Patient', id: 'patient-1', managingOrganization: { reference: 'Organization/hospital-a' }, name: [{ text: 'UAT Patient' }] };
  const coverage = { resourceType: 'Coverage', id: 'coverage-1', status: 'active', beneficiary: { reference: 'Patient/patient-1' }, payor: [{ reference: 'Organization/payer-1', display: 'UAT Payer' }], subscriberId: 'MEM-1', extension: [hospitalExtension] };
  const encounter = { resourceType: 'Encounter', id: 'encounter-1', status: 'in-progress', subject: { reference: 'Patient/patient-1' }, serviceProvider: { reference: 'Organization/hospital-a' } };

  beforeEach(() => {
    jest.resetAllMocks();
    medplum.searchResources.mockResolvedValue([]);
    medplum.createResource.mockImplementation(async (resource) => ({ ...resource, id: resource.resourceType === 'Coverage' ? 'coverage-1' : 'eligibility-1' }));
    medplum.updateResource.mockImplementation(async (resource) => resource);
    medplum.readResource.mockImplementation(async (type: string) => type === 'Patient' ? patient : type === 'Coverage' ? coverage : encounter);
    service = new FinancialService({ getClient: () => medplum } as never);
  });

  it('creates a hospital-scoped FHIR coverage for the patient', async () => {
    const result = await service.createCoverage({ hospitalId: 'hospital-a', patientId: 'patient-1', payerId: 'payer-1', payerName: 'UAT Payer', subscriberId: 'MEM-1', validFrom: '2026-01-01' });
    expect(result).toMatchObject({ id: 'coverage-1', hospitalId: 'hospital-a', patientId: 'patient-1', status: 'active' });
    expect(medplum.createResource).toHaveBeenCalledWith(expect.objectContaining({ resourceType: 'Coverage', beneficiary: { reference: 'Patient/patient-1', display: 'UAT Patient' } }));
  });

  it('rejects a patient outside the authenticated hospital boundary without disclosure', async () => {
    medplum.readResource.mockResolvedValueOnce({ ...patient, managingOrganization: { reference: 'Organization/hospital-b' } });
    await expect(service.createCoverage({ hospitalId: 'hospital-a', patientId: 'patient-1', payerId: 'payer-1', payerName: 'UAT Payer', subscriberId: 'MEM-1', validFrom: '2026-01-01' })).rejects.toThrow(NotFoundException);
  });

  it('blocks duplicate active payer membership', async () => {
    medplum.searchResources.mockResolvedValueOnce([coverage]);
    await expect(service.createCoverage({ hospitalId: 'hospital-a', patientId: 'patient-1', payerId: 'payer-1', payerName: 'UAT Payer', subscriberId: 'MEM-1', validFrom: '2026-01-01' })).rejects.toThrow(ConflictException);
  });

  it('creates an eligibility request only for active patient coverage', async () => {
    const result = await service.checkEligibility({ hospitalId: 'hospital-a', patientId: 'patient-1', coverageId: 'coverage-1', encounterId: 'encounter-1', serviceCodes: ['CONSULT'] });
    expect(result).toMatchObject({ hospitalId: 'hospital-a', patientId: 'patient-1', coverageId: 'coverage-1', status: 'active' });
    expect(medplum.createResource).toHaveBeenCalledWith(expect.objectContaining({ resourceType: 'CoverageEligibilityRequest', purpose: ['validation', 'benefits'] }));
  });

  it('requires benefit and network verification for an eligible decision', async () => {
    await expect(service.recordEligibilityDecision('eligibility-1', { hospitalId: 'hospital-a', eligibility: 'eligible' })).rejects.toThrow(BadRequestException);
  });

  it('stores network, deductible, co-pay and coverage percentage', async () => {
    const result = await service.createCoverage({ hospitalId: 'hospital-a', patientId: 'patient-1', payerId: 'payer-1', payerName: 'UAT Payer', subscriberId: 'MEM-2', validFrom: '2026-01-01', networkId: 'NET-A', deductibleAmount: 500, copayAmount: 25, coveragePercentage: 80, currency: 'SAR', preAuthorizationRequired: true });
    expect(result).toMatchObject({ networkId: 'NET-A', deductibleAmount: 500, copayAmount: 25, coveragePercentage: 80, currency: 'SAR', preAuthorizationRequired: true });
  });

  it('requires an active coverage for the insurance financial class', async () => {
    medplum.readResource.mockImplementation(async (type: string) => type === 'Encounter' ? encounter : type === 'Coverage' ? { ...coverage, status: 'cancelled' } : patient);
    await expect(service.assignFinancialClass('encounter-1', { hospitalId: 'hospital-a', patientId: 'patient-1', financialClass: 'insurance', coverageId: 'coverage-1' })).rejects.toThrow(BadRequestException);
  });

  it('assigns the cash financial class to the scoped encounter', async () => {
    await expect(service.assignFinancialClass('encounter-1', { hospitalId: 'hospital-a', patientId: 'patient-1', financialClass: 'cash' })).resolves.toMatchObject({ encounterId: 'encounter-1', financialClass: 'cash' });
    expect(medplum.updateResource).toHaveBeenCalledWith(expect.objectContaining({ extension: expect.arrayContaining([expect.objectContaining({ valueCode: 'cash' })]) }));
  });

  describe('financial clearance after classification', () => {
    const BASE = 'https://hospital-ehr.local/fhir/StructureDefinition';
    const withExtensions = (extension: Array<Record<string, unknown>>) => medplum.readResource.mockImplementation(async (type: string) => type === 'Patient' ? patient : type === 'Coverage' ? coverage : { ...encounter, extension });
    const insured = (clearance: string, coverageId = 'coverage-1') => [{ url: `${BASE}/encounter-financial-class`, valueCode: 'insurance' }, { url: `${BASE}/encounter-coverage`, valueReference: { reference: `Coverage/${coverageId}` } }, { url: `${BASE}/financial-clearance-status`, valueCode: clearance }];

    it('keeps an eligible decision when the encounter is re-classified with the same coverage', async () => {
      withExtensions(insured('cleared'));
      await expect(service.assignFinancialClass('encounter-1', { hospitalId: 'hospital-a', patientId: 'patient-1', financialClass: 'insurance', coverageId: 'coverage-1' })).resolves.toMatchObject({ financialClearanceStatus: 'cleared' });
    });

    it('requires eligibility again when the coverage changes', async () => {
      withExtensions(insured('cleared', 'coverage-old'));
      await expect(service.assignFinancialClass('encounter-1', { hospitalId: 'hospital-a', patientId: 'patient-1', financialClass: 'insurance', coverageId: 'coverage-1' })).resolves.toMatchObject({ financialClearanceStatus: 'pending-eligibility' });
    });

    it.each(['corporate', 'government'] as const)('clears a sponsored %s encounter without an eligibility flow', async (financialClass) => {
      withExtensions([{ url: `${BASE}/financial-clearance-status`, valueCode: 'pending-classification' }]);
      await expect(service.assignFinancialClass('encounter-1', { hospitalId: 'hospital-a', patientId: 'patient-1', financialClass, sponsorId: 'sponsor-1' })).resolves.toMatchObject({ financialClearanceStatus: 'cleared' });
    });

    it('never removes an emergency override', async () => {
      withExtensions([{ url: `${BASE}/financial-clearance-status`, valueCode: 'emergency-override' }]);
      await expect(service.assignFinancialClass('encounter-1', { hospitalId: 'hospital-a', patientId: 'patient-1', financialClass: 'insurance', coverageId: 'coverage-1' })).resolves.toMatchObject({ financialClearanceStatus: 'emergency-override' });
    });
  });
});
