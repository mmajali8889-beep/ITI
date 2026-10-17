export class CreateSpecimenDto {
  orderId!: string;
  patientId!: string;
  encounterId!: string;
  hospitalId!: string;

  specimenTypeCode!: string;
  specimenTypeName!: string;

  accessionNumber?: string;

  collectedAt?: string;
  collectorId?: string;
  collectorName?: string;

  note?: string;
}
