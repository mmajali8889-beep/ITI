import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { MedplumService } from '../medplum/medplum.service';
import { VitalsService } from './vitals.service';
import type { CreateVitalsDto } from './dto/create-vitals.dto';

describe('VitalsService triage workflow', () => {
  let service: VitalsService;
  const encounter = {
    resourceType: 'Encounter',
    id: 'encounter-1',
    status: 'in-progress',
    subject: { reference: 'Patient/patient-1' },
    serviceProvider: { reference: 'Organization/hospital-a' },
    extension: [],
  };
  const medplum = {
    readResource: jest.fn(),
    createResource: jest.fn(),
    updateResource: jest.fn(),
    searchResources: jest.fn(),
  };
  const valid = (): CreateVitalsDto => ({
    patientId: 'patient-1',
    encounterId: 'encounter-1',
    hospitalId: 'hospital-a',
    systolic: 120,
    diastolic: 80,
    pulse: 75,
    temperature: 37,
    respiratoryRate: 16,
    spo2: 98,
    painScore: 2,
    triageLevel: 3,
    chiefComplaint: 'Abdominal pain',
    consciousness: 'alert',
    mobility: 'independent',
    allergyCheck: 'reviewed-no-known',
    medicationHistory: 'reviewed',
    triageConfirmed: true,
  });

  beforeEach(async () => {
    jest.resetAllMocks();
    medplum.readResource.mockImplementation(async (type: string) =>
      type === 'Patient'
        ? {
            resourceType: 'Patient',
            id: 'patient-1',
            managingOrganization: { reference: 'Organization/hospital-a' },
          }
        : { ...encounter, extension: [] },
    );
    medplum.createResource.mockImplementation(async (resource) => ({
      ...resource,
      id: `obs-${Math.random()}`,
    }));
    medplum.updateResource.mockImplementation(async (resource) => resource);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VitalsService,
        { provide: MedplumService, useValue: { getClient: () => medplum } },
      ],
    }).compile();
    service = module.get(VitalsService);
  });

  it('records observations and advances the encounter to triaged', async () => {
    const result = await service.create(valid());
    expect(result.triage).toMatchObject({
      level: 3,
      critical: false,
      alerts: [],
      allergyCheck: 'reviewed-no-known',
      medicationHistory: 'reviewed',
      doctorQueueStatus: 'ready',
    });
    expect(medplum.createResource).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: 'Task',
        status: 'ready',
        code: expect.objectContaining({ text: 'Doctor assessment queue' }),
      }),
    );
    expect(medplum.updateResource).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'triaged',
        priority: expect.objectContaining({ text: 'Triage level 3' }),
      }),
    );
  });

  it('generates critical alerts from dangerous measurements', async () => {
    const dto = valid();
    dto.spo2 = 82;
    dto.systolic = 190;
    dto.triageLevel = 1;
    const result = await service.create(dto);
    expect(result.triage?.critical).toBe(true);
    expect(result.triage?.alerts).toEqual(
      expect.arrayContaining([
        'Critical oxygen saturation',
        'Critical systolic blood pressure',
      ]),
    );
  });

  it('rejects triage for an encounter in another hospital', async () => {
    medplum.readResource.mockImplementation(async (type: string) =>
      type === 'Patient'
        ? { resourceType: 'Patient', id: 'patient-1' }
        : {
            ...encounter,
            serviceProvider: { reference: 'Organization/hospital-b' },
          },
    );
    await expect(service.create(valid())).rejects.toThrow(
      'Encounter does not belong to the selected hospital',
    );
  });

  it('requires a chief complaint and confirmation', async () => {
    const dto = valid();
    dto.chiefComplaint = '';
    dto.triageConfirmed = false;
    await expect(service.create(dto)).rejects.toThrow(BadRequestException);
  });
});
