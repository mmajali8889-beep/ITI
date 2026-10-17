export interface CreatePatientRequest {
  hospitalId: string;
  hospitalCode: string;

  enterpriseMrn?: string;
  hospitalMrn?: string;

  nationalId?: string;
  passportNumber?: string;

  firstNameAr: string;
  middleNameAr?: string;
  familyNameAr: string;

  firstNameEn?: string;
  middleNameEn?: string;
  familyNameEn?: string;

  gender: 'male' | 'female' | 'other' | 'unknown';

  birthDate: string;

  phone?: string;
  email?: string;

  nationality?: string;
  preferredLanguage?: 'ar' | 'en';
  maritalStatus?: 'single' | 'married' | 'divorced' | 'widowed' | 'unknown';

  addressLine?: string;
  city?: string;
  country?: string;

  nextOfKinName?: string;
  nextOfKinRelationship?: string;
  nextOfKinPhone?: string;

  registrationConfirmed: boolean;
}

export interface PatientDuplicateMatch {
  id: string;
  name?: string;
  hospitalId?: string;
  matchedBy: string[];
}

export interface PatientDuplicateCheckResponse {
  checked: string[];
  blocking: boolean;
  matches: PatientDuplicateMatch[];
}

export interface CreatePatientResponse {
  id: string;
  resourceType: 'Patient';

  hospitalMrn?: string;
  enterpriseMrn?: string;

  nameAr?: string;
  nameEn?: string;

  gender?: string;
  birthDate?: string;

  hospitalId?: string;
}

export interface PatientProfile extends CreatePatientResponse {
  active?: boolean;
  nationalId?: string;
  passportNumber?: string;
  phone?: string;
  email?: string;
  nationality?: string;
  address?: {
    line?: string[];
    city?: string;
    country?: string;
  };
  nextOfKin?: {
    name?: { text?: string };
    relationship?: Array<{ text?: string }>;
    telecom?: Array<{ value?: string }>;
  };
  managingOrganization?: { reference?: string; display?: string };
}
