export class CreateDischargeDto {
  hospitalId!: string;
  patientId!: string;
  encounterId!: string;
  physicianId?: string;
  physicianName!: string;
  decisionReason!: string;
}
export class ReconcileDischargeDto {
  hospitalId!: string;
  clinicianName!: string;
  homeMedications!: string[];
  stoppedMedications?: string[];
  changedMedications?: string[];
}
export class DischargeSummaryDto {
  hospitalId!: string;
  authorName!: string;
  admissionReason!: string;
  finalDiagnoses!: string[];
  procedures!: string[];
  hospitalCourse!: string;
  investigations!: string;
  dischargeMedications!: string[];
  conditionAtDischarge!: string;
  instructions!: string;
  followUp!: string;
}
export class DischargeClearanceDto {
  hospitalId!: string;
  department!: 'billing' | 'pharmacy' | 'nursing';
  cleared!: boolean;
  actorName!: string;
  note?: string;
}
export class FinalizeDischargeDto {
  hospitalId!: string;
  actorName!: string;
  confirmation!: boolean;
}
