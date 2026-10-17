import { api } from './configureAxios';

export interface Bed { id: string; code?: string; name?: string; wardCode: string; wardName: string; roomNumber?: string; occupied: boolean; encounterId?: string; patientId?: string; patientName?: string }
export interface Ward { wardCode: string; wardName: string; total: number; occupied: number; available: number; beds: Bed[] }
export interface Census { totalBeds: number; occupied: number; available: number; occupancyRate: number; wards: Ward[] }
export const getCensus = async (hospitalId: string) => (await api.get<Census>('/inpatient/census', { params: { hospitalId } })).data;
export const createBed = async (payload: { hospitalId: string; wardCode: string; wardName: string; roomNumber: string; bedCode: string }) => (await api.post('/inpatient/beds', payload)).data;
export const admitToBed = async (payload: { hospitalId: string; encounterId: string; patientId: string; bedId: string; admissionReason: string; admissionRequestId: string }) => (await api.post('/inpatient/admit', payload)).data;
export const transferBed = async (payload: { hospitalId: string; encounterId: string; targetBedId: string; reason: string }) => (await api.post('/inpatient/transfer', payload)).data;
