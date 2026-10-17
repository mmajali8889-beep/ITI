export type ClinicalNoteStatus =
  | 'draft'
  | 'signed'
  | 'entered-in-error';

export type ClinicalNoteType =
  | 'initial'
  | 'progress'
  | 'consultation'
  | 'discharge'
  | 'addendum';

export interface ClinicalNote {
  id?: string;
  resourceType?: 'DocumentReference';

  status: ClinicalNoteStatus;
  noteType: ClinicalNoteType;

  patientId?: string;
  encounterId?: string;
  hospitalId?: string;

  practitionerId?: string;
  practitionerName?: string;

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

  addendumText?: string;
  parentNoteId?: string;

  createdAt?: string;
  updatedAt?: string;
  signedAt?: string;
}

export interface ClinicalNotesResponse {
  total: number;
  notes: ClinicalNote[];
}

export interface CreateClinicalNoteRequest {
  patientId: string;
  encounterId: string;
  hospitalId: string;

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

export interface UpdateClinicalNoteRequest {
  hospitalId: string;
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

export interface CreateAddendumRequest {
  hospitalId: string;
  practitionerId?: string;
  practitionerName?: string;
  text: string;
}
