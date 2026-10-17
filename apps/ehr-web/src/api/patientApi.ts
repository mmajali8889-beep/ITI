import { api } from './configureAxios';

import type {
  CreatePatientRequest,
  CreatePatientResponse,
  PatientProfile,
  PatientDuplicateCheckResponse,
} from '../types/patient';

export interface PatientSearchResult {
  id: string;
  resourceType: string;

  active?: boolean;

  hospitalId?: string;

  hospitalMrn?: string;
  enterpriseMrn?: string;

  nationalId?: string;
  passportNumber?: string;

  nameAr?: string;
  nameEn?: string;

  gender?: string;
  birthDate?: string;

  phone?: string;
  nationality?: string;
}

export interface PatientSearchResponse {
  total: number;
  patients: PatientSearchResult[];
}

export async function createPatient(
  patient: CreatePatientRequest,
): Promise<CreatePatientResponse> {
  const response =
    await api.post<CreatePatientResponse>(
      '/patients',
      patient,
    );

  return response.data;
}

export async function getPatient(
  patientId: string,
  hospitalId: string,
): Promise<PatientProfile> {
  const response =
    await api.get<PatientProfile>(
      `/patients/${patientId}`,
      { params: { hospitalId } },
    );

  return response.data;
}

export async function searchPatients(params: {
  hospitalId: string;
  search?: string;
  mrn?: string;
  nationalId?: string;
  phone?: string;
}): Promise<PatientSearchResponse> {
  const response =
    await api.get<PatientSearchResponse>(
      '/patients',
      {
        params,
      },
    );

  return response.data;
}

export async function checkPatientDuplicates(params: {
  hospitalId: string;
  hospitalCode: string;
  hospitalMrn?: string;
  nationalId?: string;
  passportNumber?: string;
  phone?: string;
}): Promise<PatientDuplicateCheckResponse> {
  const response = await api.get<PatientDuplicateCheckResponse>(
    '/patients/registration/duplicates',
    { params },
  );
  return response.data;
}
