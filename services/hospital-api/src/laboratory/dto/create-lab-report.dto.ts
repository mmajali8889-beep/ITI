export class CreateLabReportDto {
  orderId!: string;
  patientId!: string;
  encounterId!: string;
  hospitalId!: string;

  specimenIds?: string[];
  resultIds?: string[];

  performerId?: string;
  performerName?: string;

  conclusion?: string;
}
