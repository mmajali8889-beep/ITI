import { api } from './configureAxios';

import type {
  CreateMedicationRequest,
  MedicationListResponse,
  MedicationRequestStatus,
  MedicationResponse,
} from '../types/medication';

export async function createMedication(
  payload:
    CreateMedicationRequest,
): Promise<MedicationResponse> {
  const response =
    await api.post<MedicationResponse>(
      '/medications',
      payload,
    );

  return response.data;
}

export async function getEncounterMedications(
  encounterId: string,
): Promise<MedicationListResponse> {
  const response =
    await api.get<MedicationListResponse>(
      '/medications',
      {
        params: {
          encounterId,
        },
      },
    );

  return response.data;
}

export async function getPatientMedications(
  patientId: string,
): Promise<MedicationListResponse> {
  const response =
    await api.get<MedicationListResponse>(
      `/medications/patient/${patientId}`,
    );

  return response.data;
}

export async function updateMedicationStatus(
  medicationRequestId: string,
  status: MedicationRequestStatus,
): Promise<MedicationResponse> {
  const response =
    await api.patch<MedicationResponse>(
      `/medications/${medicationRequestId}/status`,
      {
        status,
      },
    );

  return response.data;
}