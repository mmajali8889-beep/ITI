import { api } from './configureAxios';

import type {
  AssignmentFilter,
  ImagingStudiesByOrderResponse,
  RadiologistDirectoryResponse,
  RadiologyWorkflowStatus,
  RisWorklistResponse,
} from '../types/radiologyWorklist';

export interface RisWorklistFilters {
  hospitalId?: string;
  status?: string;
  workflowStatus?: string;
  modality?: string;
  priority?: string;
  radiologistId?: string;
  assignment?: AssignmentFilter;
  accessionNumber?: string;
  q?: string;
  limit?: number;
}

export async function getRisRadiologyWorklist(
  filters: RisWorklistFilters,
): Promise<RisWorklistResponse> {
  const params = Object.fromEntries(
    Object.entries(filters).filter(
      ([, value]) =>
        value !== undefined &&
        value !== null &&
        String(value).trim() !== '',
    ),
  );

  return (
    await api.get<RisWorklistResponse>(
      '/radiology/orders',
      { params },
    )
  ).data;
}

export async function updateRadiologyWorkflow(
  orderId: string,
  workflowStatus: RadiologyWorkflowStatus,
) {
  return (
    await api.patch(
      `/radiology/orders/${encodeURIComponent(
        orderId,
      )}/workflow`,
      { workflowStatus },
    )
  ).data;
}

export async function getRadiologists(
  hospitalId: string,
): Promise<RadiologistDirectoryResponse> {
  return (
    await api.get<RadiologistDirectoryResponse>(
      '/radiology/radiologists',
      {
        params: {
          hospitalId,
          active: true,
        },
      },
    )
  ).data;
}

export async function assignRadiologist(
  orderId: string,
  hospitalId: string,
  radiologistId: string,
) {
  return (
    await api.patch(
      `/radiology/orders/${encodeURIComponent(
        orderId,
      )}/assignment`,
      {
        hospitalId,
        radiologistId,
      },
    )
  ).data;
}

export async function unassignRadiologist(
  orderId: string,
  hospitalId: string,
) {
  return (
    await api.delete(
      `/radiology/orders/${encodeURIComponent(
        orderId,
      )}/assignment`,
      {
        params: { hospitalId },
      },
    )
  ).data;
}

export async function getImagingStudiesByOrder(
  orderId: string,
): Promise<ImagingStudiesByOrderResponse> {
  return (
    await api.get<ImagingStudiesByOrderResponse>(
      `/radiology/imaging-studies/order/${encodeURIComponent(
        orderId,
      )}`,
    )
  ).data;
}

export function openOhifStudy(
  studyInstanceUid: string,
) {
  const base =
    import.meta.env.VITE_OHIF_URL ||
    'http://localhost:3001';

  const url =
    `${String(base).replace(/\/+$/, '')}` +
    `/viewer?StudyInstanceUIDs=${encodeURIComponent(
      studyInstanceUid,
    )}`;

  window.open(
    url,
    '_blank',
    'noopener,noreferrer',
  );
}
