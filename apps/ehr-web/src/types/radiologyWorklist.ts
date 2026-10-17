import type {
  RadiologyModality,
  RadiologyOrder,
  RadiologyOrderStatus,
  RadiologyPriority,
} from './radiology';

export type RadiologyWorkflowStatus =
  | 'ordered'
  | 'scheduled'
  | 'arrived'
  | 'exam-started'
  | 'acquired'
  | 'images-available'
  | 'reporting'
  | 'preliminary'
  | 'final';

export type AssignmentFilter =
  | 'assigned'
  | 'unassigned';

export interface RisRadiologyOrder
  extends RadiologyOrder {
  accessionNumber?: string;
  workflowStatus?: RadiologyWorkflowStatus;
  workflowUpdatedAt?: string;
  patientName?: string;

  radiologistId?: string;
  radiologistName?: string;
  assignedAt?: string;
  assignedById?: string;
  assignedByName?: string;
}

export interface RadiologistDirectoryItem {
  practitionerId?: string;
  practitionerRoleId?: string;
  hospitalId?: string;
  hospitalName?: string;
  active: boolean;
  practitionerActive?: boolean;
  roleActive?: boolean;
  roleCode?: string;
  roleName?: string;
  specialtyName?: string;
  displayName: string;
  givenName?: string;
  familyName?: string;
  employeeId?: string;
  licenseNumber?: string;
  phone?: string;
  email?: string;
}

export interface RadiologistDirectoryResponse {
  hospitalId: string;
  hospitalName?: string;
  total: number;
  radiologists: RadiologistDirectoryItem[];
}

export interface RisWorklistSummary {
  total: number;
  active: number;
  urgent: number;
  imagesAvailable: number;
  reporting: number;
  final: number;
  assigned: number;
  unassigned: number;
}

export interface RisWorklistResponse {
  total: number;
  returned: number;
  limit: number;
  summary: RisWorklistSummary;
  filters: {
    hospitalId?: string;
    patientId?: string;
    encounterId?: string;
    status?: RadiologyOrderStatus;
    workflowStatus?: RadiologyWorkflowStatus;
    modality?: RadiologyModality;
    priority?: RadiologyPriority;
    radiologistId?: string;
    assignment?: AssignmentFilter;
    accessionNumber?: string;
    q?: string;
  };
  orders: RisRadiologyOrder[];
}

export interface ImagingStudyListItem {
  id?: string;
  status?: string;
  patientId?: string;
  encounterId?: string;
  orderId?: string;
  hospitalId?: string;
  studyInstanceUid?: string;
  accessionNumber?: string;
  started?: string;
  description?: string;
  modalities?: string[];
  numberOfSeries?: number;
  numberOfInstances?: number;
  pacsStudyUrl?: string;
}

export interface ImagingStudiesByOrderResponse {
  orderId: string;
  count: number;
  studies: ImagingStudyListItem[];
}
