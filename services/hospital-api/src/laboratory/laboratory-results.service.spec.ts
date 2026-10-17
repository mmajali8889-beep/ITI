import { BadRequestException, ConflictException } from '@nestjs/common';
import { LaboratoryResultsService } from './laboratory-results.service';

describe('LaboratoryResultsService validation and critical result workflow', () => {
  const hospitalExtension = {
    url: 'http://hospital-ehr.local/fhir/StructureDefinition/hospital',
    valueReference: { reference: 'Organization/hospital-a' },
  };
  let result: any;
  const medplum = {
    readResource: jest.fn(),
    searchResources: jest.fn(),
    createResource: jest.fn(),
    updateResource: jest.fn(),
  };
  let service: LaboratoryResultsService;

  beforeEach(() => {
    jest.resetAllMocks();
    result = {
      resourceType: 'Observation',
      id: 'result-1',
      status: 'preliminary',
      category: [{ coding: [{ code: 'laboratory' }] }],
      code: { text: 'Potassium' },
      subject: { reference: 'Patient/patient-1' },
      encounter: { reference: 'Encounter/encounter-1' },
      interpretation: [{ coding: [{ code: 'HH' }] }],
      extension: [hospitalExtension],
    };
    medplum.readResource.mockImplementation(async () => result);
    medplum.updateResource.mockImplementation(async (resource) => {
      result = resource;
      return resource;
    });
    medplum.searchResources.mockResolvedValue([]);
    medplum.createResource.mockImplementation(async (resource) => ({
      ...resource,
      id: 'critical-task-1',
    }));
    service = new LaboratoryResultsService({
      getClient: () => medplum,
    } as never);
  });

  it('requires technical validation before clinical release', async () => {
    await expect(
      service.validateClinical('result-1', {
        hospitalId: 'hospital-a',
        validatorName: 'Dr Validator',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('technically validates, clinically releases, and creates one critical alert task', async () => {
    await service.validateTechnical('result-1', {
      hospitalId: 'hospital-a',
      validatorName: 'Technologist One',
    });
    const released = await service.validateClinical('result-1', {
      hospitalId: 'hospital-a',
      validatorName: 'Pathologist One',
    });
    expect(released).toMatchObject({
      status: 'final',
      technicalValidated: true,
      clinicalValidated: true,
      criticalAcknowledged: false,
    });
    expect(medplum.createResource).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: 'Task',
        status: 'ready',
        priority: 'stat',
      }),
    );
  });

  it('requires read-back confirmation for critical notification', async () => {
    await expect(
      service.acknowledgeCritical('result-1', {
        hospitalId: 'hospital-a',
        notifiedPersonName: 'Dr A',
        notifiedRole: 'doctor',
        notificationMethod: 'phone',
        readBackConfirmed: false,
        acknowledgedByName: 'Tech B',
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
