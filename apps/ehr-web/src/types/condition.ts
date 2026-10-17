export type ConditionCategory =
  | 'encounter-diagnosis'
  | 'problem-list-item';

export type DiagnosisRank =
  | 'primary'
  | 'secondary';

export type DiagnosisCodeSystem = 'ICD-10' | 'ICD-11';

export type ClinicalStatus =
  | 'active'
  | 'recurrence'
  | 'relapse'
  | 'inactive'
  | 'remission'
  | 'resolved';

export type VerificationStatus =
  | 'unconfirmed'
  | 'provisional'
  | 'differential'
  | 'confirmed'
  | 'refuted'
  | 'entered-in-error';

export interface CreateConditionRequest {
  patientId: string;

  hospitalId: string;

  encounterId?: string;

  category: ConditionCategory;

  diagnosisRank?: DiagnosisRank;

  codeSystem: DiagnosisCodeSystem;

  diagnosisCode: string;

  icd10Code?: string;

  description: string;

  clinicalStatus?: ClinicalStatus;

  verificationStatus?: VerificationStatus;

  severity?: string;

  onsetDateTime?: string;

  note?: string;
}

export interface ConditionResponse {
  id: string;

  resourceType: 'Condition';

  patientId?: string;

  encounterId?: string;

  hospitalId?: string;

  category?: ConditionCategory;

  diagnosisRank?: DiagnosisRank;

  codeSystem?: DiagnosisCodeSystem;

  diagnosisCode?: string;

  icd10Code?: string;

  description?: string;

  clinicalStatus?: ClinicalStatus;

  verificationStatus?: VerificationStatus;

  severity?: string;

  onsetDateTime?: string;

  recordedDate?: string;

  abatementDateTime?: string;

  note?: string;
}

export interface ConditionsListResponse {
  total: number;

  conditions: ConditionResponse[];
}
