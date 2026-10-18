import { api } from './configureAxios';
export type HimStatus='pending-review'|'deficient'|'signed'|'locked'|'archived';
export interface HimRecord{id:string;status:string;workflowStatus:HimStatus;authorName?:string;signedAt?:string;lockedAt?:string;archivedAt?:string;retentionUntil?:string}
export interface HimQueueItem{encounterId:string;patientId?:string;patientName?:string;visitNumber?:string;completedAt?:string;workflowStatus:HimStatus;openDeficiencies:number;record?:HimRecord}
export interface HimQueue{hospitalId:string;total:number;summary:Record<string,number>;items:HimQueueItem[]}
export interface RecordDetail{encounterId:string;records:HimRecord[];deficiencies:Array<{id:string;status:string;code:string;description:string;ownerName?:string;resolution?:string}>}
export const getHimQueue=async(hospitalId:string)=>(await api.get<HimQueue>('/medical-records/queue',{params:{hospitalId}})).data;
export const getRecordDetail=async(encounterId:string,hospitalId:string)=>(await api.get<RecordDetail>(`/medical-records/encounters/${encounterId}`,{params:{hospitalId}})).data;
export const assessRecord=async(encounterId:string,hospitalId:string)=>(await api.post(`/medical-records/encounters/${encounterId}/assess`,{hospitalId})).data;
export const signRecord=async(encounterId:string,p:Record<string,unknown>)=>(await api.post(`/medical-records/encounters/${encounterId}/close`,p)).data;
export const resolveDeficiency=async(taskId:string,p:Record<string,unknown>)=>(await api.patch(`/medical-records/deficiencies/${taskId}/resolve`,p)).data;
export const lockRecord=async(recordId:string,p:Record<string,unknown>)=>(await api.post(`/medical-records/${recordId}/lock`,p)).data;
export const archiveRecord=async(recordId:string,p:Record<string,unknown>)=>(await api.post(`/medical-records/${recordId}/archive`,p)).data;
export interface PortalLogin{id:string;username?:string;active:boolean;createdAt?:string}
export interface PortalAccess{patientId:string;hospitalId:string;status:'none'|'active'|'disabled';logins:PortalLogin[]}
export type PortalAccessCreated=PortalAccess&{username:string;temporaryPassword?:string}
export const getPortalAccess=async(patientId:string,hospitalId:string)=>(await api.get<PortalAccess>(`/medical-records/portal-access/${patientId}`,{params:{hospitalId}})).data;
export const createPortalAccess=async(patientId:string,p:{hospitalId:string;username:string;password?:string})=>(await api.post<PortalAccessCreated>(`/medical-records/portal-access/${patientId}`,p)).data;
export const disablePortalAccess=async(patientId:string,hospitalId:string)=>(await api.post<PortalAccess>(`/medical-records/portal-access/${patientId}/disable`,{hospitalId})).data;
