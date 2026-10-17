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
  hospitalId: string,
): Promise<ClinicalNotesResponse> {
  const response =
    await api.get<ClinicalNotesResponse>(
      '/clinical-notes',
      {
        params: {
          encounterId,
          hospitalId,
        },
      },
    );

  return response.data;
}

export async function getPatientClinicalNotes(
  patientId: string,
  hospitalId: string,
): Promise<ClinicalNotesResponse> {
  const response =
    await api.get<ClinicalNotesResponse>(
      `/clinical-notes/patient/${patientId}`,
      { params: { hospitalId } },
    );

  return response.data;
}

export async function getClinicalNote(
  noteId: string,
  hospitalId: string,
): Promise<ClinicalNote> {
  const response =
    await api.get<ClinicalNote>(
      `/clinical-notes/${noteId}`,
      { params: { hospitalId } },
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
  hospitalId: string,
): Promise<ClinicalNote> {
  const response =
    await api.post<ClinicalNote>(
      `/clinical-notes/${noteId}/sign`,
      { hospitalId, signatureConfirmed: true },
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
