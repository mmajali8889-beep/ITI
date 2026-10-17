export type MedicationRequestStatus =
  | 'active'
  | 'on-hold'
  | 'cancelled'
  | 'completed'
  | 'stopped'
  | 'draft'
  | 'unknown';

export type MedicationPriority =
  | 'routine'
  | 'urgent'
  | 'asap'
  | 'stat';

export interface CreateMedicationRequest {
  patientId: string;
  hospitalId: string;
  encounterId: string;

  practitionerId?: string;

  medicationCode: string;
  medicationName: string;

  dose?: number;
  doseUnit?: string;

  route?: string;
  frequency?: string;

  durationDays?: number;

  quantity?: number;
  quantityUnit?: string;

  instructions?: string;

  asNeeded?: boolean;

  startDate?: string;
  endDate?: string;

  priority?: MedicationPriority;
}

export interface MedicationResponse {
  id?: string;

  resourceType?: 'MedicationRequest';

  status?: MedicationRequestStatus;

  intent?: string;

  priority?: MedicationPriority;

  medicationCode?: string;
  medicationName?: string;

  patientId?: string;
  encounterId?: string;
  hospitalId?: string;

  requester?: string;

  authoredOn?: string;

  instructions?: string;

  route?: string;

  dose?: number;
  doseUnit?: string;

  frequency?: string;

  asNeeded?: boolean;

  durationDays?: number;

  quantity?: number;
  quantityUnit?: string;

  startDate?: string;
  endDate?: string;
}

export interface MedicationListResponse {
  total: number;

  medications: MedicationResponse[];
}

export interface AllergyWarning {
  allergyId?: string;

  allergen?: string;

  criticality?: string;

  reaction?: string;

  severity?: string;

  verificationStatus?: string;
}

export interface MedicationAllergyError {
  message?: string;

  allergyAlert?: boolean;

  medication?: string;

  warnings?: AllergyWarning[];
}