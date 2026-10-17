export class FinalizeRadiologyReportDto {
  verifierId?: string;
  verifierName?: string;
  verificationConfirmed!: boolean;

  impression?: string;
}
