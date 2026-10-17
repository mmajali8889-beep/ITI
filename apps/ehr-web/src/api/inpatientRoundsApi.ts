import { api } from './configureAxios';export interface RoundPatient{patientId:string;patientName:string;encounterId:string;wardCode?:string;roomNumber?:string;bedName?:string;admittedAt?:string;lastRoundAt?:string}
export interface TimelineItem{id?:string;type:string;title:string;detail?:string;status?:string;at:string;source:string}
export interface RoundTimeline{encounterId:string;patientId?:string;patientName?:string;generatedAt:string;overnightSince:string;summary:{vitals:number;labResults:number;radiologyResults:number;activeMedications:number;newEvents:number};items:TimelineItem[]}
export const getRoundPatients=async(hospitalId:string,wardCode?:string)=>(await api.get<{hospitalId:string;wards:string[];patients:RoundPatient[]}>('/inpatient-rounds/patients',{params:{hospitalId,wardCode:wardCode||undefined}})).data;
export const getRoundTimeline=async(encounterId:string,hospitalId:string)=>(await api.get<RoundTimeline>(`/inpatient-rounds/${encounterId}/timeline`,{params:{hospitalId}})).data;
export const createInpatientRound=async(payload:Record<string,unknown>)=>(await api.post('/inpatient-rounds',payload)).data;
