import { api } from './configureAxios';

import type {
  CreateEncounterRequest,
  EncounterListResponse,
  EncounterResponse,
  FinishEncounterRequest,
} from '../types/encounter';

export async function createEncounter(
  payload: CreateEncounterRequest,
): Promise<EncounterResponse> {
  const response =
    await api.post<EncounterResponse>(
      '/encounters',
      payload,
    );

  return response.data;
}

export async function getEncounter(
  encounterId: string,
  hospitalId: string,
): Promise<EncounterResponse> {
  const response =
    await api.get<EncounterResponse>(
      `/encounters/${encounterId}`,
      { params: { hospitalId } },
    );

  return response.data;
}

export async function getPatientEncounters(
  patientId: string,
  hospitalId?: string,
): Promise<EncounterListResponse> {
  const response =
    await api.get<EncounterListResponse>(
      '/encounters',
      {
        params: {
          patientId,
          hospitalId,
        },
      },
    );

  return response.data;
}

export async function finishEncounter(
  encounterId: string,
  payload: FinishEncounterRequest,
): Promise<EncounterResponse> {
  const response =
    await api.patch<EncounterResponse>(
      `/encounters/${encounterId}/finish`,
      payload,
    );

  return response.data;
}

export async function getEmergencyBoard(hospitalId: string, status = 'all'): Promise<EncounterListResponse> {
  const response = await api.get<EncounterListResponse>('/encounters/emergency/board', { params: { hospitalId, status } });
  return response.data;
}

export async function createEmergencyQuickArrival(payload: { hospitalId: string; hospitalCode: string; temporaryName?: string; gender?: 'male'|'female'|'other'|'unknown'; chiefComplaint: string; arrivalMode: 'walk-in'|'ambulance'; priority: 'routine'|'urgent'|'emergency'; practitionerName?: string }) {
  return (await api.post('/encounters/emergency/quick-arrival', payload)).data as { patient:{id:string;temporaryMrn:string;name:string}; encounter:EncounterResponse };
}
