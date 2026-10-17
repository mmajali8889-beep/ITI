import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { MedplumService } from '../medplum/medplum.service';
import { SurgeryService } from './surgery.service';
describe('SurgeryService perioperative workflow', () => {
  let service: SurgeryService;
  let stored: any;
  const encounter = {
    resourceType: 'Encounter',
    id: 'e1',
    status: 'in-progress',
    subject: { reference: 'Patient/p1', display: 'Mona Ali' },
    serviceProvider: { reference: 'Organization/h1' },
  };
  const medplum = {
    readResource: jest.fn(),
    searchResources: jest.fn(),
    createResource: jest.fn(),
    updateResource: jest.fn(),
  };
  beforeEach(async () => {
    jest.resetAllMocks();
    stored = undefined;
    medplum.readResource.mockImplementation(async (type: string) =>
      type === 'Encounter' ? encounter : stored,
    );
    medplum.createResource.mockImplementation(async (resource: any) => {
      if (resource.resourceType === 'Task') {
        stored = { ...resource, id: 's1' };
        return stored;
      }
      return { ...resource, id: 'support-1' };
    });
    medplum.updateResource.mockImplementation(async (resource: any) => {
      stored = resource;
      return resource;
    });
    medplum.searchResources.mockImplementation(async () =>
      stored ? [stored] : [],
    );
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SurgeryService,
        { provide: MedplumService, useValue: { getClient: () => medplum } },
      ],
    }).compile();
    service = module.get(SurgeryService);
  });
  async function create() {
    return service.create({
      hospitalId: 'h1',
      patientId: 'p1',
      encounterId: 'e1',
      procedureName: 'Appendectomy',
      indication: 'Acute appendicitis',
      surgeonName: 'Dr Omar',
      assistantName: 'Dr Ali',
      anesthesiologistName: 'Dr Sara',
      nurseNames: ['Nurse Mona'],
    });
  }
  it('creates a hospital-scoped surgery request with the complete team', async () => {
    await expect(create()).resolves.toMatchObject({
      id: 's1',
      stage: 'requested',
      procedureName: 'Appendectomy',
      surgeonName: 'Dr Omar',
      assistantName: 'Dr Ali',
    });
  });
  it('enforces every mandatory safety gate in order', async () => {
    await create();
    await expect(
      service.transition('s1', {
        hospitalId: 'h1',
        stage: 'scheduled',
        actorName: 'Coordinator',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.transition('s1', {
        hospitalId: 'h1',
        stage: 'authorized',
        actorName: 'Coordinator',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await service.transition('s1', {
      hospitalId: 'h1',
      stage: 'authorized',
      actorName: 'Coordinator',
      authorizationNumber: 'AUTH-1',
    });
    await expect(
      service.transition('s1', {
        hospitalId: 'h1',
        stage: 'scheduled',
        actorName: 'Coordinator',
        operatingRoomName: 'OR-1',
        scheduledStart: '2026-09-27T08:00:00Z',
        scheduledEnd: '2026-09-27T07:00:00Z',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
  it('persists checklists and consent as dedicated FHIR resources', async () => {
    await create();
    await service.transition('s1', {
      hospitalId: 'h1',
      stage: 'authorized',
      actorName: 'A',
      authorizationNumber: 'AUTH',
    });
    await service.transition('s1', {
      hospitalId: 'h1',
      stage: 'scheduled',
      actorName: 'A',
      operatingRoomName: 'OR-1',
      scheduledStart: '2026-09-27T08:00:00Z',
      scheduledEnd: '2026-09-27T09:00:00Z',
    });
    await service.transition('s1', {
      hospitalId: 'h1',
      stage: 'pre-op-assessed',
      actorName: 'Nurse',
      checklist: { identity: true },
    });
    await service.transition('s1', {
      hospitalId: 'h1',
      stage: 'anesthesia-assessed',
      actorName: 'Anesthetist',
      checklist: { airway: true },
    });
    await service.transition('s1', {
      hospitalId: 'h1',
      stage: 'consented',
      actorName: 'Dr Omar',
      consentType: 'Surgery',
    });
    expect(medplum.createResource).toHaveBeenCalledWith(
      expect.objectContaining({ resourceType: 'QuestionnaireResponse' }),
    );
    expect(medplum.createResource).toHaveBeenCalledWith(
      expect.objectContaining({ resourceType: 'Consent' }),
    );
  });
  it('prevents cross-hospital case access', async () => {
    await create();
    await expect(service.get('s1', 'h2')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
