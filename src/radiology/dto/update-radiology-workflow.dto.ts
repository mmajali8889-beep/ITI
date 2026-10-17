export type RadiologyWorkflowStatus =
  | 'ordered'
  | 'scheduled'
  | 'arrived'
  | 'exam-started'
  | 'acquired'
  | 'images-available'
  | 'reporting'
  | 'preliminary'
  | 'final';

export class UpdateRadiologyWorkflowDto {
  workflowStatus!: RadiologyWorkflowStatus;
}
