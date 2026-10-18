import { api } from './configureAxios';

export interface JourneyNode {
  key: string;
  label: string;
  // 'optional': not done, but not mandatory on this encounter's care pathway.
  state: 'completed' | 'current' | 'pending' | 'optional' | 'not-applicable';
  evidence: number;
  detail?: string;
  required?: boolean;
}

export interface PatientJourney {
  patientId: string;
  encounterId: string;
  encounterStatus: string;
  encounterClass?: string;
  pathway?: { code: string; label: string; source: 'default' | 'hospital' };
  completion: number;
  currentStage: string;
  branches: { entry: string; disposition: string };
  nodes: JourneyNode[];
}

export const getPatientJourney = async (
  patientId: string,
  encounterId: string,
  hospitalId: string,
) =>
  (
    await api.get<PatientJourney>(
      `/patient-journey/${patientId}/encounters/${encounterId}`,
      { params: { hospitalId } },
    )
  ).data;
