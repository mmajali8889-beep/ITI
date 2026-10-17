import { api } from './configureAxios';
import type { FinancialClass } from '../types/encounter';

export async function assignEncounterFinancialClass(encounterId: string, payload: { hospitalId: string; patientId: string; financialClass: FinancialClass; coverageId?: string; sponsorId?: string; sponsorName?: string }) {
  return (await api.post(`/financial/encounters/${encounterId}/classification`, payload)).data;
}
