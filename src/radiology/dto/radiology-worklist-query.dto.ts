export class RadiologyWorklistQueryDto {
  hospitalId?: string;
  patientId?: string;
  encounterId?: string;

  status?: string;
  workflowStatus?: string;
  modality?: string;
  priority?: string;

  radiologistId?: string;
  assignment?: 'assigned' | 'unassigned';

  accessionNumber?: string;
  q?: string;

  limit?: string;
}
