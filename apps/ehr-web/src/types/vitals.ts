export interface CreateVitalsRequest {
  patientId: string;

  encounterId: string;

  hospitalId: string;

  systolic?: number;

  diastolic?: number;

  pulse?: number;

  temperature?: number;

  respiratoryRate?: number;

  spo2?: number;

  weight?: number;

  height?: number;

  painScore?: number;

  triageLevel: 1 | 2 | 3 | 4 | 5;
  chiefComplaint: string;
  consciousness?: 'alert' | 'voice' | 'pain' | 'unresponsive';
  mobility?: 'independent' | 'assisted' | 'stretcher' | 'wheelchair';
  isolationRequired?: boolean;
  triageNotes?: string;
  allergyCheck: 'reviewed-no-known' | 'reviewed-known' | 'unable';
  medicationHistory: 'reviewed' | 'unavailable';
  currentMedications?: string;
  riskFlags?: Array<'fall' | 'sepsis' | 'suicide' | 'violence' | 'infection' | 'deterioration' | 'other'>;
  riskAssessmentNotes?: string;
  triageConfirmed: boolean;

  effectiveDateTime?: string;
}

export interface VitalResult {
  id?: string;

  type?: string;

  code?: string;

  label?: string;

  value?:
    number |
    string;

  unit?: string;

  systolic?: number;

  diastolic?: number;

  effectiveDateTime?: string;
  issued?: string;
  encounterId?: string;
}

export interface VitalsResponse {
  total?: number;

  count?: number;

  effectiveDateTime?: string;

  vitals:
    VitalResult[];

  triage?: {
    level: number;
    critical: boolean;
    alerts: string[];
    doctorQueueTaskId?: string;
    doctorQueueStatus?: string;
  };
}
