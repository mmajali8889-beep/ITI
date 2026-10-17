export type LabOrderStatus =
  | 'draft' | 'active' | 'on-hold' | 'revoked'
  | 'completed' | 'entered-in-error';

export type LabPriority = 'routine' | 'urgent' | 'asap' | 'stat';

export type SpecimenStatus =
  | 'available' | 'unavailable' | 'unsatisfactory' | 'entered-in-error';

export type LabResultStatus =
  | 'registered' | 'preliminary' | 'final' | 'amended'
  | 'corrected' | 'cancelled' | 'entered-in-error' | 'unknown';

export type LabInterpretation = 'N' | 'L' | 'H' | 'LL' | 'HH';

export interface LabOrder {
  id?: string;
  resourceType: 'ServiceRequest';
  status: LabOrderStatus;
  intent?: string;
  priority: LabPriority;
  testCode?: string;
  testName: string;
  patientId?: string;
  encounterId?: string;
  hospitalId?: string;
  practitionerId?: string;
  practitionerName?: string;
  authoredOn?: string;
  clinicalNote?: string;
}

export interface LabOrdersResponse { total: number; orders: LabOrder[]; }

export interface LabSpecimen {
  id?: string;
  resourceType: 'Specimen';
  status: SpecimenStatus;
  accessionNumber?: string;
  barcode?: string;
  workflowStatus?: 'collected' | 'received' | 'accepted' | 'rejected-recollection';
  acceptanceStatus?: 'pending' | 'accepted' | 'rejected';
  rejectionReason?: string;
  recollectionRequired?: boolean;
  specimenTypeCode?: string;
  specimenTypeName?: string;
  patientId?: string;
  orderId?: string;
  encounterId?: string;
  hospitalId?: string;
  collectedAt?: string;
  collectorId?: string;
  collectorName?: string;
  receivedAt?: string;
  notes: string[];
}

export interface ValidateLabResultRequest {
  hospitalId: string;
  validatorId?: string;
  validatorName: string;
  comment?: string;
}

export interface AcknowledgeCriticalLabResultRequest {
  hospitalId: string;
  notifiedPersonId?: string;
  notifiedPersonName: string;
  notifiedRole: 'doctor' | 'nurse';
  notificationMethod: 'phone' | 'in-person' | 'system';
  readBackConfirmed: true;
  acknowledgedById?: string;
  acknowledgedByName: string;
  comment?: string;
}

export interface UpdateSpecimenStatusRequest {
  status: SpecimenStatus;
  receivedAt?: string;
  acceptanceStatus?: 'pending' | 'accepted' | 'rejected';
  rejectionReason?: string;
  recollectionRequired?: boolean;
  receiverId?: string;
  receiverName?: string;
  note?: string;
}

export interface LabSpecimensResponse {
  total: number;
  specimens: LabSpecimen[];
}

export interface LabResult {
  id?: string;
  resourceType: 'Observation';
  status: LabResultStatus;
  testCode?: string;
  testName: string;
  value?: number;
  unit?: string;
  referenceLow?: number;
  referenceHigh?: number;
  criticalLow?: number;
  criticalHigh?: number;
  interpretation: LabInterpretation;
  interpretationDisplay?: string;
  patientId?: string;
  encounterId?: string;
  orderId?: string;
  specimenId?: string;
  hospitalId?: string;
  performedAt?: string;
  issuedAt?: string;
  performerId?: string;
  performerName?: string;
  notes: string[];
  technicalValidated?: boolean;
  clinicalValidated?: boolean;
  criticalAcknowledged?: boolean;
}

export interface LabResultsResponse {
  total: number;
  criticalCount: number;
  abnormalCount: number;
  results: LabResult[];
}

export interface CreateLabOrderRequest {
  patientId: string;
  encounterId: string;
  hospitalId: string;
  testCode: string;
  testName: string;
  priority?: LabPriority;
  practitionerId?: string;
  practitionerName?: string;
  clinicalNote?: string;
}

export interface CreateSpecimenRequest {
  orderId: string;
  patientId: string;
  encounterId: string;
  hospitalId: string;
  specimenTypeCode: string;
  specimenTypeName: string;
  accessionNumber?: string;
  collectedAt?: string;
  collectorId?: string;
  collectorName?: string;
  note?: string;
}

export interface CreateLabResultRequest {
  orderId: string;
  specimenId: string;
  patientId: string;
  encounterId: string;
  hospitalId: string;
  testCode: string;
  testName: string;
  value: number;
  unit: string;
  referenceLow?: number;
  referenceHigh?: number;
  criticalLow?: number;
  criticalHigh?: number;
  status?: LabResultStatus;
  performedAt?: string;
  performerId?: string;
  performerName?: string;
  note?: string;
}

export interface UpdateLabResultRequest {
  value?: number;
  unit?: string;
  referenceLow?: number;
  referenceHigh?: number;
  criticalLow?: number;
  criticalHigh?: number;
  status?: LabResultStatus;
  performedAt?: string;
  performerId?: string;
  performerName?: string;
  note?: string;
}


export type LabReportStatus =
  | 'registered' | 'partial' | 'preliminary' | 'final' | 'amended'
  | 'corrected' | 'appended' | 'cancelled' | 'entered-in-error' | 'unknown';

export interface LabReport {
  id?: string;
  resourceType: 'DiagnosticReport';
  status: LabReportStatus;
  testCode?: string;
  testName: string;
  patientId?: string;
  encounterId?: string;
  orderId?: string;
  hospitalId?: string;
  specimenIds: string[];
  resultIds: string[];
  performerId?: string;
  performerName?: string;
  verifierId?: string;
  verifierName?: string;
  effectiveAt?: string;
  issuedAt?: string;
  conclusion?: string;
}

export interface LabReportsResponse { total: number; reports: LabReport[]; }

export interface CreateLabReportRequest {
  orderId: string;
  patientId: string;
  encounterId: string;
  hospitalId: string;
  specimenIds?: string[];
  resultIds?: string[];
  performerId?: string;
  performerName?: string;
  conclusion?: string;
}

export interface FinalizeLabReportRequest {
  verifierId?: string;
  verifierName?: string;
  conclusion?: string;
}
