export type RadiologyModality =
  | 'XR'
  | 'CT'
  | 'MR'
  | 'US'
  | 'MG'
  | 'NM'
  | 'PT'
  | 'DX'
  | 'OTHER';

export type RadiologyPriority =
  | 'routine'
  | 'urgent'
  | 'asap'
  | 'stat';

export type RadiologyOrderStatus =
  | 'draft'
  | 'active'
  | 'on-hold'
  | 'revoked'
  | 'completed'
  | 'entered-in-error';

export interface RadiologyOrder {
  id: string;
  status: RadiologyOrderStatus;
  intent?: string;
  priority: RadiologyPriority;

  patientId?: string;
  encounterId?: string;
  hospitalId?: string;

  examCode?: string;
  examName: string;

  modality: RadiologyModality;

  bodySiteCode?: string;
  bodySiteName?: string;

  clinicalIndication?: string;
  clinicalQuestion?: string;

  requesterId?: string;
  requesterName?: string;

  authoredOn?: string;
  notes?: string[];
}

export interface RadiologyOrdersResponse {
  total: number;
  orders: RadiologyOrder[];
}

export interface CreateRadiologyOrderRequest {
  patientId: string;
  encounterId: string;
  hospitalId: string;

  examCode: string;
  examName: string;

  modality: RadiologyModality;

  bodySiteCode?: string;
  bodySiteName?: string;

  priority?: RadiologyPriority;

  clinicalIndication?: string;
  clinicalQuestion?: string;

  requesterId?: string;
  requesterName?: string;

  notes?: string;
}

export type RadiologyReportStatus =
  | 'registered'
  | 'partial'
  | 'preliminary'
  | 'final'
  | 'amended'
  | 'corrected'
  | 'appended'
  | 'cancelled'
  | 'entered-in-error'
  | 'unknown';

export interface RadiologyReport {
  id: string;
  resourceType?: 'DiagnosticReport';
  status: RadiologyReportStatus;
  examCode?: string;
  examName: string;
  patientId?: string;
  encounterId?: string;
  orderId?: string;
  hospitalId?: string;
  modality?: string;
  technique?: string;
  comparison?: string;
  findings?: string;
  impression?: string;
  recommendations?: string;
  radiologistId?: string;
  radiologistName?: string;
  verifierId?: string;
  verifierName?: string;
  verifiedAt?: string;
  effectiveAt?: string;
  issuedAt?: string;
}

export interface RadiologyReportsResponse {
  total: number;
  reports: RadiologyReport[];
}

export interface CreateRadiologyReportRequest {
  orderId: string;
  patientId: string;
  encounterId: string;
  hospitalId: string;
  radiologistId?: string;
  radiologistName?: string;
  technique?: string;
  comparison?: string;
  findings?: string;
  impression?: string;
  recommendations?: string;
}

export interface UpdateRadiologyReportRequest {
  technique?: string;
  comparison?: string;
  findings?: string;
  impression?: string;
  recommendations?: string;
  radiologistId?: string;
  radiologistName?: string;
}

export interface FinalizeRadiologyReportRequest {
  verifierId?: string;
  verifierName?: string;
  impression?: string;
  verificationConfirmed: boolean;
}
