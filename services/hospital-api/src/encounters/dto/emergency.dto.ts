import type { ArrivalMode, EncounterPriority } from './create-encounter.dto';

export class EmergencyQuickArrivalDto {
  hospitalId!: string;
  hospitalCode!: string;
  temporaryName?: string;
  gender?: 'male' | 'female' | 'other' | 'unknown';
  approximateBirthDate?: string;
  chiefComplaint!: string;
  arrivalMode!: Extract<ArrivalMode, 'walk-in' | 'ambulance'>;
  priority!: EncounterPriority;
  practitionerId?: string;
  practitionerName?: string;
}

export class AssignEmergencyBedDto {
  hospitalId!: string;
  bedId?: string;
  bedName!: string;
}

export class EmergencyReassessmentDto {
  hospitalId!: string;
  severity!: 1 | 2 | 3 | 4 | 5;
  clinicalStatus!: 'improved' | 'unchanged' | 'deteriorated' | 'critical';
  note!: string;
  clinicianId?: string;
  clinicianName!: string;
  reassessedAt?: string;
}
