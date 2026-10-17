export type ReviewTargetType = 'DiagnosticReport' | 'Observation' | 'Procedure';

export class RecordResultReviewDto {
  hospitalId!: string;
  patientId!: string;
  encounterId!: string;
  targetType!: ReviewTargetType;
  targetId!: string;
  practitionerId!: string;
  practitionerName!: string;
  decision!: 'acknowledged' | 'action-required';
  note?: string;
  critical!: boolean;
}
