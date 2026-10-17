import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type { DocumentReference, Encounter, Patient } from '@medplum/fhirtypes';

import { MedplumService } from '../medplum/medplum.service';

import {
  CreateAddendumDto,
  CreateClinicalNoteDto,
  UpdateClinicalNoteDto,
  SignClinicalNoteDto,
} from './dto/clinical-note.dto';

interface ClinicalNoteContent {
  noteType: string;

  status: 'draft' | 'signed';

  chiefComplaint?: string;

  historyPresentIllness?: string;

  reviewOfSystems?: string;

  physicalExamination?: string;

  allergyReview?: 'reviewed-no-known' | 'reviewed-known' | 'unable';

  medicationReview?: 'reviewed' | 'unable';

  previousResultsReviewed?: boolean;

  assessment?: string;

  plan?: string;

  progressNote?: string;

  createdAt: string;

  updatedAt: string;

  signedAt?: string;

  practitionerId?: string;

  practitionerName?: string;

  parentNoteId?: string;

  addendumText?: string;
}

@Injectable()
export class ClinicalNotesService {
  constructor(private readonly medplumService: MedplumService) {}

  /* =====================================================
     CREATE DRAFT
  ===================================================== */

  async create(dto: CreateClinicalNoteDto) {
    const medplum = this.medplumService.getClient();

    await this.validateContext(dto.patientId, dto.encounterId, dto.hospitalId);

    const now = new Date().toISOString();

    const content: ClinicalNoteContent = {
      noteType: dto.noteType ?? 'progress',

      status: 'draft',

      chiefComplaint: dto.chiefComplaint?.trim(),

      historyPresentIllness: dto.historyPresentIllness?.trim(),

      reviewOfSystems: dto.reviewOfSystems?.trim(),

      physicalExamination: dto.physicalExamination?.trim(),

      allergyReview: dto.allergyReview,

      medicationReview: dto.medicationReview,

      previousResultsReviewed: dto.previousResultsReviewed,

      assessment: dto.assessment?.trim(),

      plan: dto.plan?.trim(),

      progressNote: dto.progressNote?.trim(),

      createdAt: now,

      updatedAt: now,

      practitionerId: dto.practitionerId,

      practitionerName: dto.practitionerName,
    };

    const document: DocumentReference = {
      resourceType: 'DocumentReference',

      status: 'current',

      type: {
        coding: [
          {
            system: 'http://loinc.org',

            code: '11506-3',

            display: 'Progress note',
          },
        ],

        text: this.getNoteTypeDisplay(content.noteType),
      },

      subject: {
        reference: `Patient/${dto.patientId}`,
      },

      context: {
        encounter: [
          {
            reference: `Encounter/${dto.encounterId}`,
          },
        ],

        related: [
          {
            reference: `Organization/${dto.hospitalId}`,
          },
        ],
      },

      date: now,

      author: dto.practitionerId
        ? [
            {
              reference: `Practitioner/${dto.practitionerId}`,

              display: dto.practitionerName,
            },
          ]
        : dto.practitionerName
          ? [
              {
                display: dto.practitionerName,
              },
            ]
          : undefined,

      description: this.getNoteTypeDisplay(content.noteType),

      content: [
        {
          attachment: {
            contentType: 'application/json',

            data: this.encodeContent(content),

            title: this.getNoteTypeDisplay(content.noteType),

            creation: now,
          },
        },
      ],
    };

    const created = await medplum.createResource<DocumentReference>(document);

    return this.mapNote(created);
  }

  /* =====================================================
     GET ENCOUNTER NOTES
  ===================================================== */

  async findByEncounter(encounterId: string, hospitalId: string) {
    if (!encounterId) {
      throw new BadRequestException('Encounter ID is required');
    }
    if (!hospitalId) throw new BadRequestException('Hospital ID is required');
    const encounter = await this.readEncounter(encounterId);
    this.assertEncounterHospital(encounter, hospitalId);

    const medplum = this.medplumService.getClient();

    const result = await medplum.searchResources('DocumentReference', {
      encounter: `Encounter/${encounterId}`,

      _count: '200',
    });

    const documents: DocumentReference[] = [...result];

    const notes = documents
      .filter((document) => this.isClinicalNote(document))
      .map((document) => this.mapNote(document))
      .sort(
        (a, b) =>
          new Date(b.updatedAt ?? b.createdAt ?? 0).getTime() -
          new Date(a.updatedAt ?? a.createdAt ?? 0).getTime(),
      );

    return {
      total: notes.length,

      notes,
    };
  }

  /* =====================================================
     GET PATIENT NOTES
  ===================================================== */

  async findByPatient(patientId: string, hospitalId: string) {
    if (!patientId) {
      throw new BadRequestException('Patient ID is required');
    }
    if (!hospitalId) throw new BadRequestException('Hospital ID is required');

    const medplum = this.medplumService.getClient();

    try {
      const patient = await medplum.readResource('Patient', patientId);
      if (
        patient.managingOrganization?.reference !== `Organization/${hospitalId}`
      ) {
        throw new NotFoundException('Patient not found');
      }
    } catch {
      throw new NotFoundException('Patient not found');
    }

    const result = await medplum.searchResources('DocumentReference', {
      subject: `Patient/${patientId}`,

      _count: '500',
    });

    const documents: DocumentReference[] = [...result];

    const notes = documents
      .filter((document) => this.isClinicalNote(document))
      .map((document) => this.mapNote(document))
      .sort(
        (a, b) =>
          new Date(b.updatedAt ?? b.createdAt ?? 0).getTime() -
          new Date(a.updatedAt ?? a.createdAt ?? 0).getTime(),
      );

    return {
      total: notes.length,

      notes,
    };
  }

  /* =====================================================
     GET NOTE
  ===================================================== */

  async findById(noteId: string, hospitalId: string) {
    const document = await this.readNote(noteId, hospitalId);

    return this.mapNote(document);
  }

  /* =====================================================
     UPDATE DRAFT
  ===================================================== */

  async update(noteId: string, dto: UpdateClinicalNoteDto) {
    const medplum = this.medplumService.getClient();

    const document = await this.readNote(noteId, dto.hospitalId);

    const content = this.getContent(document);

    if (content.status === 'signed') {
      throw new BadRequestException(
        'Signed clinical notes cannot be modified. Create an addendum instead.',
      );
    }

    content.chiefComplaint = this.updateText(
      dto.chiefComplaint,
      content.chiefComplaint,
    );

    content.historyPresentIllness = this.updateText(
      dto.historyPresentIllness,
      content.historyPresentIllness,
    );

    content.reviewOfSystems = this.updateText(
      dto.reviewOfSystems,
      content.reviewOfSystems,
    );

    content.physicalExamination = this.updateText(
      dto.physicalExamination,
      content.physicalExamination,
    );

    content.allergyReview = dto.allergyReview ?? content.allergyReview;
    content.medicationReview = dto.medicationReview ?? content.medicationReview;
    content.previousResultsReviewed =
      dto.previousResultsReviewed ?? content.previousResultsReviewed;

    content.assessment = this.updateText(dto.assessment, content.assessment);

    content.plan = this.updateText(dto.plan, content.plan);

    content.progressNote = this.updateText(
      dto.progressNote,
      content.progressNote,
    );

    content.updatedAt = new Date().toISOString();

    this.setContent(document, content);

    const updated = await medplum.updateResource<DocumentReference>(document);

    return this.mapNote(updated);
  }

  /* =====================================================
     SIGN NOTE
  ===================================================== */

  async sign(noteId: string, dto: SignClinicalNoteDto) {
    const medplum = this.medplumService.getClient();

    const document = await this.readNote(noteId, dto.hospitalId);

    const content = this.getContent(document);

    if (!dto.signatureConfirmed) {
      throw new BadRequestException(
        'Clinical signature confirmation is required',
      );
    }

    if (content.status === 'signed') {
      throw new BadRequestException('Clinical note is already signed');
    }

    if (!this.hasClinicalContent(content)) {
      throw new BadRequestException('Cannot sign an empty clinical note');
    }

    const requiredSections = [
      ['chief complaint', content.chiefComplaint],
      ['history of present illness', content.historyPresentIllness],
      ['physical examination', content.physicalExamination],
      ['allergy review', content.allergyReview],
      ['medication review', content.medicationReview],
      [
        'previous results review',
        content.previousResultsReviewed === true ? 'confirmed' : undefined,
      ],
      ['assessment', content.assessment],
      ['plan', content.plan],
    ];
    const missing = requiredSections
      .filter(([, value]) => !value?.trim())
      .map(([name]) => name);
    if (content.noteType === 'initial' && missing.length > 0) {
      throw new BadRequestException(
        `Initial note is incomplete: ${missing.join(', ')}`,
      );
    }

    const now = new Date().toISOString();

    content.status = 'signed';

    content.signedAt = now;

    content.updatedAt = now;

    document.date = now;

    this.setContent(document, content);

    const updated = await medplum.updateResource<DocumentReference>(document);

    return this.mapNote(updated);
  }

  /* =====================================================
     ADDENDUM
  ===================================================== */

  async createAddendum(noteId: string, dto: CreateAddendumDto) {
    if (!dto.text?.trim()) {
      throw new BadRequestException('Addendum text is required');
    }

    const medplum = this.medplumService.getClient();

    const original = await this.readNote(noteId, dto.hospitalId);

    const originalContent = this.getContent(original);

    if (originalContent.status !== 'signed') {
      throw new BadRequestException(
        'Addendum can only be added to a signed clinical note',
      );
    }

    const patientId = original.subject?.reference?.replace('Patient/', '');

    const encounterId = original.context?.encounter?.[0]?.reference?.replace(
      'Encounter/',
      '',
    );

    const hospitalId = original.context?.related
      ?.find((reference) => reference.reference?.startsWith('Organization/'))
      ?.reference?.replace('Organization/', '');

    if (!patientId || !encounterId || !hospitalId) {
      throw new BadRequestException(
        'Original clinical note context is incomplete',
      );
    }

    const now = new Date().toISOString();

    const content: ClinicalNoteContent = {
      noteType: 'addendum',

      status: 'signed',

      addendumText: dto.text.trim(),

      parentNoteId: noteId,

      createdAt: now,

      updatedAt: now,

      signedAt: now,

      practitionerId: dto.practitionerId,

      practitionerName: dto.practitionerName,
    };

    const addendum: DocumentReference = {
      resourceType: 'DocumentReference',

      status: 'current',

      type: {
        coding: [
          {
            system: 'http://loinc.org',

            code: '11506-3',

            display: 'Progress note',
          },
        ],

        text: 'Clinical Note Addendum',
      },

      subject: {
        reference: `Patient/${patientId}`,
      },

      context: {
        encounter: [
          {
            reference: `Encounter/${encounterId}`,
          },
        ],

        related: [
          {
            reference: `Organization/${hospitalId}`,
          },
        ],
      },

      relatesTo: [
        {
          code: 'appends',

          target: {
            reference: `DocumentReference/${noteId}`,
          },
        },
      ],

      date: now,

      author: dto.practitionerId
        ? [
            {
              reference: `Practitioner/${dto.practitionerId}`,

              display: dto.practitionerName,
            },
          ]
        : dto.practitionerName
          ? [
              {
                display: dto.practitionerName,
              },
            ]
          : undefined,

      description: 'Clinical Note Addendum',

      content: [
        {
          attachment: {
            contentType: 'application/json',

            data: this.encodeContent(content),

            title: 'Clinical Note Addendum',

            creation: now,
          },
        },
      ],
    };

    const created = await medplum.createResource<DocumentReference>(addendum);

    return this.mapNote(created);
  }

  /* =====================================================
     VALIDATE CONTEXT
  ===================================================== */

  private async validateContext(
    patientId: string,
    encounterId: string,
    hospitalId: string,
  ) {
    if (!patientId || !encounterId || !hospitalId) {
      throw new BadRequestException(
        'Patient, encounter and hospital are required',
      );
    }

    const medplum = this.medplumService.getClient();

    let patient: Patient;

    try {
      patient = await medplum.readResource('Patient', patientId);
    } catch {
      throw new NotFoundException('Patient not found');
    }

    let encounter: Encounter;

    try {
      encounter = await medplum.readResource('Encounter', encounterId);
    } catch {
      throw new NotFoundException('Encounter not found');
    }

    if (encounter.subject?.reference !== `Patient/${patientId}`) {
      throw new BadRequestException(
        'Encounter does not belong to this patient',
      );
    }

    if (
      patient.managingOrganization?.reference &&
      patient.managingOrganization.reference !== `Organization/${hospitalId}`
    ) {
      throw new BadRequestException(
        'Patient does not belong to the selected hospital',
      );
    }

    if (
      encounter.serviceProvider?.reference &&
      encounter.serviceProvider.reference !== `Organization/${hospitalId}`
    ) {
      throw new BadRequestException(
        'Encounter does not belong to the selected hospital',
      );
    }
  }

  /* =====================================================
     READ NOTE
  ===================================================== */

  private async readNote(noteId: string, hospitalId: string) {
    const medplum = this.medplumService.getClient();

    let document: DocumentReference;

    try {
      document = await medplum.readResource('DocumentReference', noteId);
    } catch {
      throw new NotFoundException('Clinical note not found');
    }

    if (!this.isClinicalNote(document)) {
      throw new BadRequestException('Document is not a clinical note');
    }

    const noteHospitalId = document.context?.related
      ?.find((reference) => reference.reference?.startsWith('Organization/'))
      ?.reference?.replace('Organization/', '');
    if (!hospitalId || noteHospitalId !== hospitalId) {
      throw new NotFoundException('Clinical note not found');
    }

    return document;
  }

  private async readEncounter(encounterId: string): Promise<Encounter> {
    try {
      return await this.medplumService
        .getClient()
        .readResource('Encounter', encounterId);
    } catch {
      throw new NotFoundException('Encounter not found');
    }
  }

  private assertEncounterHospital(
    encounter: Encounter,
    hospitalId: string,
  ): void {
    if (encounter.serviceProvider?.reference !== `Organization/${hospitalId}`) {
      throw new NotFoundException('Encounter not found');
    }
  }

  /* =====================================================
     IDENTIFY OUR CLINICAL NOTE
  ===================================================== */

  private isClinicalNote(document: DocumentReference) {
    return (
      document.type?.coding?.some(
        (coding) =>
          coding.system === 'http://loinc.org' && coding.code === '11506-3',
      ) === true
    );
  }

  /* =====================================================
     GET CONTENT
  ===================================================== */

  private getContent(document: DocumentReference): ClinicalNoteContent {
    const data = document.content?.[0]?.attachment?.data;

    if (!data) {
      throw new BadRequestException('Clinical note content is missing');
    }

    try {
      return JSON.parse(
        Buffer.from(data, 'base64').toString('utf8'),
      ) as ClinicalNoteContent;
    } catch {
      throw new BadRequestException('Clinical note content is invalid');
    }
  }

  /* =====================================================
     SET CONTENT
  ===================================================== */

  private setContent(
    document: DocumentReference,
    content: ClinicalNoteContent,
  ) {
    if (!document.content?.[0]) {
      document.content = [
        {
          attachment: {},
        },
      ];
    }

    document.content[0].attachment = {
      ...document.content[0].attachment,

      contentType: 'application/json',

      data: this.encodeContent(content),

      title: this.getNoteTypeDisplay(content.noteType),
    };
  }

  /* =====================================================
     ENCODE CONTENT
  ===================================================== */

  private encodeContent(content: ClinicalNoteContent) {
    return Buffer.from(JSON.stringify(content), 'utf8').toString('base64');
  }

  /* =====================================================
     MAP RESPONSE
  ===================================================== */

  private mapNote(document: DocumentReference) {
    const content = this.getContent(document);

    return {
      id: document.id,

      resourceType: document.resourceType,

      status: content.status,

      noteType: content.noteType,

      patientId: document.subject?.reference?.replace('Patient/', ''),

      encounterId: document.context?.encounter?.[0]?.reference?.replace(
        'Encounter/',
        '',
      ),

      hospitalId: document.context?.related
        ?.find((reference) => reference.reference?.startsWith('Organization/'))
        ?.reference?.replace('Organization/', ''),

      practitionerId: content.practitionerId,

      practitionerName: content.practitionerName,

      chiefComplaint: content.chiefComplaint,

      historyPresentIllness: content.historyPresentIllness,

      reviewOfSystems: content.reviewOfSystems,

      physicalExamination: content.physicalExamination,

      allergyReview: content.allergyReview,

      medicationReview: content.medicationReview,

      previousResultsReviewed: content.previousResultsReviewed,

      assessment: content.assessment,

      plan: content.plan,

      progressNote: content.progressNote,

      addendumText: content.addendumText,

      parentNoteId: content.parentNoteId,

      createdAt: content.createdAt,

      updatedAt: content.updatedAt,

      signedAt: content.signedAt,
    };
  }

  /* =====================================================
     HELPERS
  ===================================================== */

  private updateText(
    newValue: string | undefined,
    currentValue: string | undefined,
  ) {
    if (newValue === undefined) {
      return currentValue;
    }

    return newValue.trim() || undefined;
  }

  private hasClinicalContent(content: ClinicalNoteContent) {
    return Boolean(
      content.chiefComplaint ||
      content.historyPresentIllness ||
      content.reviewOfSystems ||
      content.physicalExamination ||
      content.assessment ||
      content.plan ||
      content.progressNote,
    );
  }

  private getNoteTypeDisplay(type: string) {
    switch (type) {
      case 'initial':
        return 'Initial Clinical Note';

      case 'consultation':
        return 'Consultation Note';

      case 'discharge':
        return 'Discharge Note';

      case 'addendum':
        return 'Clinical Note Addendum';

      default:
        return 'Progress Note';
    }
  }
}
