import { api } from './configureAxios';

import type {
  OrthancEchoResult,
  OrthancStationRegistryStatus,
  RadiologyStation,
  RadiologyStationListResponse,
  SaveRadiologyStationPayload,
} from '../types/radiologyStation';

export async function getRadiologyStations(
  filters: {
    hospitalId?: string;
    modality?: string;
    active?: boolean;
  } = {},
): Promise<RadiologyStationListResponse> {
  const params = Object.fromEntries(
    Object.entries(filters).filter(
      ([, value]) =>
        value !== undefined &&
        value !== null &&
        String(value).trim() !== '',
    ),
  );

  return (
    await api.get<RadiologyStationListResponse>(
      '/radiology/stations',
      {
        params,
      },
    )
  ).data;
}

export async function createRadiologyStation(
  payload:
    SaveRadiologyStationPayload,
): Promise<RadiologyStation> {
  return (
    await api.post<RadiologyStation>(
      '/radiology/stations',
      payload,
    )
  ).data;
}

export async function updateRadiologyStation(
  stationId: string,
  payload:
    Partial<SaveRadiologyStationPayload>,
): Promise<RadiologyStation> {
  return (
    await api.patch<RadiologyStation>(
      `/radiology/stations/${encodeURIComponent(
        stationId,
      )}`,
      payload,
    )
  ).data;
}

export async function deactivateRadiologyStation(
  stationId: string,
): Promise<RadiologyStation> {
  return (
    await api.delete<RadiologyStation>(
      `/radiology/stations/${encodeURIComponent(
        stationId,
      )}`,
    )
  ).data;
}


export async function getRadiologyStationOrthancStatus(
  stationId: string,
): Promise<OrthancStationRegistryStatus> {
  return (
    await api.get<OrthancStationRegistryStatus>(
      `/radiology/stations/${encodeURIComponent(
        stationId,
      )}/orthanc`,
    )
  ).data;
}

export async function syncRadiologyStationToOrthanc(
  stationId: string,
): Promise<OrthancStationRegistryStatus> {
  return (
    await api.post<OrthancStationRegistryStatus>(
      `/radiology/stations/${encodeURIComponent(
        stationId,
      )}/sync-orthanc`,
      {},
    )
  ).data;
}

export async function echoRadiologyStation(
  stationId: string,
): Promise<OrthancEchoResult> {
  return (
    await api.post<OrthancEchoResult>(
      `/radiology/stations/${encodeURIComponent(
        stationId,
      )}/echo`,
      {},
    )
  ).data;
}

export async function syncHospitalRadiologyStations(
  hospitalId: string,
) {
  return (
    await api.post(
      '/radiology/stations/sync-orthanc',
      {},
      {
        params: {
          hospitalId,
        },
      },
    )
  ).data;
}
