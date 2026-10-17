import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ResultReviewsService } from './result-reviews.service';

describe('ResultReviewsService', () => {
  const medplum = { readResource: jest.fn(), searchResources: jest.fn(), createResource: jest.fn() };
  let service: ResultReviewsService;
  const encounter = { resourceType: 'Encounter', id: 'encounter-1', status: 'in-progress', subject: { reference: 'Patient/patient-1' }, serviceProvider: { reference: 'Organization/hospital-a' } };
  const report = { resourceType: 'DiagnosticReport', id: 'report-1', status: 'final', subject: { reference: 'Patient/patient-1' }, encounter: { reference: 'Encounter/encounter-1' } };
  const dto = () => ({ hospitalId: 'hospital-a', patientId: 'patient-1', encounterId: 'encounter-1', targetType: 'DiagnosticReport' as const, targetId: 'report-1', practitionerId: 'doctor-1', practitionerName: 'Dr UAT', decision: 'acknowledged' as const, critical: false });

  beforeEach(() => {
    jest.resetAllMocks();
    medplum.readResource.mockImplementation(async (type: string) => type === 'Encounter' ? encounter : report);
    medplum.searchResources.mockResolvedValue([]);
    medplum.createResource.mockImplementation(async (resource) => ({ ...resource, id: 'review-1' }));
    service = new ResultReviewsService({ getClient: () => medplum } as never);
  });

  it('records reviewer identity, decision, and review time', async () => {
    await expect(service.record(dto())).resolves.toMatchObject({ id: 'review-1', hospitalId: 'hospital-a', practitionerId: 'doctor-1', decision: 'acknowledged' });
  });

  it('requires documentation for a critical result', async () => {
    await expect(service.record({ ...dto(), critical: true })).rejects.toThrow(BadRequestException);
  });

  it('rejects a preliminary result', async () => {
    medplum.readResource.mockImplementation(async (type: string) => type === 'Encounter' ? encounter : { ...report, status: 'preliminary' });
    await expect(service.record(dto())).rejects.toThrow(ConflictException);
  });

  it('hides a result linked to another encounter', async () => {
    medplum.readResource.mockImplementation(async (type: string) => type === 'Encounter' ? encounter : { ...report, encounter: { reference: 'Encounter/other' } });
    await expect(service.record(dto())).rejects.toThrow(NotFoundException);
  });

  it('blocks duplicate completed reviews', async () => {
    medplum.searchResources.mockResolvedValueOnce([{ resourceType: 'Task', status: 'completed', extension: [{ url: 'https://hospital-ehr.local/fhir/StructureDefinition/result-review-hospital', valueReference: { reference: 'Organization/hospital-a' } }] }]);
    await expect(service.record(dto())).rejects.toThrow(ConflictException);
  });
});
