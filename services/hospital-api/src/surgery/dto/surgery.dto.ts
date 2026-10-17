export type SurgeryStage =
  | 'requested'
  | 'authorized'
  | 'scheduled'
  | 'pre-op-assessed'
  | 'anesthesia-assessed'
  | 'consented'
  | 'pre-op-check-complete'
  | 'in-or'
  | 'who-check-complete'
  | 'anesthesia-started'
  | 'procedure-in-progress'
  | 'procedure-completed'
  | 'pacu'
  | 'completed'
  | 'cancelled';
export class CreateSurgeryCaseDto {
  hospitalId!: string;
  patientId!: string;
  encounterId!: string;
  procedureCode?: string;
  procedureName!: string;
  indication!: string;
  priority?: 'routine' | 'urgent' | 'asap' | 'stat';
  surgeonId?: string;
  surgeonName!: string;
  assistantName?: string;
  anesthesiologistName?: string;
  nurseNames?: string[];
}
export class TransitionSurgeryDto {
  hospitalId!: string;
  stage!: SurgeryStage;
  actorId?: string;
  actorName!: string;
  note?: string;
  authorizationNumber?: string;
  operatingRoomId?: string;
  operatingRoomName?: string;
  scheduledStart?: string;
  scheduledEnd?: string;
  checklist?: Record<string, boolean | string>;
  consentType?: string;
  implants?: Array<{ name: string; lotNumber?: string; serialNumber?: string }>;
  medications?: string[];
  consumables?: string[];
  complications?: string[];
  destination?: 'ward' | 'icu' | 'discharge';
}
