import { api } from './configureAxios';

import type {
  CreateVitalsRequest,
  VitalsResponse,
} from '../types/vitals';

export async function createVitals(
  payload:
    CreateVitalsRequest,
): Promise<VitalsResponse> {
  const response =
    await api.post<VitalsResponse>(
      '/vitals',
      payload,
    );

  return response.data;
}

export async function getEncounterVitals(
  encounterId:
    string,
): Promise<VitalsResponse> {
  const response =
    await api.get<VitalsResponse>(
      '/vitals',
      {
        params: {
          encounterId,
        },
      },
    );

  return response.data;
}

export async function getPatientVitals(
  patientId: string,
): Promise<VitalsResponse> {
  const response =
    await api.get<VitalsResponse>(
      '/vitals',
      {
        params: {
          patientId,
        },
      },
    );

  return response.data;
}