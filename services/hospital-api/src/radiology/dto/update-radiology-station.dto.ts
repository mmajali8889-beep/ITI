export class UpdateRadiologyStationDto {
  hospitalId?: string;
  name?: string;
  modality?: 'XR' | 'DX' | 'CT' | 'MR' | 'US' | 'MG' | 'NM' | 'PT' | 'OTHER';
  aet?: string;
  ipAddress?: string;
  port?: number;
  room?: string;
  active?: boolean;
}
