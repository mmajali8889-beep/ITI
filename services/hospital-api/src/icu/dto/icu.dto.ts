export class IcuContextDto {
  hospitalId!: string;
  patientId!: string;
  encounterId!: string;
  clinicianId?: string;
  clinicianName!: string;
}
export class AdmitIcuDto extends IcuContextDto {
  icuLocationId!: string;
  icuLocationName!: string;
  admissionReason!: string;
  acuity!: 1 | 2 | 3 | 4;
}
export type IcuObservationType =
  | 'heart-rate'
  | 'blood-pressure-systolic'
  | 'blood-pressure-diastolic'
  | 'temperature'
  | 'respiratory-rate'
  | 'spo2'
  | 'cvp'
  | 'gcs'
  | 'sofa'
  | 'apache-ii'
  | 'abg-ph'
  | 'abg-pao2'
  | 'abg-paco2'
  | 'lactate'
  | 'fluid-intake'
  | 'fluid-output'
  | 'fluid-balance'
  | 'ventilator-fio2'
  | 'ventilator-peep'
  | 'ventilator-tidal-volume'
  | 'ventilator-mode';
export class RecordIcuObservationDto extends IcuContextDto {
  type!: IcuObservationType;
  value?: number;
  text?: string;
  unit?: string;
  occurredAt?: string;
}
export class RecordIcuInfusionDto extends IcuContextDto {
  medicationName!: string;
  rate!: number;
  rateUnit!: string;
  dose?: string;
  status!: 'in-progress' | 'completed' | 'stopped' | 'on-hold';
  startedAt?: string;
  endedAt?: string;
}
export class CreateIcuDailyPlanDto extends IcuContextDto {
  day!: string;
  problems!: string[];
  goals!: string[];
  interventions!: string[];
  reviewAt?: string;
}
export class IcuDispositionDto {
  hospitalId!: string;
  clinicianId?: string;
  clinicianName!: string;
  destination!: 'ward' | 'another-icu' | 'discharge' | 'death';
  destinationLocationId?: string;
  destinationName?: string;
  note!: string;
}
