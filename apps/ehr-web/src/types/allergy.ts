export type AllergyClinicalStatus =
  | 'active'
  | 'inactive'
  | 'resolved';

export type AllergyVerificationStatus =
  | 'unconfirmed'
  | 'confirmed'
  | 'refuted'
  | 'entered-in-error';

export type AllergyCriticality =
  | 'low'
  | 'high'
  | 'unable-to-assess';

export type AllergyCategory =
  | 'food'
  | 'medication'
  | 'environment'
  | 'biologic';

export type AllergyType =
  | 'allergy'
  | 'intolerance';

export type AllergyReactionSeverity =
  | 'mild'
  | 'moderate'
  | 'severe';

export interface CreateAllergyRequest {
  patientId: string;

  hospitalId: string;

  encounterId?: string;

  type?: AllergyType;

  category?: AllergyCategory;

  code: string;

  display: string;

  clinicalStatus?: AllergyClinicalStatus;

  verificationStatus?: AllergyVerificationStatus;

  criticality?: AllergyCriticality;

  reaction?: string;

  severity?: AllergyReactionSeverity;

  onsetDateTime?: string;

  note?: string;
}

export interface AllergyResponse {
  id?: string;

  resourceType?: 'AllergyIntolerance';

  patientId?: string;

  encounterId?: string;

  hospitalId?: string;

  clinicalStatus?: AllergyClinicalStatus;

  verificationStatus?: AllergyVerificationStatus;

  type?: AllergyType;

  category?: AllergyCategory;

  criticality?: AllergyCriticality;

  code?: string;

  display?: string;

  reaction?: string;

  severity?: AllergyReactionSeverity;

  onsetDateTime?: string;

  recordedDate?: string;

  note?: string;
}

export interface AllergyListResponse {
  total: number;

  allergies: AllergyResponse[];
}