import { api } from './configureAxios';
import type { Hospital } from '../types/hospital';

export async function getHospitals(): Promise<Hospital[]> {
  const response = await api.get<Hospital[]>('/hospitals');
  return response.data;
}