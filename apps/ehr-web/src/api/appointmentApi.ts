import { api } from './configureAxios';
import type { AppointmentRecord, AppointmentStatus, AvailableSlot, CreateAppointmentRequest } from '../types/appointment';
export async function getAppointments(hospitalId:string,date:string,status='all'){return(await api.get<{total:number;appointments:AppointmentRecord[]}>('/appointments',{params:{hospitalId,date,status}})).data;}
export async function createAppointment(payload:CreateAppointmentRequest){return(await api.post<AppointmentRecord>('/appointments',payload)).data;}
export async function updateAppointmentStatus(id:string,hospitalId:string,status:AppointmentStatus,cancellationReason?:string){return(await api.patch<AppointmentRecord>(`/appointments/${id}/status`,{hospitalId,status,cancellationReason})).data;}
export async function checkInAppointment(id:string,hospitalId:string){return(await api.post<{appointment:AppointmentRecord;encounter:{id:string;patientId:string}}>(`/appointments/${id}/check-in`,{hospitalId})).data;}
export async function getAvailableSlots(hospitalId:string,date:string,specialty?:string){return(await api.get<{total:number;slots:AvailableSlot[]}>('/appointments/slots/available',{params:{hospitalId,date,specialty}})).data;}
export async function rescheduleAppointment(id:string,hospitalId:string,slotId:string,reason:string){return(await api.post<AppointmentRecord>(`/appointments/${id}/reschedule`,{hospitalId,slotId,reason})).data;}
