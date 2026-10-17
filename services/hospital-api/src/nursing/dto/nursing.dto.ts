export class NursingContextDto {
  hospitalId!: string;
  patientId!: string;
  encounterId!: string;
  nurseId?: string;
  nurseName!: string;
}
export class NursingAdmissionAssessmentDto extends NursingContextDto {
  assessment!: Record<string, unknown>;
  confirmed!: boolean;
}
export class CreateCarePlanDto extends NursingContextDto {
  title!: string;
  goals!: string[];
  interventions!: string[];
  reviewAt?: string;
}
export type NursingObservationType =
  | 'iv-fluid'
  | 'intake'
  | 'output'
  | 'pain'
  | 'fall-risk'
  | 'pressure-injury-risk'
  | 'monitoring';
export class RecordNursingObservationDto extends NursingContextDto {
  type!: NursingObservationType;
  value?: number;
  unit?: string;
  score?: number;
  text?: string;
  occurredAt?: string;
}
export class CreateNursingTaskDto extends NursingContextDto {
  title!: string;
  description?: string;
  dueAt!: string;
  priority?: 'routine' | 'urgent' | 'asap' | 'stat';
}
export class CompleteNursingTaskDto {
  hospitalId!: string;
  nurseId?: string;
  nurseName!: string;
  completionNote?: string;
}
export class CreateNursingNoteDto extends NursingContextDto {
  note!: string;
}
