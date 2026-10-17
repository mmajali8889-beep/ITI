import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { MedplumService } from '../medplum/medplum.service';
import { ClinicalNotesService } from './clinical-notes.service';

function documentWith(content: Record<string, unknown>, hospitalId = 'hospital-a') {
  return {
    resourceType: 'DocumentReference', id: 'note-1', status: 'current',
    type: { coding: [{ system: 'http://loinc.org', code: '11506-3' }] },
    subject: { reference: 'Patient/patient-1' },
    context: { encounter: [{ reference: 'Encounter/encounter-1' }], related: [{ reference: `Organization/${hospitalId}` }] },
    content: [{ attachment: { contentType: 'application/json', data: Buffer.from(JSON.stringify(content)).toString('base64') } }],
  };
}

describe('ClinicalNotesService physician documentation', () => {
  let service: ClinicalNotesService;
  const medplum = { readResource: jest.fn(), searchResources: jest.fn(), createResource: jest.fn(), updateResource: jest.fn() };
  const completeInitial = { noteType: 'initial', status: 'draft', chiefComplaint: 'Chest pain', historyPresentIllness: 'Started today',
    physicalExamination: 'Patient alert and stable', assessment: 'Possible acute coronary syndrome', plan: 'ECG and cardiac enzymes',
    allergyReview: 'reviewed-no-known', medicationReview: 'reviewed', previousResultsReviewed: true,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), practitionerName: 'Dr Test' };

  beforeEach(async () => {
    jest.resetAllMocks();
    medplum.updateResource.mockImplementation(async (resource) => resource);
    medplum.searchResources.mockResolvedValue([]);
    const module: TestingModule = await Test.createTestingModule({ providers: [ClinicalNotesService,
      { provide: MedplumService, useValue: { getClient: () => medplum } }] }).compile();
    service = module.get(ClinicalNotesService);
  });

  it('signs a complete initial note and locks its clinical content', async () => {
    medplum.readResource.mockResolvedValue(documentWith(completeInitial));
    const result = await service.sign('note-1', { hospitalId: 'hospital-a', signatureConfirmed: true });
    expect(result.status).toBe('signed');
    expect(result.signedAt).toBeDefined();
    expect(medplum.updateResource).toHaveBeenCalledTimes(1);
  });

  it('rejects an incomplete initial note', async () => {
    medplum.readResource.mockResolvedValue(documentWith({ ...completeInitial, assessment: '' }));
    await expect(service.sign('note-1', { hospitalId: 'hospital-a', signatureConfirmed: true }))
      .rejects.toThrow('Initial note is incomplete: assessment');
  });

  it('requires explicit signature confirmation', async () => {
    medplum.readResource.mockResolvedValue(documentWith(completeInitial));
    await expect(service.sign('note-1', { hospitalId: 'hospital-a', signatureConfirmed: false }))
      .rejects.toThrow(BadRequestException);
  });

  it('hides notes belonging to another hospital', async () => {
    medplum.readResource.mockResolvedValue(documentWith(completeInitial, 'hospital-b'));
    await expect(service.findById('note-1', 'hospital-a')).rejects.toThrow(NotFoundException);
  });
});
