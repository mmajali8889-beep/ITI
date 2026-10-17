import { api } from './configureAxios';

import type {
  AllergyClinicalStatus,
  AllergyListResponse,
  AllergyResponse,
  CreateAllergyRequest,
} from '../types/allergy';

export async function createAllergy(
  payload: CreateAllergyRequest,
): Promise<AllergyResponse> {
  const response =
    await api.post<AllergyResponse>(
      '/allergies',
      payload,
    );

  return response.data;
}

export async function getPatientAllergies(
  patientId: string,
): Promise<AllergyListResponse> {
  const response =
    await api.get<AllergyListResponse>(
      `/allergies/patient/${patientId}`,
    );

  return response.data;
}

export async function getAllergyById(
  allergyId: string,
): Promise<AllergyResponse> {
  const response =
    await api.get<AllergyResponse>(
      `/allergies/${allergyId}`,
    );

  return response.data;
}

export async function updateAllergyStatus(
  allergyId: string,
  clinicalStatus: AllergyClinicalStatus,
): Promise<AllergyResponse> {
  const response =
    await api.patch<AllergyResponse>(
      `/allergies/${allergyId}/status`,
      {
        clinicalStatus,
      },
    );

  return response.data;
}