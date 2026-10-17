 export type LabResultStatus =
  | 'registered'
  | 'preliminary'
  | 'final'
  | 'amended'
  | 'corrected'
  | 'cancelled'
  | 'entered-in-error'
  | 'unknown';

export class CreateLabResultDto {
  orderId!: string;
  specimenId!: string;
  patientId!: string;
  encounterId!: string;
  hospitalId!: string;

  testCode!: string;
  testName!: string;

  value!: number;
  unit!: string;

  referenceLow?: number;
  referenceHigh?: number;

  criticalLow?: number;
  criticalHigh?: number;

  status?: LabResultStatus;

  performedAt?: string;

  performerId?: string;
  performerName?: string;

  note?: string;
}
