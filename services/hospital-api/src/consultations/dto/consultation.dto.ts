export class CreateConsultationDto {
  hospitalId!: string;
  patientId!: string;
  encounterId!: string;
  specialty!: string;
  reason!: string;
  clinicalQuestion!: string;
  priority!: 'routine' | 'urgent' | 'stat';
  requesterId?: string;
  requesterName!: string;
}
export class AcceptConsultationDto {
  hospitalId!: string;
  consultantId?: string;
  consultantName!: string;
}
export class CompleteConsultationDto extends AcceptConsultationDto {
  assessment!: string;
  consultationNote!: string;
  recommendations!: string[];
  followUpRequired?: boolean;
}
export class CancelConsultationDto {
  hospitalId!: string;
  actorName!: string;
  reason!: string;
}
