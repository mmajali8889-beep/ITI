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

export class CreateAllergyDto {
  patientId!: string;

  hospitalId!: string;

  encounterId?: string;

  type?: AllergyType;

  category?: AllergyCategory;

  code!: string;

  display!: string;

  clinicalStatus?: AllergyClinicalStatus;

  verificationStatus?: AllergyVerificationStatus;

  criticality?: AllergyCriticality;

  reaction?: string;

  severity?: AllergyReactionSeverity;

  onsetDateTime?: string;

  note?: string;
}