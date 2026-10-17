export class UpdateRadiologyReportDto {
  technique?: string;
  comparison?: string;
  findings?: string;
  impression?: string;
  recommendations?: string;

  radiologistId?: string;
  radiologistName?: string;
}
