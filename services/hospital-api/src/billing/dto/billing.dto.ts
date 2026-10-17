export type BillingCurrency = 'SAR' | 'USD' | 'EUR';
export class CreateChargeDto { hospitalId!: string; patientId!: string; encounterId!: string; code!: string; description!: string; quantity!: number; unitPrice!: number; currency?: BillingCurrency; sourceReference?: string; }
export class CreateInvoiceDto { hospitalId!: string; patientId!: string; encounterId!: string; paymentTerms?: string; }
export class RecordPaymentDto { hospitalId!: string; amount!: number; currency?: BillingCurrency; method!: 'cash' | 'card' | 'bank-transfer' | 'insurance'; reference!: string; }
export class SubmitClaimDto { hospitalId!: string; patientId!: string; encounterId!: string; invoiceId!: string; coverageId!: string; payerId!: string; authorizationNumber?: string; }
export class AdjudicateClaimDto { hospitalId!: string; outcome!: 'complete' | 'partial' | 'error'; approvedAmount!: number; denialReason?: string; adjudicationReference!: string; }
export type BillableCategory='consultation'|'laboratory'|'radiology'|'medication'|'room-bed'|'surgery'|'consumable'|'procedure';
export class CreateTariffDto { hospitalId!:string; category!:BillableCategory; code!:string; description!:string; unitPrice!:number; currency?:BillingCurrency; }
export class CaptureEncounterChargesDto { hospitalId!:string; }
