import { api } from './configureAxios';

import type {
  ClinicalNote,
  ClinicalNotesResponse,
  CreateAddendumRequest,
  CreateClinicalNoteRequest,
  UpdateClinicalNoteRequest,
} from '../types/clinicalNote';

export async function createClinicalNote(
  payload: CreateClinicalNoteRequest,
): Promise<ClinicalNote> {
  const response = await api.post<ClinicalNote>(
    '/clinical-notes',
    payload,
  );

  return response.data;
}

export async function getEncounterClinicalNotes(
  encounterId: string,
): Promise<ClinicalNotesResponse> {
  const response =
    await api.get<ClinicalNotesResponse>(
      '/clinical-notes',
      {
        params: {
          encounterId,
        },
      },
    );

  return response.data;
}

export async function getPatientClinicalNotes(
  patientId: string,
): Promise<ClinicalNotesResponse> {
  const response =
    await api.get<ClinicalNotesResponse>(
      `/clinical-notes/patient/${patientId}`,
    );

  return response.data;
}

export async function getClinicalNote(
  noteId: string,
): Promise<ClinicalNote> {
  const response =
    await api.get<ClinicalNote>(
      `/clinical-notes/${noteId}`,
    );

  return response.data;
}

export async function updateClinicalNote(
  noteId: string,
  payload: UpdateClinicalNoteRequest,
): Promise<ClinicalNote> {
  const response =
    await api.patch<ClinicalNote>(
      `/clinical-notes/${noteId}`,
      payload,
    );

  return response.data;
}

export async function signClinicalNote(
  noteId: string,
): Promise<ClinicalNote> {
  const response =
    await api.post<ClinicalNote>(
      `/clinical-notes/${noteId}/sign`,
    );

  return response.data;
}

export async function createClinicalNoteAddendum(
  noteId: string,
  payload: CreateAddendumRequest,
): Promise<ClinicalNote> {
  const response =
    await api.post<ClinicalNote>(
      `/clinical-notes/${noteId}/addendum`,
      payload,
    );

  return response.data;
}