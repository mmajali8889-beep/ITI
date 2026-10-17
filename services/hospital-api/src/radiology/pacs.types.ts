export interface OrthancDicomTags {
  PatientID?: string;
  PatientName?: string;
  StudyInstanceUID?: string;
  StudyDate?: string;
  StudyTime?: string;
  StudyDescription?: string;
  AccessionNumber?: string;
  ModalitiesInStudy?: string;
}

export interface OrthancStudy {
  ID: string;
  MainDicomTags?: OrthancDicomTags;
  PatientMainDicomTags?: OrthancDicomTags;
  Series?: string[];
}

export interface OrthancSeries {
  ID: string;
  MainDicomTags?: {
    SeriesInstanceUID?: string;
    SeriesDescription?: string;
    SeriesNumber?: string;
    Modality?: string;
    BodyPartExamined?: string;
  };
  Instances?: string[];
}
