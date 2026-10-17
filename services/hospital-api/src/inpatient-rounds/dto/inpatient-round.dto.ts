export type InpatientOrderType =
  | 'laboratory'
  | 'radiology'
  | 'procedure'
  | 'consultation'
  | 'medication'
  | 'other';
export class RoundOrderDto {
  type!: InpatientOrderType;
  code?: string;
  name!: string;
  priority?: 'routine' | 'urgent' | 'asap' | 'stat';
  instructions?: string;
}
export class CreateInpatientRoundDto {
  hospitalId!: string;
  patientId!: string;
  encounterId!: string;
  physicianId?: string;
  physicianName!: string;
  overnightEvents?: string;
  physicalExamination!: string;
  progressNote!: string;
  assessment!: string;
  plan!: string;
  orders?: RoundOrderDto[];
}
