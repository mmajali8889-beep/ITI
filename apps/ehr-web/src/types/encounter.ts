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
export type DispositionType = 'home' | 'admit' | 'icu' | 'operating-room' | 'transfer' | 'referred' | 'left-against-advice' | 'left-without-being-seen' | 'deceased';
export type DischargeCondition = 'stable' | 'improved' | 'unchanged' | 'deteriorated';

export interface FinishEncounterRequest {
  hospitalId: string;
  disposition: DispositionType;
  dischargeCondition: DischargeCondition;
  dischargeInstructions?: string;
  followUpDate?: string;
  referralDestination?: string;
  confirmation: boolean;
}

export interface CreateEncounterRequest {
  patientId: string;
  hospitalId: string;

  encounterType: EncounterType;

  department?: string;

  practitionerId?: string;
  practitionerName?: string;

  reason?: string;
  priority: EncounterPriority;
  arrivalMode: ArrivalMode;
  referralReference?: string;
  appointmentId?: string;
  financialClearanceStatus?: string;
  financialClass?: FinancialClass;
  coverageId?: string;
  emergencyBedId?: string;
  emergencyBedName?: string;
  disposition?: DispositionType;
  dischargeCondition?: DischargeCondition;
  dischargeInstructions?: string;
  followUpDate?: string;
  referralDestination?: string;
  registrationConfirmed: boolean;

  startDateTime?: string;
}

export interface EncounterResponse {
  id: string;

  resourceType: 'Encounter';

  status?: string;

  encounterType?: string;
  encounterTypeDisplay?: string;

  classCode?: string;
  classDisplay?: string;

  patientId?: string;
  patientName?: string;
  hospitalId?: string;

  department?: string;

  practitionerId?: string;
  practitionerName?: string;

  reason?: string;
  priority?: EncounterPriority;
  arrivalMode?: ArrivalMode;
  visitNumber?: string;
  financialClearanceStatus?: string;
  financialClass?: FinancialClass;
  referralReference?: string;

  startDateTime?: string;
  endDateTime?: string;
}

export interface EncounterListResponse {
  total: number;

  encounters: EncounterResponse[];
}
