import { api } from './configureAxios';export interface InventoryDashboard{hospitalId:string;summary:{items:number;totalStock:number;lowStock:number;expiringLots:number;openRequests:number;openOrders:number};alerts:Array<any>;items:Array<any>;requests:Array<any>;movements:Array<any>}
export const getInventoryDashboard=async(hospitalId:string)=>(await api.get<InventoryDashboard>('/inventory/dashboard',{params:{hospitalId}})).data;
export const createInventoryItem=async(p:Record<string,unknown>)=>(await api.post('/inventory/items',p)).data;
export const createPurchaseRequest=async(p:Record<string,unknown>)=>(await api.post('/inventory/purchase-requests',p)).data;
export const approvePurchaseRequest=async(id:string,p:Record<string,unknown>)=>(await api.post(`/inventory/purchase-requests/${id}/approve`,p)).data;
export const createPurchaseOrder=async(id:string,p:Record<string,unknown>)=>(await api.post(`/inventory/purchase-requests/${id}/purchase-order`,p)).data;
export const receiveGoods=async(id:string,p:Record<string,unknown>)=>(await api.post(`/inventory/purchase-orders/${id}/receive`,p)).data;
export const createStockMovement=async(p:Record<string,unknown>)=>(await api.post('/inventory/movements',p)).data;
