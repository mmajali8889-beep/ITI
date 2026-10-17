export type MedicationRequestStatus =
  | 'active'
  | 'on-hold'
  | 'cancelled'
  | 'completed'
  | 'stopped'
  | 'draft'
  | 'unknown';

export type MedicationRequestPriority =
  | 'routine'
  | 'urgent'
  | 'asap'
  | 'stat';

export class CreateMedicationRequestDto {
  patientId!: string;

  hospitalId!: string;

  encounterId!: string;

  practitionerId?: string;

  medicationCode!: string;

  medicationName!: string;

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

  priority?: MedicationRequestPriority;
}