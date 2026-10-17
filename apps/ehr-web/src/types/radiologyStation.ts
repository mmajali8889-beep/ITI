export type RadiologyStationModality =
  | 'XR'
  | 'DX'
  | 'CT'
  | 'MR'
  | 'US'
  | 'MG'
  | 'NM'
  | 'PT'
  | 'OTHER';

export interface OrthancStationRegistryStatus {
  registered: boolean;
  orthancId?: string;
  skipped?: boolean;
  syncFailed?: boolean;
  reason?: string;
  error?: string;
  configuration?: {
    AET?: string;
    Host?: string;
    Port?: number;
    AllowEcho?: boolean;
    AllowFind?: boolean;
    AllowFindWorklist?: boolean;
    AllowGet?: boolean;
    AllowMove?: boolean;
    AllowStore?: boolean;
  };
}

export interface OrthancEchoResult {
  success: boolean;
  orthancId: string;
  aet: string;
  host?: string;
  port?: number;
  elapsedMs: number;
  response?: unknown;
}

export interface RadiologyStation {
  id: string;
  hospitalId: string;
  name: string;
  modality: RadiologyStationModality | string;
  aet: string;
  ipAddress?: string;
  port?: number;
  room?: string;
  active: boolean;
  updatedAt?: string;
  orthanc?: OrthancStationRegistryStatus;
}

export interface RadiologyStationListResponse {
  total: number;
  filters: {
    hospitalId?: string;
    modality?: string;
    active?: boolean;
  };
  stations: RadiologyStation[];
}

export interface SaveRadiologyStationPayload {
  hospitalId: string;
  name: string;
  modality: string;
  aet: string;
  ipAddress?: string;
  port?: number;
  room?: string;
  active?: boolean;
}
