import { api } from './configureAxios';
export interface AdminOverview{hospitalId:string;generatedAt:string;counts:Record<string,number>;supportedKinds:string[];defaultRoles:string[]}
export const getAdminOverview=async(hospitalId:string)=>(await api.get<AdminOverview>('/administration/overview',{params:{hospitalId}})).data;
export const getAdminCatalog=async(hospitalId:string,kind:string)=>(await api.get('/administration/catalog',{params:{hospitalId,kind}})).data as{items:Array<any>};
export const createAdminCatalog=async(payload:Record<string,unknown>)=>(await api.post('/administration/catalog',payload)).data;
export const getAdminRoles=async(hospitalId:string)=>(await api.get('/administration/roles',{params:{hospitalId}})).data as{items:Array<any>};
export const createAdminRole=async(payload:Record<string,unknown>)=>(await api.post('/administration/roles',payload)).data;
export const getAdminUsers=async(hospitalId:string)=>(await api.get('/administration/users',{params:{hospitalId}})).data as{items:Array<any>};
export const createAdminUser=async(payload:Record<string,unknown>)=>(await api.post('/administration/users',payload)).data;
export const assignAdminRole=async(payload:Record<string,unknown>)=>(await api.post('/administration/role-assignments',payload)).data;
export const getAuditEvents=async(hospitalId:string)=>(await api.get('/audit/events',{params:{hospitalId,limit:200}})).data as{events:Array<any>};
export interface JourneyPathwaySettings{hospitalId:string;milestones:Array<{key:string;label:string;locked:boolean}>;pathways:Array<{code:string;label:string;required:string[];defaults:string[];customized:boolean}>}
export const getJourneyPathways=async(hospitalId:string)=>(await api.get<JourneyPathwaySettings>('/administration/journey-pathways',{params:{hospitalId}})).data;
export const saveJourneyPathways=async(hospitalId:string,pathways:Record<string,string[]|null>)=>(await api.put<JourneyPathwaySettings>('/administration/journey-pathways',{hospitalId,pathways})).data;
