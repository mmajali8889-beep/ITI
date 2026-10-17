import { api } from './configureAxios';

import type {
  CreateRadiologyOrderRequest,
  RadiologyOrder,
  RadiologyOrdersResponse,
  RadiologyOrderStatus,
} from '../types/radiology';

export async function createRadiologyOrder(
  payload: CreateRadiologyOrderRequest,
): Promise<RadiologyOrder> {
  return (
    await api.post<RadiologyOrder>(
      '/radiology/orders',
      payload,
    )
  ).data;
}

export async function getRadiologyOrder(
  orderId: string,
): Promise<RadiologyOrder> {
  return (
    await api.get<RadiologyOrder>(
      `/radiology/orders/${orderId}`,
    )
  ).data;
}

export async function getEncounterRadiologyOrders(
  encounterId: string,
): Promise<RadiologyOrdersResponse> {
  return (
    await api.get<RadiologyOrdersResponse>(
      `/radiology/encounter/${encounterId}`,
    )
  ).data;
}

export async function getPatientRadiologyOrders(
  patientId: string,
): Promise<RadiologyOrdersResponse> {
  return (
    await api.get<RadiologyOrdersResponse>(
      `/radiology/patient/${patientId}`,
    )
  ).data;
}

export async function updateRadiologyOrderStatus(
  orderId: string,
  status: RadiologyOrderStatus,
  hospitalId: string,
): Promise<RadiologyOrder> {
  return (
    await api.patch<RadiologyOrder>(
      `/radiology/orders/${orderId}/status`,
      { status, hospitalId },
    )
  ).data;
}

export async function createRadiologyReport(
  payload: import('../types/radiology').CreateRadiologyReportRequest,
): Promise<import('../types/radiology').RadiologyReport> {
  return (await api.post('/radiology/reports', payload)).data;
}

export async function getOrderRadiologyReports(
  orderId: string,
): Promise<import('../types/radiology').RadiologyReportsResponse> {
  return (await api.get(`/radiology/reports/order/${orderId}`)).data;
}

export async function getRadiologyReport(
  reportId: string,
): Promise<import('../types/radiology').RadiologyReport> {
  return (await api.get(`/radiology/reports/${reportId}`)).data;
}

export async function updateRadiologyReport(
  reportId: string,
  payload: import('../types/radiology').UpdateRadiologyReportRequest,
): Promise<import('../types/radiology').RadiologyReport> {
  return (await api.patch(`/radiology/reports/${reportId}`, payload)).data;
}

export async function finalizeRadiologyReport(
  reportId: string,
  payload: import('../types/radiology').FinalizeRadiologyReportRequest,
): Promise<import('../types/radiology').RadiologyReport> {
  return (await api.post(`/radiology/reports/${reportId}/finalize`, payload)).data;
}

export async function amendRadiologyReport(
  reportId: string,
  payload: import('../types/radiology').UpdateRadiologyReportRequest,
): Promise<import('../types/radiology').RadiologyReport> {
  return (await api.post(`/radiology/reports/${reportId}/amend`, payload)).data;
}

export async function getEncounterRadiologyReports(
  encounterId: string,
): Promise<import('../types/radiology').RadiologyReportsResponse> {
  return (await api.get(`/radiology/reports/encounter/${encounterId}`)).data;
}

export async function getPatientRadiologyReports(
  patientId: string,
): Promise<import('../types/radiology').RadiologyReportsResponse> {
  return (await api.get(`/radiology/reports/patient/${patientId}`)).data;
}
