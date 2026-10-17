import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { ChargeItem, ChargeItemDefinition, Claim, ClaimResponse, Coverage, Encounter, Invoice, MedicationDispense, Money, PaymentNotice, PaymentReconciliation, Procedure, ServiceRequest } from '@medplum/fhirtypes';
import { randomUUID } from 'node:crypto';
import { MedplumService } from '../medplum/medplum.service';
import { AdjudicateClaimDto, BillableCategory, CaptureEncounterChargesDto, CreateChargeDto, CreateInvoiceDto, CreateTariffDto, RecordPaymentDto, SubmitClaimDto } from './dto/billing.dto';

const BASE = 'https://hospital-ehr.local/fhir/StructureDefinition';
const HOSPITAL = `${BASE}/billing-hospital`, ENCOUNTER = `${BASE}/billing-encounter`, PAID = `${BASE}/invoice-paid`, BALANCE = `${BASE}/invoice-balance`, METHOD = `${BASE}/payment-method`, SOURCE = `${BASE}/charge-source`, CLAIM_INVOICE = `${BASE}/claim-invoice`;
const TARIFF_CATEGORY=`${BASE}/tariff-category`;
const CLAIM_OUTCOME=`${BASE}/claim-outcome`,CLAIM_PENDING=`${BASE}/claim-adjudication-pending`,RECEIPT=`${BASE}/receipt-number`;

@Injectable()
export class BillingService {
  constructor(private readonly medplumService: MedplumService) {}

  async createCharge(dto: CreateChargeDto) {
    this.required(dto, ['hospitalId', 'patientId', 'encounterId', 'code', 'description']);
    if (!Number.isFinite(dto.quantity) || dto.quantity <= 0 || !Number.isFinite(dto.unitPrice) || dto.unitPrice < 0) throw new BadRequestException('Quantity and unit price must be valid positive values');
    await this.encounter(dto.encounterId, dto.patientId, dto.hospitalId);
    const currency = dto.currency ?? 'SAR';
    const item: ChargeItem = { resourceType: 'ChargeItem', status: 'billable', code: { coding: [{ system: 'https://hospital-ehr.local/CodeSystem/billing-services', code: dto.code.trim(), display: dto.description.trim() }], text: dto.description.trim() }, subject: { reference: `Patient/${dto.patientId}` }, context: { reference: `Encounter/${dto.encounterId}` }, occurrenceDateTime: new Date().toISOString(), quantity: { value: dto.quantity }, priceOverride: { value: dto.unitPrice, currency }, identifier: [{ system: `https://hospital-ehr.local/charge/${dto.hospitalId}`, value: `CHG-${randomUUID().slice(0, 8).toUpperCase()}` }], extension: [{ url: HOSPITAL, valueReference: { reference: `Organization/${dto.hospitalId}` } }, ...(dto.sourceReference ? [{ url: SOURCE, valueReference: { reference: dto.sourceReference } }] : [])] };
    return this.mapCharge(await this.medplumService.getClient().createResource<ChargeItem>(item));
  }

  async createInvoice(dto: CreateInvoiceDto) {
    this.required(dto, ['hospitalId', 'patientId', 'encounterId']);
    await this.encounter(dto.encounterId, dto.patientId, dto.hospitalId);
    const existing = await this.medplumService.getClient().searchResources('Invoice', { subject: `Patient/${dto.patientId}`, _count: '200' });
    if (existing.some((item) => this.hospitalId(item) === dto.hospitalId && this.ext(item, ENCOUNTER) === dto.encounterId && item.status !== 'cancelled' && item.status !== 'entered-in-error')) throw new ConflictException('An invoice already exists for this encounter');
    const allCharges = await this.medplumService.getClient().searchResources('ChargeItem', { context: `Encounter/${dto.encounterId}`, _count: '500' });
    const charges = allCharges.filter((item) => this.hospitalId(item) === dto.hospitalId && item.status === 'billable');
    if (!charges.length) throw new ConflictException('No billable charges exist for this encounter');
    const currency = charges[0].priceOverride?.currency ?? 'SAR';
    if (charges.some((item) => (item.priceOverride?.currency ?? 'SAR') !== currency)) throw new ConflictException('Invoice charges must use one currency');
    const total = this.totalCharges(charges);
    const invoice: Invoice = { resourceType: 'Invoice', status: 'issued', identifier: [{ system: `https://hospital-ehr.local/invoice/${dto.hospitalId}`, value: `INV-${randomUUID().slice(0, 8).toUpperCase()}` }], subject: { reference: `Patient/${dto.patientId}` }, date: new Date().toISOString(), issuer: { reference: `Organization/${dto.hospitalId}` }, lineItem: charges.map((item, index) => ({ sequence: index + 1, chargeItemReference: { reference: `ChargeItem/${item.id}` } })), totalNet: { value: total, currency }, totalGross: { value: total, currency }, paymentTerms: dto.paymentTerms, extension: [{ url: HOSPITAL, valueReference: { reference: `Organization/${dto.hospitalId}` } }, { url: ENCOUNTER, valueString: dto.encounterId }, { url: PAID, valueMoney: { value: 0, currency } }, { url: BALANCE, valueMoney: { value: total, currency } }] };
    const created = await this.medplumService.getClient().createResource<Invoice>(invoice);
    for (const charge of charges) { charge.status = 'billed'; await this.medplumService.getClient().updateResource(charge); }
    return this.mapInvoice(created);
  }

  async recordPayment(invoiceId: string, dto: RecordPaymentDto) {
    this.required(dto, ['hospitalId', 'method', 'reference']);
    if (!Number.isFinite(dto.amount) || dto.amount <= 0) throw new BadRequestException('Payment amount must be positive');
    const invoice = await this.invoice(invoiceId, dto.hospitalId);
    if (!['issued', 'balanced'].includes(invoice.status) || invoice.status === 'balanced') throw new ConflictException('Invoice cannot accept a payment');
    const currency = invoice.totalGross?.currency ?? 'SAR';
    if ((dto.currency ?? currency) !== currency) throw new BadRequestException('Payment currency must match invoice currency');
    const paid = this.money(invoice, PAID), total = invoice.totalGross?.value ?? 0, updatedPaid = paid + dto.amount;
    if (updatedPaid > total) throw new ConflictException('Payment exceeds the outstanding invoice balance');
    const receiptNumber=`RCT-${randomUUID().slice(0,8).toUpperCase()}`;
    const reconciliation: PaymentReconciliation = { resourceType: 'PaymentReconciliation', status: 'active', created: new Date().toISOString(), outcome: 'complete', paymentDate: new Date().toISOString().slice(0, 10), paymentAmount: { value: dto.amount, currency }, paymentIdentifier: { system: `https://hospital-ehr.local/payment/${dto.hospitalId}`, value: dto.reference.trim() }, requestor: { reference: `Organization/${dto.hospitalId}` }, extension: [{ url: HOSPITAL, valueReference: { reference: `Organization/${dto.hospitalId}` } }, { url: METHOD, valueCode: dto.method }, { url: RECEIPT, valueString:receiptNumber }, { url: `${BASE}/payment-invoice`, valueReference: { reference: `Invoice/${invoiceId}` } }] };
    // Reserve the payment on the invoice first with a guarded update: a parallel
    // payment that read the same balance loses here instead of paying twice.
    invoice.extension = [...(invoice.extension ?? []).filter((item) => ![PAID, BALANCE].includes(item.url)), { url: PAID, valueMoney: { value: updatedPaid, currency } }, { url: BALANCE, valueMoney: { value: total - updatedPaid, currency } }];
    if (updatedPaid === total) invoice.status = 'balanced';
    const updated = await this.medplumService.updateIfUnchanged<Invoice>(invoice);
    let payment: PaymentReconciliation;
    try {
      payment = await this.medplumService.getClient().createResource<PaymentReconciliation>(reconciliation);
      const notice: PaymentNotice = { resourceType: 'PaymentNotice', status: 'active', created: new Date().toISOString(), request: { reference: `Invoice/${invoiceId}` }, provider: { reference: `Organization/${dto.hospitalId}` }, payment: { reference: `PaymentReconciliation/${payment.id}` }, paymentDate: reconciliation.paymentDate, recipient: { reference: `Organization/${dto.hospitalId}` }, amount: reconciliation.paymentAmount, paymentStatus: { text: 'Cleared' }, extension: [{ url: HOSPITAL, valueReference: { reference: `Organization/${dto.hospitalId}` } }] };
      await this.medplumService.getClient().createResource<PaymentNotice>(notice);
    } catch (error) {
      await this.releasePayment(invoiceId, dto.hospitalId, dto.amount).catch(() => undefined);
      throw error;
    }
    return { invoice: this.mapInvoice(updated), paymentId: payment.id, receiptNumber, amount: dto.amount, method: dto.method, reference: dto.reference };
  }

  /** Undoes a reserved payment when its receipt could not be recorded. */
  private async releasePayment(invoiceId: string, hospitalId: string, amount: number) {
    const invoice = await this.invoice(invoiceId, hospitalId);
    const currency = invoice.totalGross?.currency ?? 'SAR', total = invoice.totalGross?.value ?? 0, paid = Math.max(0, this.money(invoice, PAID) - amount);
    invoice.extension = [...(invoice.extension ?? []).filter((item) => ![PAID, BALANCE].includes(item.url)), { url: PAID, valueMoney: { value: paid, currency } }, { url: BALANCE, valueMoney: { value: total - paid, currency } }];
    invoice.status = 'issued';
    await this.medplumService.updateIfUnchanged<Invoice>(invoice);
  }

  async submitClaim(dto: SubmitClaimDto) {
    this.required(dto, ['hospitalId', 'patientId', 'encounterId', 'invoiceId', 'coverageId', 'payerId']);
    await this.encounter(dto.encounterId, dto.patientId, dto.hospitalId);
    const invoice = await this.invoice(dto.invoiceId, dto.hospitalId);
    if (this.ext(invoice, ENCOUNTER) !== dto.encounterId || invoice.subject?.reference !== `Patient/${dto.patientId}`) throw new NotFoundException('Invoice not found');
    const coverage = await this.coverage(dto.coverageId, dto.patientId, dto.hospitalId);
    if (coverage.payor?.[0]?.reference !== `Organization/${dto.payerId}`) throw new BadRequestException('Coverage payer does not match claim payer');
    const prior = await this.medplumService.getClient().searchResources('Claim', { patient: `Patient/${dto.patientId}`, _count: '200' });
    if (prior.some((item) => this.hospitalId(item) === dto.hospitalId && this.ext(item, CLAIM_INVOICE) === dto.invoiceId && item.status === 'active')) throw new ConflictException('An active claim already exists for this invoice');
    const claim: Claim = { resourceType: 'Claim', status: 'active', type: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/claim-type', code: 'professional' }] }, use: 'claim', patient: { reference: `Patient/${dto.patientId}` }, created: new Date().toISOString(), insurer: { reference: `Organization/${dto.payerId}`, display: coverage.payor?.[0]?.display }, provider: { reference: `Organization/${dto.hospitalId}` }, priority: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/processpriority', code: 'normal' }] }, insurance: [{ sequence: 1, focal: true, coverage: { reference: `Coverage/${dto.coverageId}` }, ...(dto.authorizationNumber ? { preAuthRef: [dto.authorizationNumber] } : {}) }], item: invoice.lineItem?.map((line, index) => ({ sequence: index + 1, productOrService: { text: `Invoice line ${line.sequence}` }, servicedDate: invoice.date?.slice(0, 10), encounter: [{ reference: `Encounter/${dto.encounterId}` }] })), total: invoice.totalGross, identifier: [{ system: `https://hospital-ehr.local/claim/${dto.hospitalId}`, value: `CLM-${randomUUID().slice(0, 8).toUpperCase()}` }], extension: [{ url: HOSPITAL, valueReference: { reference: `Organization/${dto.hospitalId}` } }, { url: CLAIM_INVOICE, valueString: dto.invoiceId }] };
    return this.mapClaim(await this.medplumService.getClient().createResource<Claim>(claim));
  }

  async adjudicate(claimId: string, dto: AdjudicateClaimDto) {
    this.required(dto, ['hospitalId', 'outcome', 'adjudicationReference']);
    if (!['complete', 'partial', 'error'].includes(dto.outcome) || !Number.isFinite(dto.approvedAmount) || dto.approvedAmount < 0) throw new BadRequestException('Invalid adjudication');
    if (dto.outcome === 'error' && !dto.denialReason?.trim()) throw new BadRequestException('Denial reason is required');
    let claim = await this.claim(claimId, dto.hospitalId);
    // The claim-outcome extension is written last and marks the adjudication as committed. A ClaimResponse
    // without it means an earlier attempt stopped part way (for example the insurance payment failed), so a
    // retry with the same details resumes from there instead of being rejected.
    if (this.ext(claim, CLAIM_OUTCOME)) throw new ConflictException('Claim is already adjudicated');
    const reference = dto.adjudicationReference.trim(), currency: NonNullable<Money['currency']> = claim.total?.currency ?? 'SAR';
    // Claim the adjudication with a guarded update before doing any work, so of
    // two parallel requests only one proceeds; the other gets a 409.
    const pending = this.ext(claim, CLAIM_PENDING);
    if (pending) {
      const prior = JSON.parse(pending) as { outcome: string; approvedAmount: number; reference: string };
      if (prior.outcome !== dto.outcome || prior.reference !== reference || prior.approvedAmount !== dto.approvedAmount) throw new ConflictException('Claim has an unfinished adjudication with different details; retry with the original outcome, amount and reference');
    }
    claim.extension = [...(claim.extension ?? []).filter((e) => e.url !== CLAIM_PENDING), { url: CLAIM_PENDING, valueString: JSON.stringify({ outcome: dto.outcome, approvedAmount: dto.approvedAmount, reference, at: new Date().toISOString() }) }];
    claim = await this.medplumService.updateIfUnchanged<Claim>(claim);
    const responses = (await this.medplumService.getClient().searchResources('ClaimResponse', { request: `Claim/${claimId}`, _count: '20' })).filter((item) => this.hospitalId(item) === dto.hospitalId);
    let responseId: string | undefined;
    if (responses.length) {
      const prior = responses[0];
      if (prior.outcome !== dto.outcome || prior.preAuthRef !== reference || prior.total?.[0]?.amount?.value !== dto.approvedAmount) throw new ConflictException('Claim has an unfinished adjudication with different details; retry with the original outcome, approved amount and adjudication reference');
      responseId = prior.id;
    } else {
      const response: ClaimResponse = { resourceType: 'ClaimResponse', status: 'active', type: claim.type, use: claim.use, patient: claim.patient, created: new Date().toISOString(), insurer: claim.insurer ?? { reference: 'Organization/unknown' }, requestor: claim.provider, request: { reference: `Claim/${claimId}` }, outcome: dto.outcome, disposition: dto.denialReason ?? 'Adjudicated', preAuthRef: reference, total: [{ category: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/adjudication', code: 'benefit' }] }, amount: { value: dto.approvedAmount, currency } }], extension: [{ url: HOSPITAL, valueReference: { reference: `Organization/${dto.hospitalId}` } }] };
      responseId = (await this.medplumService.getClient().createResource<ClaimResponse>(response)).id;
    }
    const reconciledInvoice = dto.approvedAmount > 0 ? await this.reconcileInsurancePayment(this.ext(claim, CLAIM_INVOICE)!, dto.hospitalId, dto.approvedAmount, currency, reference) : undefined;
    claim.extension=[...(claim.extension??[]).filter(e=>e.url!==CLAIM_OUTCOME&&e.url!==CLAIM_PENDING),{url:CLAIM_OUTCOME,valueString:JSON.stringify({outcome:dto.outcome,approvedAmount:dto.approvedAmount,denialReason:dto.denialReason,responseId,at:new Date().toISOString()})}];
    claim = await this.medplumService.updateIfUnchanged<Claim>(claim);
    return { claim: this.mapClaim(claim), responseId, outcome: dto.outcome, approvedAmount: dto.approvedAmount, denialReason: dto.denialReason,invoice:reconciledInvoice };
  }

  /** Posts the insurer payment once per adjudication reference, repairing the invoice if a prior attempt recorded the payment but stopped before updating it. */
  private async reconcileInsurancePayment(invoiceId: string, hospitalId: string, amount: number, currency: NonNullable<Money['currency']>, reference: string) {
    const invoice = await this.invoice(invoiceId, hospitalId);
    const payments = (await this.medplumService.getClient().searchResources('PaymentReconciliation', { requestor: `Organization/${hospitalId}`, _count: '1000' })).filter((p) => p.status === 'active' && p.extension?.some((e) => e.url === `${BASE}/payment-invoice` && e.valueReference?.reference === `Invoice/${invoiceId}`));
    const alreadyPosted = payments.some((p) => p.paymentIdentifier?.value === reference && p.extension?.some((e) => e.url === METHOD && e.valueCode === 'insurance'));
    if (!alreadyPosted) return invoice.status === 'balanced' ? this.mapInvoice(invoice) : (await this.recordPayment(invoiceId, { hospitalId, amount, currency: currency as CreateChargeDto['currency'], method: 'insurance', reference })).invoice;
    const recordedPaid = payments.reduce((sum, p) => sum + (p.paymentAmount?.value ?? 0), 0), total = invoice.totalGross?.value ?? 0;
    if (this.money(invoice, PAID) >= recordedPaid) return this.mapInvoice(invoice);
    const paid = Math.min(recordedPaid, total), invoiceCurrency = invoice.totalGross?.currency ?? currency;
    invoice.extension = [...(invoice.extension ?? []).filter((item) => ![PAID, BALANCE].includes(item.url)), { url: PAID, valueMoney: { value: paid, currency: invoiceCurrency } }, { url: BALANCE, valueMoney: { value: total - paid, currency: invoiceCurrency } }];
    if (paid === total) invoice.status = 'balanced';
    return this.mapInvoice(await this.medplumService.getClient().updateResource<Invoice>(invoice));
  }

  async createTariff(dto:CreateTariffDto){
    this.required(dto,['hospitalId','category','code','description']);
    if(!['consultation','laboratory','radiology','medication','room-bed','surgery','consumable','procedure'].includes(dto.category)||!Number.isFinite(dto.unitPrice)||dto.unitPrice<0)throw new BadRequestException('Valid tariff category and price are required');
    const existing=await this.medplumService.getClient().searchResources('ChargeItemDefinition',{status:'active',_count:'500'});
    if(existing.some(item=>this.hospitalId(item)===dto.hospitalId&&item.code?.coding?.some(c=>c.code===dto.code)))throw new ConflictException('Active tariff code already exists');
    const tariff:ChargeItemDefinition={resourceType:'ChargeItemDefinition',url:`https://hospital-ehr.local/tariff/${dto.hospitalId}/${encodeURIComponent(dto.code)}`,version:'1',status:'active',title:dto.description.trim(),date:new Date().toISOString(),publisher:`Organization/${dto.hospitalId}`,code:{coding:[{system:'https://hospital-ehr.local/CodeSystem/billing-services',code:dto.code.trim(),display:dto.description.trim()}]},propertyGroup:[{priceComponent:[{type:'base',amount:{value:dto.unitPrice,currency:dto.currency??'SAR'}}]}],extension:[{url:HOSPITAL,valueReference:{reference:`Organization/${dto.hospitalId}`}},{url:TARIFF_CATEGORY,valueString:dto.category}]};
    return this.mapTariff(await this.medplumService.getClient().createResource(tariff));
  }

  async tariffs(hospitalId:string){if(!hospitalId)throw new BadRequestException('Hospital ID is required');const items=await this.medplumService.getClient().searchResources('ChargeItemDefinition',{status:'active',_count:'500'});return{items:items.filter(i=>this.hospitalId(i)===hospitalId).map(i=>this.mapTariff(i))};}

  async capture(encounterId:string,dto:CaptureEncounterChargesDto){
    if(!dto.hospitalId)throw new BadRequestException('Hospital ID is required');const encounter=await this.readEncounter(encounterId);if(encounter.serviceProvider?.reference!==`Organization/${dto.hospitalId}`)throw new NotFoundException('Encounter not found');const patientId=encounter.subject?.reference?.replace('Patient/','');if(!patientId)throw new ConflictException('Encounter patient is missing');
    const client=this.medplumService.getClient();const[definitions,existing,services,medications,procedures]=await Promise.all([client.searchResources('ChargeItemDefinition',{status:'active',_count:'500'}),client.searchResources('ChargeItem',{context:`Encounter/${encounterId}`,_count:'1000'}),client.searchResources('ServiceRequest',{encounter:`Encounter/${encounterId}`,_count:'1000'}),client.searchResources('MedicationDispense',{subject:`Patient/${patientId}`,_count:'1000'}),client.searchResources('Procedure',{encounter:`Encounter/${encounterId}`,_count:'500'})]);const tariffs=definitions.filter(d=>this.hospitalId(d)===dto.hospitalId),seen=new Set(existing.map(c=>c.extension?.find(e=>e.url===SOURCE)?.valueReference?.reference).filter(Boolean));const candidates:Array<{category:BillableCategory;source:string;quantity:number;description:string}>=[];
    candidates.push({category:'consultation',source:`Encounter/${encounterId}`,quantity:1,description:'Encounter / consultation'});
    for(const s of services){const code=s.category?.[0]?.coding?.[0]?.code??'';const category:BillableCategory=code==='laboratory'?'laboratory':code==='imaging'||s.category?.some(c=>c.text?.toLowerCase().includes('radiology'))?'radiology':code==='consultation'?'consultation':'procedure';candidates.push({category,source:`ServiceRequest/${s.id}`,quantity:1,description:s.code?.text??'Clinical service'});}
    for(const m of medications.filter(m=>m.context?.reference===`Encounter/${encounterId}`||m.authorizingPrescription?.some(r=>r.reference))){candidates.push({category:'medication',source:`MedicationDispense/${m.id}`,quantity:m.quantity?.value??1,description:m.medicationCodeableConcept?.text??'Dispensed medication'});}
    for(const p of procedures){const surgery=p.extension?.some(e=>e.url===`${BASE}/surgery-case`);candidates.push({category:surgery?'surgery':'procedure',source:`Procedure/${p.id}`,quantity:1,description:p.code?.text??'Procedure'});let content:{consumables?:string[]}={};try{content=JSON.parse(p.note?.[0]?.text??'{}')}catch{}for(let i=0;i<(content.consumables?.length??0);i++)candidates.push({category:'consumable',source:`Procedure/${p.id}#consumable-${i}`,quantity:1,description:content.consumables![i]});}
    if(encounter.class?.code==='IMP'){const start=Date.parse(encounter.period?.start??new Date().toISOString()),end=Date.parse(encounter.period?.end??new Date().toISOString()),days=Math.max(1,Math.ceil((end-start)/86400000));candidates.push({category:'room-bed',source:`Encounter/${encounterId}#bed-days`,quantity:days,description:'Room / bed occupancy'});}
    const captured=[] as unknown[],skipped=[] as Array<{source:string;reason:string}>;for(const c of candidates){if(seen.has(c.source)){skipped.push({source:c.source,reason:'already-captured'});continue}const tariff=tariffs.find(t=>t.extension?.find(e=>e.url===TARIFF_CATEGORY)?.valueString===c.category);if(!tariff){skipped.push({source:c.source,reason:`missing-${c.category}-tariff`});continue}const price=tariff.propertyGroup?.[0]?.priceComponent?.[0]?.amount;const charge:CreateChargeDto={hospitalId:dto.hospitalId,patientId,encounterId,code:tariff.code?.coding?.[0]?.code??c.category,description:c.description,quantity:c.quantity,unitPrice:price?.value??0,currency:(price?.currency as CreateChargeDto['currency'])??'SAR',sourceReference:c.source};captured.push(await this.createCharge(charge));seen.add(c.source)}return{encounterId,patientId,captured,skipped};
  }

  async patientAccount(patientId:string,hospitalId:string){if(!patientId||!hospitalId)throw new BadRequestException('Patient and hospital are required');const client=this.medplumService.getClient();const[charges,invoices,claims,payments]=await Promise.all([client.searchResources('ChargeItem',{subject:`Patient/${patientId}`,_count:'1000'}),client.searchResources('Invoice',{subject:`Patient/${patientId}`,_count:'500'}),client.searchResources('Claim',{patient:`Patient/${patientId}`,_count:'500'}),client.searchResources('PaymentReconciliation',{_count:'500'})]);const scopedCharges=charges.filter(i=>this.hospitalId(i)===hospitalId),scopedInvoices=invoices.filter(i=>this.hospitalId(i)===hospitalId),scopedClaims=claims.filter(i=>this.hospitalId(i)===hospitalId),invoiceIds=new Set(scopedInvoices.map(i=>`Invoice/${i.id}`)),scopedPayments=payments.filter(p=>p.extension?.some(e=>e.url===HOSPITAL&&e.valueReference?.reference===`Organization/${hospitalId}`)&&p.extension?.some(e=>e.url===`${BASE}/payment-invoice`&&invoiceIds.has(e.valueReference?.reference??'')));return{patientId,hospitalId,summary:{charges:this.totalCharges(scopedCharges),invoiced:scopedInvoices.reduce((n,i)=>n+(i.totalGross?.value??0),0),paid:scopedInvoices.reduce((n,i)=>n+this.money(i,PAID),0),balance:scopedInvoices.reduce((n,i)=>n+this.money(i,BALANCE),0),activeClaims:scopedClaims.filter(c=>c.status==='active').length},charges:scopedCharges.map(i=>this.mapCharge(i)),invoices:scopedInvoices.map(i=>this.mapInvoice(i)),claims:scopedClaims.map(i=>this.mapClaim(i)),payments:scopedPayments.map(p=>({id:p.id,date:p.paymentDate,amount:p.paymentAmount,reference:p.paymentIdentifier?.value,method:p.extension?.find(e=>e.url===METHOD)?.valueCode}))};}

  async encounterSummary(encounterId: string, hospitalId: string) { const encounter = await this.readEncounter(encounterId); if (encounter.serviceProvider?.reference !== `Organization/${hospitalId}`) throw new NotFoundException('Encounter not found'); const charges = (await this.medplumService.getClient().searchResources('ChargeItem', { context: `Encounter/${encounterId}`, _count: '500' })).filter((item) => this.hospitalId(item) === hospitalId); const invoices = (await this.medplumService.getClient().searchResources('Invoice', { subject: encounter.subject?.reference, _count: '200' })).filter((item) => this.hospitalId(item) === hospitalId && this.ext(item, ENCOUNTER) === encounterId); return { encounterId, charges: charges.map((item) => this.mapCharge(item)), invoices: invoices.map((item) => this.mapInvoice(item)) }; }
  private required(dto: object, fields: string[]) { for (const field of fields) if (!String((dto as Record<string, unknown>)[field] ?? '').trim()) throw new BadRequestException(`${field} is required`); }
  private async readEncounter(id: string) { try { return await this.medplumService.getClient().readResource('Encounter', id); } catch { throw new NotFoundException('Encounter not found'); } }
  private async encounter(id: string, patientId: string, hospitalId: string) { const item = await this.readEncounter(id); if (item.subject?.reference !== `Patient/${patientId}` || item.serviceProvider?.reference !== `Organization/${hospitalId}`) throw new NotFoundException('Encounter not found'); if (!item.extension?.some((ext) => ext.url === `${BASE}/encounter-financial-class`)) throw new ConflictException('Financial class must be assigned before billing'); return item; }
  private async invoice(id: string, hospitalId: string) { let item: Invoice; try { item = await this.medplumService.getClient().readResource('Invoice', id); } catch { throw new NotFoundException('Invoice not found'); } if (this.hospitalId(item) !== hospitalId) throw new NotFoundException('Invoice not found'); return item; }
  private async coverage(id: string, patientId: string, hospitalId: string) { let item: Coverage; try { item = await this.medplumService.getClient().readResource('Coverage', id); } catch { throw new NotFoundException('Coverage not found'); } if (item.status !== 'active' || item.beneficiary.reference !== `Patient/${patientId}` || !item.extension?.some((ext) => ext.valueReference?.reference === `Organization/${hospitalId}`)) throw new NotFoundException('Coverage not found'); return item; }
  private async claim(id: string, hospitalId: string) { let item: Claim; try { item = await this.medplumService.getClient().readResource('Claim', id); } catch { throw new NotFoundException('Claim not found'); } if (this.hospitalId(item) !== hospitalId) throw new NotFoundException('Claim not found'); return item; }
  private hospitalId(item: { extension?: Array<{ url: string; valueReference?: { reference?: string } }> }) { return item.extension?.find((ext) => ext.url === HOSPITAL)?.valueReference?.reference?.replace('Organization/', ''); }
  private ext(item: { extension?: Array<{ url: string; valueString?: string }> }, url: string) { return item.extension?.find((ext) => ext.url === url)?.valueString; }
  private money(item: Invoice, url: string) { return item.extension?.find((ext) => ext.url === url)?.valueMoney?.value ?? 0; }
  private totalCharges(items: ChargeItem[]) { return Number(items.reduce((sum, item) => sum + (item.quantity?.value ?? 1) * (item.priceOverride?.value ?? 0), 0).toFixed(2)); }
  private mapCharge(item: ChargeItem) { return { id: item.id, identifier: item.identifier?.[0]?.value, hospitalId: this.hospitalId(item), patientId: item.subject.reference?.replace('Patient/', ''), encounterId: item.context?.reference?.replace('Encounter/', ''), status: item.status, code: item.code.coding?.[0]?.code, description: item.code.text, quantity: item.quantity?.value, unitPrice: item.priceOverride?.value, currency: item.priceOverride?.currency, total: (item.quantity?.value ?? 1) * (item.priceOverride?.value ?? 0) }; }
  private mapInvoice(item: Invoice) { return { id: item.id, identifier: item.identifier?.[0]?.value, hospitalId: this.hospitalId(item), encounterId: this.ext(item, ENCOUNTER), patientId: item.subject?.reference?.replace('Patient/', ''), status: item.status, total: item.totalGross?.value, currency: item.totalGross?.currency, paid: this.money(item, PAID), balance: this.money(item, BALANCE), date: item.date }; }
  private mapClaim(item: Claim) { return { id: item.id, identifier: item.identifier?.[0]?.value, hospitalId: this.hospitalId(item), patientId: item.patient.reference?.replace('Patient/', ''), invoiceId: this.ext(item, CLAIM_INVOICE), coverageId: item.insurance[0]?.coverage.reference?.replace('Coverage/', ''), payerId: item.insurer?.reference?.replace('Organization/', ''), status: item.status, amount: item.total?.value, currency: item.total?.currency }; }
  private mapTariff(item:ChargeItemDefinition){const amount=item.propertyGroup?.[0]?.priceComponent?.[0]?.amount;return{id:item.id,category:item.extension?.find(e=>e.url===TARIFF_CATEGORY)?.valueString,code:item.code?.coding?.[0]?.code,description:item.title,unitPrice:amount?.value,currency:amount?.currency,status:item.status};}
}
