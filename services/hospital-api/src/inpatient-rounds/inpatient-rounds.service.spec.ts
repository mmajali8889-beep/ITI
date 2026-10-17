import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { MedplumService } from '../medplum/medplum.service';
import { InpatientRoundsService } from './inpatient-rounds.service';
describe('InpatientRoundsService', () => {
  let service: InpatientRoundsService;
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
    subject: { reference: 'Patient/p1', display: 'Mona Ali' },
    serviceProvider: { reference: 'Organization/h1' },
    location: [{ status: 'active', location: { reference: 'Location/b1' } }],
  };
  const medplum = {
    readResource: jest.fn(),
    searchResources: jest.fn(),
    createResource: jest.fn(),
  };
  beforeEach(async () => {
    jest.resetAllMocks();
    medplum.readResource.mockImplementation(async (type: string) =>
      type === 'Patient' ? patient : encounter,
    );
    medplum.searchResources.mockResolvedValue([]);
    let seq = 0;
    medplum.createResource.mockImplementation(async (resource: any) => ({
      ...resource,
      id: `new-${++seq}`,
    }));
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InpatientRoundsService,
        { provide: MedplumService, useValue: { getClient: () => medplum } },
      ],
    }).compile();
    service = module.get(InpatientRoundsService);
  });
  it('builds one reverse chronological timeline from clinical resource types', async () => {
    medplum.searchResources.mockImplementation(async (type: string) =>
      type === 'Observation'
        ? [
            {
              resourceType: 'Observation',
              id: 'o1',
              status: 'final',
              code: { text: 'Pulse' },
              valueQuantity: { value: 80, unit: '/min' },
              effectiveDateTime: '2026-09-26T10:00:00Z',
            },
          ]
        : type === 'DiagnosticReport'
          ? [
              {
                resourceType: 'DiagnosticReport',
                id: 'r1',
                status: 'final',
                code: { text: 'CBC' },
                category: [{ coding: [{ code: 'laboratory' }] }],
                issued: '2026-09-26T11:00:00Z',
                conclusion: 'Normal',
              },
            ]
          : type === 'MedicationRequest'
            ? [
                {
                  resourceType: 'MedicationRequest',
                  id: 'm1',
                  status: 'active',
                  intent: 'order',
                  medicationCodeableConcept: { text: 'Aspirin' },
                  authoredOn: '2026-09-26T09:00:00Z',
                },
              ]
            : [],
    );
    const result = await service.timeline('e1', 'h1');
    expect(result.summary).toMatchObject({
      vitals: 1,
      labResults: 1,
      activeMedications: 1,
    });
    expect(result.items.map((v) => v.title)).toEqual([
      'CBC',
      'Pulse',
      'Aspirin',
    ]);
  });
  it('creates a progress note and new service and medication orders', async () => {
    const result = await service.createRound({
      hospitalId: 'h1',
      patientId: 'p1',
      encounterId: 'e1',
      physicianName: 'Dr Omar',
      physicalExamination: 'Stable',
      progressNote: 'Improving',
      assessment: 'Pneumonia',
      plan: 'Continue care',
      orders: [
        { type: 'laboratory', name: 'CBC' },
        { type: 'medication', name: 'Aspirin' },
      ],
    });
    expect(result.orders).toHaveLength(2);
    expect(medplum.createResource).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        resourceType: 'DocumentReference',
        description: 'Inpatient physician round',
      }),
    );
    expect(medplum.createResource).toHaveBeenCalledWith(
      expect.objectContaining({ resourceType: 'ServiceRequest' }),
    );
    expect(medplum.createResource).toHaveBeenCalledWith(
      expect.objectContaining({ resourceType: 'MedicationRequest' }),
    );
  });
  it('rejects a round for a non-inpatient encounter', async () => {
    medplum.readResource.mockImplementation(async (type: string) =>
      type === 'Patient' ? patient : { ...encounter, class: { code: 'AMB' } },
    );
    await expect(
      service.createRound({
        hospitalId: 'h1',
        patientId: 'p1',
        encounterId: 'e1',
        physicianName: 'Dr Omar',
        physicalExamination: 'Stable',
        progressNote: 'Note',
        assessment: 'A',
        plan: 'P',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it('hides encounters belonging to another hospital', async () => {
    medplum.readResource.mockResolvedValue({
      ...encounter,
      serviceProvider: { reference: 'Organization/h2' },
    });
    await expect(service.timeline('e1', 'h1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
