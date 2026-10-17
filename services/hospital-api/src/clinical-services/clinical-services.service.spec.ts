import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ClinicalServicesService } from './clinical-services.service';

describe('ClinicalServicesService', () => {
  const medplum = { readResource: jest.fn(), searchResources: jest.fn(), createResource: jest.fn(), updateResource: jest.fn() };
  let service: ClinicalServicesService;
  const patient = { resourceType: 'Patient', id: 'patient-1', managingOrganization: { reference: 'Organization/hospital-a' }, name: [{ text: 'UAT Patient' }] };
  const encounter = { resourceType: 'Encounter', id: 'encounter-1', status: 'in-progress', subject: { reference: 'Patient/patient-1' }, serviceProvider: { reference: 'Organization/hospital-a' } };
  const dto = () => ({ hospitalId: 'hospital-a', patientId: 'patient-1', encounterId: 'encounter-1', serviceType: 'consultation' as const, serviceCode: 'CARD-CONSULT', serviceName: 'Cardiology consultation' });

  beforeEach(() => {
    jest.resetAllMocks();
    medplum.readResource.mockImplementation(async (type: string) => type === 'Patient' ? patient : encounter);
    medplum.searchResources.mockResolvedValue([]);
    medplum.createResource.mockImplementation(async (resource) => ({ ...resource, id: 'service-1' }));
    medplum.updateResource.mockImplementation(async (resource) => resource);
    service = new ClinicalServicesService({ getClient: () => medplum } as never);
  });

  it.each(['procedure', 'consultation', 'other'] as const)('creates a scoped %s order', async (serviceType) => {
    await expect(service.create({ ...dto(), serviceType })).resolves.toMatchObject({ id: 'service-1', serviceType, hospitalId: 'hospital-a' });
  });

  it('rejects an encounter from another hospital', async () => {
    medplum.readResource.mockImplementation(async (type: string) => type === 'Patient' ? patient : { ...encounter, serviceProvider: { reference: 'Organization/hospital-b' } });
    await expect(service.create(dto())).rejects.toThrow(NotFoundException);
  });

  it('requires performer and documentation before completion', async () => {
    medplum.readResource.mockResolvedValueOnce({ resourceType: 'ServiceRequest', id: 'service-1', status: 'active', subject: { reference: 'Patient/patient-1' }, category: [{ coding: [{ code: 'consultation' }] }], extension: [{ url: 'https://hospital-ehr.local/fhir/StructureDefinition/clinical-service-hospital', valueReference: { reference: 'Organization/hospital-a' } }] });
    await expect(service.updateStatus('service-1', { hospitalId: 'hospital-a', status: 'completed' })).rejects.toThrow(BadRequestException);
  });

  it('prevents transitions from a final state', async () => {
    medplum.readResource.mockResolvedValueOnce({ resourceType: 'ServiceRequest', id: 'service-1', status: 'completed', subject: { reference: 'Patient/patient-1' }, category: [{ coding: [{ code: 'procedure' }] }], extension: [{ url: 'https://hospital-ehr.local/fhir/StructureDefinition/clinical-service-hospital', valueReference: { reference: 'Organization/hospital-a' } }] });
    await expect(service.updateStatus('service-1', { hospitalId: 'hospital-a', status: 'active' })).rejects.toThrow(ConflictException);
  });
});
