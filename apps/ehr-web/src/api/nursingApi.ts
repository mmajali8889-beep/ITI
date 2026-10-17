import { api } from './configureAxios';
export interface NursingTask{id:string;title:string;description?:string;status:string;priority?:string;dueAt?:string;overdue:boolean;patientId?:string;encounterId?:string}
export interface NursingPatient{patientId?:string;patientName:string;encounterId:string;wardCode?:string;wardName?:string;roomNumber?:string;bedName?:string;admittedAt?:string;admissionAssessmentComplete:boolean;activeCarePlan:boolean;tasks:NursingTask[];overdueCount:number;latestObservations:Array<{id:string;type?:string;at?:string;value?:string|number;unit?:string}>}
export interface NursingDashboard{generatedAt:string;hospitalId:string;wardCode:string|null;summary:{patients:number;tasksDue:number;overdue:number;assessmentsPending:number;carePlansPending:number};wards:string[];patients:NursingPatient[]}
export const getNursingDashboard=async(hospitalId:string,wardCode?:string)=>(await api.get<NursingDashboard>('/nursing/dashboard',{params:{hospitalId,wardCode:wardCode||undefined}})).data;
export const completeNursingTask=async(id:string,payload:{hospitalId:string;nurseName:string;completionNote?:string})=>(await api.post(`/nursing/tasks/${id}/complete`,payload)).data;
export const createNursingTask=async(payload:Record<string,unknown>)=>(await api.post('/nursing/tasks',payload)).data;
export const createNursingAssessment=async(payload:Record<string,unknown>)=>(await api.post('/nursing/admission-assessments',payload)).data;
export const createNursingCarePlan=async(payload:Record<string,unknown>)=>(await api.post('/nursing/care-plans',payload)).data;
export const recordNursingObservation=async(payload:Record<string,unknown>)=>(await api.post('/nursing/observations',payload)).data;
export const createNursingNote=async(payload:Record<string,unknown>)=>(await api.post('/nursing/notes',payload)).data;
