export type ClinicalNoteStatus = 'draft' | 'signed' | 'entered-in-error';

export type ClinicalNoteType =
  'initial' | 'progress' | 'consultation' | 'discharge' | 'addendum';

export class CreateClinicalNoteDto {
  patientId!: string;
  encounterId!: string;
  hospitalId!: string;

  practitionerId?: string;
  practitionerName?: string;

  noteType?: ClinicalNoteType;

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
}

export class UpdateClinicalNoteDto {
  hospitalId!: string;
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
}

export class CreateAddendumDto {
  hospitalId!: string;
  practitionerId?: string;

  practitionerName?: string;

  text!: string;
}

export class SignClinicalNoteDto {
  hospitalId!: string;
  signatureConfirmed!: boolean;
}
