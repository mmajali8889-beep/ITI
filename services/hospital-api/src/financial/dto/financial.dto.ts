export type FinancialClass = 'cash' | 'insurance' | 'corporate' | 'government';
export type CoverageStatus =
  'active' | 'cancelled' | 'draft' | 'entered-in-error';

export class CreateCoverageDto {
  hospitalId!: string;
  patientId!: string;
  payerId!: string;
  payerName!: string;
  subscriberId!: string;
  planName?: string;
  policyNumber?: string;
  relationship?: 'self' | 'spouse' | 'child' | 'parent' | 'other';
  networkId?: string;
  networkName?: string;
  deductibleAmount?: number;
  copayAmount?: number;
  coveragePercentage?: number;
  currency?: string;
  preAuthorizationRequired?: boolean;
  validFrom!: string;
  validTo?: string;
}

export class UpdateCoverageStatusDto {
  hospitalId!: string;
  status!: CoverageStatus;
  reason?: string;
}

export class CheckEligibilityDto {
  hospitalId!: string;
  patientId!: string;
  coverageId!: string;
  encounterId?: string;
  serviceCodes?: string[];
  providerNetworkId?: string;
  estimatedAmount?: number;
  currency?: string;
}

export class RecordEligibilityDecisionDto {
  hospitalId!: string;
  eligibility!: 'eligible' | 'ineligible';
  benefitsVerified?: boolean;
  networkStatus?: 'in-network' | 'out-of-network' | 'not-applicable';
  authorizationRequired?: boolean;
  authorizationNumber?: string;
  authorizationLimit?: number;
  deductibleRemaining?: number;
  copayAmount?: number;
  coveragePercentage?: number;
  patientResponsibility?: number;
  denialReason?: string;
  validUntil?: string;
}

export class AssignFinancialClassDto {
  hospitalId!: string;
  patientId!: string;
  financialClass!: FinancialClass;
  coverageId?: string;
  sponsorId?: string;
  sponsorName?: string;
}
