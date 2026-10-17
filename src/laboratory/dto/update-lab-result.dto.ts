import type { LabResultStatus } from './create-lab-result.dto';

export class UpdateLabResultDto {
  value?: number;
  unit?: string;

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
