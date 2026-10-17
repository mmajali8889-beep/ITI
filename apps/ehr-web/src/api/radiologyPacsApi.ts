import { api } from './configureAxios';

export interface PacsSeries {
  orthancSeriesId: string;
  seriesInstanceUid?: string;
  seriesNumber?: number;
  modality?: string;
  description?: string;
  bodyPartExamined?: string;
  numberOfInstances: number;
}

export interface PacsStudy {
  orthancStudyId: string;
  studyInstanceUid?: string;
  accessionNumber?: string;
  patientId?: string;
  patientName?: string;
  studyDate?: string;
  studyTime?: string;
  studyDescription?: string;
  modalities: string[];
  numberOfSeries: number;
  numberOfInstances: number;
  series: PacsSeries[];
  dicomWebStudyUrl?: string;
  viewerUrl?: string;
}

export interface PacsStudiesResponse {
  count: number;
  studies: PacsStudy[];
}

export async function getPacsStudies(): Promise<PacsStudiesResponse> {
  return (
    await api.get<PacsStudiesResponse>('/radiology/pacs/studies')
  ).data;
}

export function openPacsStudy(study: PacsStudy): void {
  if (!study.studyInstanceUid) {
    return;
  }

  const viewerBase = String(import.meta.env.VITE_OHIF_URL || 'http://localhost:3001').replace(/\/+$/, '');
  const url =
    study.viewerUrl ||
    `${viewerBase}/viewer?StudyInstanceUIDs=${encodeURIComponent(
      study.studyInstanceUid,
    )}`;

  window.open(url, '_blank', 'noopener,noreferrer');
}
