import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { MedplumService } from '../medplum/medplum.service';
import { IcuService } from './icu.service';
describe('IcuService critical care workflow', () => {
  let service: IcuService;
  const patient = {
    resourceType: 'Patient',
    id: 'p1',
    managingOrganization: { reference: 'Organization/h1' },
  };
  const encounter = {
    resourceType: 'Encounter',
    id: 'e1',
    status: 'in-progress',
    class: { code: 'IMP' },
    subject: { reference: 'Patient/p1' },
    serviceProvider: { reference: 'Organization/h1' },
  };
  const admission = {
    resourceType: 'Task',
    id: 'icu1',
    status: 'in-progress',
    code: { coding: [{ code: 'icu-admission' }] },
    for: { reference: 'Patient/p1' },
    encounter: { reference: 'Encounter/e1' },
    extension: [
      {
        url: 'https://hospital-ehr.local/fhir/StructureDefinition/icu-hospital',
        valueReference: { reference: 'Organization/h1' },
      },
      {
        url: 'https://hospital-ehr.local/fhir/StructureDefinition/icu-acuity',
        valueInteger: 1,
      },
    ],
  };
  const medplum = {
    readResource: jest.fn(),
    searchResources: jest.fn(),
    createResource: jest.fn(),
    updateResource: jest.fn(),
  };
  beforeEach(async () => {
    jest.resetAllMocks();
    medplum.readResource.mockImplementation(async (type: string) =>
      type === 'Patient'
        ? patient
        : type === 'Encounter'
          ? encounter
          : { ...admission },
    );
    medplum.searchResources.mockResolvedValue([]);
    medplum.createResource.mockImplementation(async (resource: any) => ({
      ...resource,
      id: 'new',
    }));
    medplum.updateResource.mockImplementation(
      async (resource: any) => resource,
    );
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IcuService,
        { provide: MedplumService, useValue: { getClient: () => medplum } },
      ],
    }).compile();
    service = module.get(IcuService);
  });
  it('admits an inpatient to an ICU location', async () => {
    await expect(
      service.admit({
        hospitalId: 'h1',
        patientId: 'p1',
        encounterId: 'e1',
        clinicianName: 'Dr Sara',
        icuLocationId: 'icu-bed-1',
        icuLocationName: 'ICU Bed 1',
        admissionReason: 'Respiratory failure',
        acuity: 1,
      }),
    ).resolves.toMatchObject({ status: 'in-progress', acuity: 1 });
  });
  it('requires active ICU admission for high-frequency observations', async () => {
    await expect(
      service.observation({
        hospitalId: 'h1',
        patientId: 'p1',
        encounterId: 'e1',
        clinicianName: 'Nurse Ali',
        type: 'spo2',
        value: 94,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    medplum.searchResources.mockResolvedValue([admission]);
    await service.observation({
      hospitalId: 'h1',
      patientId: 'p1',
      encounterId: 'e1',
      clinicianName: 'Nurse Ali',
      type: 'spo2',
      value: 94,
    });
    expect(medplum.createResource).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: 'Observation',
        code: expect.objectContaining({ text: 'Oxygen saturation' }),
      }),
    );
  });
  it('records a titratable infusion as MedicationAdministration', async () => {
    medplum.searchResources.mockResolvedValue([admission]);
    await service.infusion({
      hospitalId: 'h1',
      patientId: 'p1',
      encounterId: 'e1',
      clinicianName: 'Nurse Ali',
      medicationName: 'Norepinephrine',
      rate: 5,
      rateUnit: 'mcg/min',
      status: 'in-progress',
    });
    expect(medplum.createResource).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: 'MedicationAdministration',
        dosage: expect.objectContaining({
          rateQuantity: { value: 5, unit: 'mcg/min' },
        }),
      }),
    );
  });
  it('enforces hospital isolation on ICU disposition', async () => {
    await expect(
      service.disposition('icu1', {
        hospitalId: 'h2',
        clinicianName: 'Dr Sara',
        destination: 'ward',
        note: 'Stable',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
