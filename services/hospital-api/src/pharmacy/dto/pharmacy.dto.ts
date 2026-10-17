export class ReceiveStockDto {
  hospitalId!: string;
  medicationCode!: string;
  medicationName!: string;
  form!: string;
  strength?: string;
  unit!: string;
  lotNumber!: string;
  expirationDate!: string;
  quantity!: number;
  reorderLevel!: number;
}
export class VerifyPrescriptionDto {
  hospitalId!: string;
  pharmacistId?: string;
  pharmacistName!: string;
  allergyChecked!: boolean;
  interactionChecked!: boolean;
  doseChecked!: boolean;
  stockChecked!: boolean;
  decision!: 'approved' | 'rejected' | 'clarification-required';
  issues?: string;
}
export class DispenseDto {
  hospitalId!: string;
  medicationRequestId!: string;
  quantity!: number;
  pharmacistName!: string;
  counselingProvided!: boolean;
  counselingNotes?: string;
  wardId?: string;
  wardName?: string;
  notes?: string;
}
export class ReturnDispenseDto {
  hospitalId!: string;
  quantity!: number;
  reason!: string;
  pharmacistName!: string;
}
export class AdministerMedicationDto {
  hospitalId!: string;
  medicationRequestId!: string;
  patientId!: string;
  encounterId!: string;
  status!: 'given' | 'held' | 'refused' | 'missed';
  nurseId?: string;
  nurseName!: string;
  scheduledAt?: string;
  administeredAt?: string;
  dose?: number;
  doseUnit?: string;
  route?: string;
  reason?: string;
  patientBarcode?: string;
  medicationBarcode?: string;
  notes?: string;
}
