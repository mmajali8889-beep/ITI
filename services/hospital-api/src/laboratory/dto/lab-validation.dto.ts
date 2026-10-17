export class ValidateLabResultDto {
  hospitalId!: string;
  validatorId?: string;
  validatorName!: string;
  comment?: string;
}

export class AcknowledgeCriticalResultDto {
  hospitalId!: string;
  notifiedPersonId?: string;
  notifiedPersonName!: string;
  notifiedRole!: 'doctor' | 'nurse';
  notificationMethod!: 'phone' | 'in-person' | 'system';
  readBackConfirmed!: boolean;
  acknowledgedById?: string;
  acknowledgedByName!: string;
  comment?: string;
}
