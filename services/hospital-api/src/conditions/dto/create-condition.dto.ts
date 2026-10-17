export type ConditionCategoryType = 'encounter-diagnosis' | 'problem-list-item';

export type DiagnosisRank = 'primary' | 'secondary';

export type DiagnosisCodeSystem = 'ICD-10' | 'ICD-11';

export type ConditionClinicalStatus =
  'active' | 'recurrence' | 'relapse' | 'inactive' | 'remission' | 'resolved';

export type ConditionVerificationStatus =
  | 'unconfirmed'
  | 'provisional'
  | 'differential'
  | 'confirmed'
  | 'refuted'
  | 'entered-in-error';

export class CreateConditionDto {
  patientId!: string;

  hospitalId!: string;

  encounterId?: string;

  category!: ConditionCategoryType;

  diagnosisRank?: DiagnosisRank;

  codeSystem?: DiagnosisCodeSystem;

  diagnosisCode?: string;

  /** @deprecated Use diagnosisCode with codeSystem. Retained for older clients. */
  icd10Code?: string;

  description!: string;

  clinicalStatus?: ConditionClinicalStatus;

  verificationStatus?: ConditionVerificationStatus;

  severity?: string;

  onsetDateTime?: string;

  note?: string;
}
