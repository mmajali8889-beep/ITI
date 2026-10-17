import { api } from './configureAxios';

export interface JourneyNode {
  key: string;
  label: string;
  state: 'completed' | 'current' | 'pending' | 'not-applicable';
  evidence: number;
  detail?: string;
}

export interface PatientJourney {
  patientId: string;
  encounterId: string;
  encounterStatus: string;
  encounterClass?: string;
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
