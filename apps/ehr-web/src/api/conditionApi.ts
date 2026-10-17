import { api } from './configureAxios';

import type {
  ClinicalStatus,
  ConditionResponse,
  ConditionsListResponse,
  CreateConditionRequest,
} from '../types/condition';

export async function createCondition(
  payload:
    CreateConditionRequest,
): Promise<ConditionResponse> {
  const response =
    await api.post<ConditionResponse>(
      '/conditions',
      payload,
    );

  return response.data;
}

export async function getEncounterConditions(
  encounterId:
    string,
  hospitalId: string,
): Promise<ConditionsListResponse> {
  const response =
    await api.get<ConditionsListResponse>(
      '/conditions',
      {
        params: {
          encounterId,
          hospitalId,
        },
      },
    );

  return response.data;
}

export async function getPatientProblems(
  patientId:
    string,
  hospitalId: string,
): Promise<ConditionsListResponse> {
  const response =
    await api.get<ConditionsListResponse>(
      `/conditions/patient/${patientId}`,
      { params: { hospitalId } },
    );

  return response.data;
}

export async function updateConditionStatus(
  conditionId:
    string,

  clinicalStatus:
    ClinicalStatus,
  hospitalId: string,
): Promise<ConditionResponse> {
  const response =
    await api.patch<ConditionResponse>(
      `/conditions/${conditionId}/status`,
      {
        clinicalStatus,
        hospitalId,
      },
    );

  return response.data;
}
