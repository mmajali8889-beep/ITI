export type ImagingStudyStatus =
  'registered' | 'available' | 'cancelled' | 'entered-in-error' | 'unknown';

export interface CreateImagingSeriesDto {
  uid: string;
  modality: string;
  description?: string;
  number?: number;
  numberOfInstances?: number;
  bodySiteCode?: string;
  bodySiteName?: string;
}

export class CreateImagingStudyDto {
  patientId!: string;
  encounterId?: string;
  hospitalId!: string;
  orderId?: string;
  studyInstanceUid!: string;
  accessionNumber?: string;
  status?: ImagingStudyStatus;
  modality!: string;
  description?: string;
  bodySiteCode?: string;
  bodySiteName?: string;
  started?: string;
  numberOfSeries?: number;
  numberOfInstances?: number;
  series?: CreateImagingSeriesDto[];
  pacsStudyUrl?: string;
  notes?: string;
}
