export type ClinicalServiceType =
  | 'procedure'
  | 'consultation'
  | 'admission-request'
  | 'follow-up'
  | 'sick-leave'
  | 'document'
  | 'other';
export type ClinicalServiceStatus =
  'active' | 'on-hold' | 'completed' | 'revoked';

export class CreateClinicalServiceOrderDto {
  hospitalId!: string;
  patientId!: string;
  encounterId!: string;
  serviceType!: ClinicalServiceType;
  serviceCode!: string;
  serviceName!: string;
  priority?: 'routine' | 'urgent' | 'asap' | 'stat';
  requesterId?: string;
  requesterName?: string;
  performerId?: string;
  performerName?: string;
  clinicalNote?: string;
}

export class UpdateClinicalServiceStatusDto {
  hospitalId!: string;
  status!: ClinicalServiceStatus;
  performerId?: string;
  performerName?: string;
  completionNote?: string;
}
