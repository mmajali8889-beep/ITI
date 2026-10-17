export type EncounterType =
  | 'outpatient'
  | 'emergency'
  | 'inpatient'
  | 'day-case'
  | 'laboratory-only'
  | 'radiology-only'
  | 'procedure'
  | 'diagnostic';

export type EncounterPriority = 'routine' | 'urgent' | 'emergency';
export type ArrivalMode = 'walk-in' | 'appointment' | 'referral' | 'ambulance';
export type FinancialClass = 'cash' | 'insurance' | 'corporate' | 'government';

export class CreateEncounterDto {
  patientId!: string;

  hospitalId!: string;

  encounterType!: EncounterType;

  department?: string;

  practitionerId?: string;

  practitionerName?: string;

  reason?: string;

  priority!: EncounterPriority;

  arrivalMode!: ArrivalMode;

  referralReference?: string;

  registrationConfirmed!: boolean;

  startDateTime?: string;

  appointmentId?: string;

  financialClass?: FinancialClass;
}
