import { api } from './configureAxios';

import type {
  CreateLabOrderRequest,
  CreateLabResultRequest,
  CreateSpecimenRequest,
  LabOrder,
  LabOrdersResponse,
  LabOrderStatus,
  LabResult,
  LabResultsResponse,
  LabSpecimen,
  LabSpecimensResponse,
  UpdateLabResultRequest,
  LabReport,
  LabReportsResponse,
  CreateLabReportRequest,
  FinalizeLabReportRequest,
  UpdateSpecimenStatusRequest,
  ValidateLabResultRequest,
  AcknowledgeCriticalLabResultRequest,
} from '../types/laboratory';

export async function createLabOrder(payload: CreateLabOrderRequest): Promise<LabOrder> {
  return (await api.post<LabOrder>('/laboratory/orders', payload)).data;
}

export async function getEncounterLabOrders(encounterId: string, hospitalId: string): Promise<LabOrdersResponse> {
  return (await api.get<LabOrdersResponse>(`/laboratory/encounter/${encounterId}`, { params: { hospitalId } })).data;
}

export async function getPatientLabOrders(patientId: string, hospitalId: string): Promise<LabOrdersResponse> {
  return (await api.get<LabOrdersResponse>(`/laboratory/patient/${patientId}`, { params: { hospitalId } })).data;
}

export async function updateLabOrderStatus(orderId: string, status: LabOrderStatus, hospitalId: string): Promise<LabOrder> {
  return (await api.patch<LabOrder>(`/laboratory/orders/${orderId}/status`, { status, hospitalId })).data;
}

export async function createLabSpecimen(payload: CreateSpecimenRequest): Promise<LabSpecimen> {
  return (await api.post<LabSpecimen>('/laboratory/specimens', payload)).data;
}

export async function getOrderSpecimens(orderId: string, hospitalId: string): Promise<LabSpecimensResponse> {
  return (await api.get<LabSpecimensResponse>(`/laboratory/orders/${orderId}/specimens`, { params: { hospitalId } })).data;
}

export async function updateLabSpecimenStatus(specimenId: string, payload: UpdateSpecimenStatusRequest): Promise<LabSpecimen> {
  return (await api.patch<LabSpecimen>(`/laboratory/specimens/${specimenId}/status`, payload)).data;
}

export async function createLabResultsBatch(
  results: CreateLabResultRequest[],
): Promise<{ total: number; results: LabResult[] }> {
  return (await api.post<{ total: number; results: LabResult[] }>(
    '/laboratory/results/batch',
    { results },
  )).data;
}

export async function getOrderLabResults(orderId: string, hospitalId: string): Promise<LabResultsResponse> {
  return (await api.get<LabResultsResponse>(`/laboratory/orders/${orderId}/results`, { params: { hospitalId } })).data;
}

export async function getEncounterLabResults(encounterId: string, hospitalId: string): Promise<LabResultsResponse> {
  return (await api.get<LabResultsResponse>(`/laboratory/encounter/${encounterId}/results`, { params: { hospitalId } })).data;
}

export async function getPatientLabResults(patientId: string, hospitalId: string): Promise<LabResultsResponse> {
  return (await api.get<LabResultsResponse>(`/laboratory/patient/${patientId}/results`, { params: { hospitalId } })).data;
}

export async function updateLabResult(
  resultId: string,
  payload: UpdateLabResultRequest,
): Promise<LabResult> {
  return (await api.patch<LabResult>(`/laboratory/results/${resultId}`, payload)).data;
}

export async function validateLabResultTechnical(
  resultId: string,
  payload: ValidateLabResultRequest,
): Promise<LabResult> {
  return (await api.post<LabResult>(`/laboratory/results/${resultId}/technical-validation`, payload)).data;
}

export async function validateLabResultClinical(
  resultId: string,
  payload: ValidateLabResultRequest,
): Promise<LabResult> {
  return (await api.post<LabResult>(`/laboratory/results/${resultId}/clinical-validation`, payload)).data;
}

export async function acknowledgeCriticalLabResult(
  resultId: string,
  payload: AcknowledgeCriticalLabResultRequest,
): Promise<void> {
  await api.post(`/laboratory/results/${resultId}/critical-acknowledgement`, payload);
}

export async function createLabReport(payload: CreateLabReportRequest): Promise<LabReport> {
  return (await api.post<LabReport>('/laboratory/reports', payload)).data;
}

export async function getOrderLabReports(orderId: string, hospitalId: string): Promise<LabReportsResponse> {
  return (await api.get<LabReportsResponse>(`/laboratory/reports/order/${orderId}`, { params: { hospitalId } })).data;
}

export async function getEncounterLabReports(encounterId: string, hospitalId: string): Promise<LabReportsResponse> {
  return (await api.get<LabReportsResponse>(`/laboratory/reports/encounter/${encounterId}`, { params: { hospitalId } })).data;
}

export async function getPatientLabReports(patientId: string, hospitalId: string): Promise<LabReportsResponse> {
  return (await api.get<LabReportsResponse>(`/laboratory/reports/patient/${patientId}`, { params: { hospitalId } })).data;
}

export async function getLabReport(reportId: string): Promise<LabReport> {
  return (await api.get<LabReport>(`/laboratory/reports/${reportId}`)).data;
}

export async function finalizeLabReport(
  reportId: string,
  payload: FinalizeLabReportRequest,
): Promise<LabReport> {
  return (await api.post<LabReport>(`/laboratory/reports/${reportId}/finalize`, payload)).data;
}

export async function amendLabReport(
  reportId: string,
  payload: FinalizeLabReportRequest,
): Promise<LabReport> {
  return (await api.post<LabReport>(`/laboratory/reports/${reportId}/amend`, payload)).data;
}
