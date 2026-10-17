export class CreateRadiologyReportDto {
  orderId!: string;
  patientId!: string;
  encounterId!: string;
  hospitalId!: string;

  radiologistId?: string;
  radiologistName?: string;

  technique?: string;
  comparison?: string;
  findings?: string;
  impression?: string;
  recommendations?: string;
}
