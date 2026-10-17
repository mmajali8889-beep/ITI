export type DispositionType = 'home' | 'admit' | 'icu' | 'operating-room' | 'transfer' | 'referred' | 'left-against-advice' | 'left-without-being-seen' | 'deceased';
export type DischargeCondition = 'stable' | 'improved' | 'unchanged' | 'deteriorated';

export class FinishEncounterDto {
  hospitalId!: string;
  disposition!: DispositionType;
  dischargeCondition!: DischargeCondition;
  dischargeInstructions?: string;
  followUpDate?: string;
  referralDestination?: string;
  confirmation!: boolean;
}
