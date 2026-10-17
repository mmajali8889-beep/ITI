export class CreatePatientDto {
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

  photoBase64?: string;
  photoContentType?: 'image/jpeg' | 'image/png' | 'image/webp';

  insurance?: {
    payerId: string;
    payerName: string;
    subscriberId: string;
    planName?: string;
    policyNumber?: string;
    validFrom: string;
    validTo?: string;
  };

  knownAllergies?: Array<{
    code?: string;
    substance: string;
    criticality?: 'low' | 'high' | 'unable-to-assess';
    reaction?: string;
  }>;

  registrationConfirmed: boolean;
}
