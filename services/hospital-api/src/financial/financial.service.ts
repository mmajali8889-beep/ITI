import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Coverage, CoverageEligibilityRequest, CoverageEligibilityResponse, Encounter, Patient } from '@medplum/fhirtypes';
import { randomUUID } from 'node:crypto';
import { MedplumService } from '../medplum/medplum.service';
import {
  AssignFinancialClassDto,
  CheckEligibilityDto,
  CreateCoverageDto,
  RecordEligibilityDecisionDto,
  UpdateCoverageStatusDto,
} from './dto/financial.dto';

const BASE = 'https://hospital-ehr.local/fhir/StructureDefinition';
const HOSPITAL = `${BASE}/financial-hospital`;
const ELIGIBILITY = `${BASE}/eligibility-decision`;
const AUTHORIZATION = `${BASE}/eligibility-authorization-number`;
const DENIAL_REASON = `${BASE}/eligibility-denial-reason`;
const VALID_UNTIL = `${BASE}/eligibility-valid-until`;
const FINANCIAL_CLASS = `${BASE}/encounter-financial-class`;
const SPONSOR = `${BASE}/encounter-financial-sponsor`;
const CLEARANCE = `${BASE}/financial-clearance-status`;
const NETWORK_ID = `${BASE}/coverage-network-id`;
const NETWORK_NAME = `${BASE}/coverage-network-name`;
const DEDUCTIBLE = `${BASE}/coverage-deductible`;
const COPAY = `${BASE}/coverage-copay`;
const COVERAGE_PERCENTAGE = `${BASE}/coverage-percentage`;
const CURRENCY = `${BASE}/financial-currency`;
const PREAUTH_REQUIRED = `${BASE}/preauthorization-required`;

@Injectable()
export class FinancialService {
  constructor(private readonly medplumService: MedplumService) {}

  async createCoverage(dto: CreateCoverageDto) {
    this.required(dto, ['hospitalId', 'patientId', 'payerId', 'payerName', 'subscriberId', 'validFrom']);
    const patient = await this.patient(dto.patientId, dto.hospitalId);
    const from = this.date(dto.validFrom, 'Invalid coverage start date');
    const to = dto.validTo ? this.date(dto.validTo, 'Invalid coverage end date') : undefined;
    if (to && to < from) throw new BadRequestException('Coverage end date must not precede its start date');
    this.percent(dto.coveragePercentage, 'Coverage percentage');
    this.nonNegative(dto.deductibleAmount, 'Deductible amount');
    this.nonNegative(dto.copayAmount, 'Co-pay amount');

    const existing = await this.medplumService.getClient().searchResources('Coverage', { beneficiary: `Patient/${dto.patientId}`, _count: '200' });
    const duplicate = existing.some((item) => this.hospitalId(item) === dto.hospitalId && item.status === 'active' &&
      item.payor?.[0]?.reference === `Organization/${dto.payerId}` && item.subscriberId === dto.subscriberId.trim());
    if (duplicate) throw new ConflictException({ message: 'An active matching coverage already exists', code: 'DUPLICATE_COVERAGE' });

    const coverage: Coverage = {
      resourceType: 'Coverage', status: 'active',
      identifier: [{ system: `https://hospital-ehr.local/coverage/${dto.hospitalId}`, value: `COV-${randomUUID().slice(0, 8).toUpperCase()}` }],
      type: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'EHCPOL', display: 'Extended healthcare' }], text: dto.planName?.trim() || 'Health insurance' },
      subscriberId: dto.subscriberId.trim(), beneficiary: { reference: `Patient/${dto.patientId}`, display: patient.name?.[0]?.text },
      relationship: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/subscriber-relationship', code: dto.relationship ?? 'self' }] },
      period: { start: from.toISOString(), ...(to ? { end: to.toISOString() } : {}) },
      payor: [{ reference: `Organization/${dto.payerId}`, display: dto.payerName.trim() }],
      class: dto.policyNumber ? [{ type: { text: 'Policy' }, value: dto.policyNumber.trim(), name: dto.planName?.trim() }] : undefined,
      extension: [{ url: HOSPITAL, valueReference: { reference: `Organization/${dto.hospitalId}` } },
        ...(dto.networkId ? [{ url: NETWORK_ID, valueString: dto.networkId.trim() }] : []),
        ...(dto.networkName ? [{ url: NETWORK_NAME, valueString: dto.networkName.trim() }] : []),
        ...(dto.deductibleAmount !== undefined ? [{ url: DEDUCTIBLE, valueDecimal: dto.deductibleAmount }] : []),
        ...(dto.copayAmount !== undefined ? [{ url: COPAY, valueDecimal: dto.copayAmount }] : []),
        ...(dto.coveragePercentage !== undefined ? [{ url: COVERAGE_PERCENTAGE, valueDecimal: dto.coveragePercentage }] : []),
        ...(dto.currency ? [{ url: CURRENCY, valueCode: dto.currency.trim().toUpperCase() }] : []),
        { url: PREAUTH_REQUIRED, valueBoolean: dto.preAuthorizationRequired ?? false }],
    };
    return this.mapCoverage(await this.medplumService.getClient().createResource<Coverage>(coverage));
  }

  async patientCoverages(patientId: string, hospitalId: string) {
    await this.patient(patientId, hospitalId);
    const resources = await this.medplumService.getClient().searchResources('Coverage', { beneficiary: `Patient/${patientId}`, _count: '200' });
    const coverages = resources.filter((item) => this.hospitalId(item) === hospitalId).map((item) => this.mapCoverage(item));
    return { total: coverages.length, coverages };
  }

  async updateCoverageStatus(coverageId: string, dto: UpdateCoverageStatusDto) {
    if (!['active', 'cancelled', 'draft', 'entered-in-error'].includes(dto.status)) throw new BadRequestException('Invalid coverage status');
    if (dto.status !== 'active' && !dto.reason?.trim()) throw new BadRequestException('A reason is required when coverage is not active');
    const coverage = await this.coverage(coverageId, dto.hospitalId);
    coverage.status = dto.status;
    coverage.extension = [...(coverage.extension ?? []).filter((item) => item.url !== `${BASE}/coverage-status-reason`),
      ...(dto.reason ? [{ url: `${BASE}/coverage-status-reason`, valueString: dto.reason.trim() }] : [])];
    return this.mapCoverage(await this.medplumService.getClient().updateResource<Coverage>(coverage));
  }

  async checkEligibility(dto: CheckEligibilityDto) {
    this.required(dto, ['hospitalId', 'patientId', 'coverageId']);
    await this.patient(dto.patientId, dto.hospitalId);
    const coverage = await this.coverage(dto.coverageId, dto.hospitalId);
    if (coverage.beneficiary.reference !== `Patient/${dto.patientId}`) throw new NotFoundException('Coverage not found');
    if (coverage.status !== 'active') throw new ConflictException('Coverage must be active before eligibility verification');
    if (dto.encounterId) await this.encounter(dto.encounterId, dto.patientId, dto.hospitalId);
    this.nonNegative(dto.estimatedAmount, 'Estimated amount');

    const request: CoverageEligibilityRequest = {
      resourceType: 'CoverageEligibilityRequest', status: 'active', purpose: ['validation', 'benefits'],
      patient: { reference: `Patient/${dto.patientId}` }, created: new Date().toISOString(),
      insurer: { reference: coverage.payor[0]?.reference, display: coverage.payor[0]?.display }, insurance: [{ focal: true, coverage: { reference: `Coverage/${dto.coverageId}` } }],
      item: dto.serviceCodes?.filter(Boolean).map((code) => ({ category: { coding: [{ system: 'https://hospital-ehr.local/CodeSystem/service', code }] } })),
      identifier: [{ system: `https://hospital-ehr.local/eligibility/${dto.hospitalId}`, value: `ELG-${randomUUID().slice(0, 8).toUpperCase()}` }],
      extension: [{ url: HOSPITAL, valueReference: { reference: `Organization/${dto.hospitalId}` } },
        ...(dto.encounterId ? [{ url: `${BASE}/eligibility-encounter`, valueReference: { reference: `Encounter/${dto.encounterId}` } }] : []),
        ...(dto.providerNetworkId ? [{ url: `${BASE}/provider-network-id`, valueString: dto.providerNetworkId.trim() }] : []),
        ...(dto.estimatedAmount !== undefined ? [{ url: `${BASE}/estimated-amount`, valueDecimal: dto.estimatedAmount }] : []),
        ...(dto.currency ? [{ url: `${BASE}/estimated-amount-currency`, valueCode: dto.currency.trim().toUpperCase() }] : [])],
    };
    const created = await this.medplumService.getClient().createResource<CoverageEligibilityRequest>(request);
    return this.mapEligibility(created);
  }

  async recordEligibilityDecision(requestId: string, dto: RecordEligibilityDecisionDto) {
    this.required(dto, ['hospitalId', 'eligibility']);
    if (dto.eligibility === 'eligible' && dto.benefitsVerified !== true) throw new BadRequestException('Benefits verification is required for eligible decisions');
    if (dto.eligibility === 'eligible' && !dto.networkStatus) throw new BadRequestException('Network verification is required for eligible decisions');
    if (dto.eligibility === 'eligible' && dto.authorizationRequired && !dto.authorizationNumber?.trim()) throw new BadRequestException('Authorization number is required when pre-authorization is required');
    if (dto.eligibility === 'ineligible' && !dto.denialReason?.trim()) throw new BadRequestException('Denial reason is required for ineligible decisions');
    this.percent(dto.coveragePercentage, 'Coverage percentage');
    for (const [value, label] of [[dto.authorizationLimit, 'Authorization limit'], [dto.deductibleRemaining, 'Remaining deductible'], [dto.copayAmount, 'Co-pay amount'], [dto.patientResponsibility, 'Patient responsibility']] as const) this.nonNegative(value, label);
    const request = await this.eligibilityRequest(requestId, dto.hospitalId);
    const prior = await this.medplumService.getClient().searchResources('CoverageEligibilityResponse', { request: `CoverageEligibilityRequest/${requestId}`, _count: '20' });
    if (prior.some((item) => this.hospitalId(item) === dto.hospitalId)) throw new ConflictException('Eligibility decision is already recorded');

    const response: CoverageEligibilityResponse = {
      resourceType: 'CoverageEligibilityResponse', status: 'active', purpose: request.purpose,
      patient: request.patient, created: new Date().toISOString(), request: { reference: `CoverageEligibilityRequest/${requestId}` },
      outcome: 'complete', insurer: request.insurer,
      insurance: [{ coverage: request.insurance?.[0]?.coverage ?? { reference: 'Coverage/unknown' }, inforce: dto.eligibility === 'eligible' }],
      extension: [{ url: HOSPITAL, valueReference: { reference: `Organization/${dto.hospitalId}` } },
        { url: ELIGIBILITY, valueCode: dto.eligibility },
        ...(dto.authorizationNumber ? [{ url: AUTHORIZATION, valueString: dto.authorizationNumber.trim() }] : []),
        { url: `${BASE}/benefits-verified`, valueBoolean: dto.benefitsVerified ?? false },
        ...(dto.networkStatus ? [{ url: `${BASE}/network-status`, valueCode: dto.networkStatus }] : []),
        { url: PREAUTH_REQUIRED, valueBoolean: dto.authorizationRequired ?? false },
        ...(dto.authorizationLimit !== undefined ? [{ url: `${BASE}/authorization-limit`, valueDecimal: dto.authorizationLimit }] : []),
        ...(dto.deductibleRemaining !== undefined ? [{ url: `${BASE}/deductible-remaining`, valueDecimal: dto.deductibleRemaining }] : []),
        ...(dto.copayAmount !== undefined ? [{ url: COPAY, valueDecimal: dto.copayAmount }] : []),
        ...(dto.coveragePercentage !== undefined ? [{ url: COVERAGE_PERCENTAGE, valueDecimal: dto.coveragePercentage }] : []),
        ...(dto.patientResponsibility !== undefined ? [{ url: `${BASE}/patient-responsibility`, valueDecimal: dto.patientResponsibility }] : []),
        ...(dto.denialReason ? [{ url: DENIAL_REASON, valueString: dto.denialReason.trim() }] : []),
        ...(dto.validUntil ? [{ url: VALID_UNTIL, valueDateTime: this.date(dto.validUntil, 'Invalid eligibility validity date').toISOString() }] : [])],
    };
    await this.medplumService.getClient().createResource<CoverageEligibilityResponse>(response);
    const encounterReference = request.extension?.find((item) => item.url === `${BASE}/eligibility-encounter`)?.valueReference?.reference;
    if (encounterReference) {
      const encounter = await this.medplumService.getClient().readReference<Encounter>({ reference: encounterReference });
      encounter.extension = [...(encounter.extension ?? []).filter((item) => item.url !== CLEARANCE), {
        url: CLEARANCE,
        valueCode: dto.eligibility === 'eligible' && (!dto.authorizationRequired || Boolean(dto.authorizationNumber)) ? 'cleared' : dto.eligibility === 'eligible' ? 'pending-authorization' : 'denied',
      }];
      await this.medplumService.getClient().updateResource(encounter);
    }
    return { ...this.mapEligibility(request), eligibility: dto.eligibility, authorizationNumber: dto.authorizationNumber, denialReason: dto.denialReason, validUntil: dto.validUntil };
  }

  async eligibilityHistory(patientId: string, hospitalId: string) {
    await this.patient(patientId, hospitalId);
    const requests = await this.medplumService.getClient().searchResources('CoverageEligibilityRequest', { patient: `Patient/${patientId}`, _count: '200' });
    const scoped = requests.filter((item) => this.hospitalId(item) === hospitalId);
    const allResponses = await this.medplumService.getClient().searchResources('CoverageEligibilityResponse', { patient: `Patient/${patientId}`, _count: '200' });
    const responses = allResponses.filter((item) => this.hospitalId(item) === hospitalId);
    return { total: scoped.length, checks: scoped.map((item) => {
      const response = responses.find((candidate) => candidate.request?.reference === `CoverageEligibilityRequest/${item.id}`);
      return { ...this.mapEligibility(item), eligibility: this.extension(response, ELIGIBILITY), authorizationNumber: this.extension(response, AUTHORIZATION), denialReason: this.extension(response, DENIAL_REASON), validUntil: this.extension(response, VALID_UNTIL) };
    }) };
  }

  async assignFinancialClass(encounterId: string, dto: AssignFinancialClassDto) {
    this.required(dto, ['hospitalId', 'patientId', 'financialClass']);
    if (!['cash', 'insurance', 'corporate', 'government'].includes(dto.financialClass)) throw new BadRequestException('Invalid financial class');
    const encounter = await this.encounter(encounterId, dto.patientId, dto.hospitalId);
    if (dto.financialClass === 'insurance') {
      if (!dto.coverageId) throw new BadRequestException('Coverage is required for insurance financial class');
      const coverage = await this.coverage(dto.coverageId, dto.hospitalId);
      if (coverage.beneficiary.reference !== `Patient/${dto.patientId}` || coverage.status !== 'active') throw new BadRequestException('An active patient coverage is required');
    }
    if (['corporate', 'government'].includes(dto.financialClass) && !dto.sponsorId) throw new BadRequestException('Sponsor is required for contracted financial classes');
    const clearance = this.clearanceAfterClassification(encounter, dto);
    encounter.extension = [...(encounter.extension ?? []).filter((item) => ![FINANCIAL_CLASS, SPONSOR, `${BASE}/encounter-coverage`, CLEARANCE].includes(item.url)),
      { url: FINANCIAL_CLASS, valueCode: dto.financialClass },
      { url: CLEARANCE, valueCode: clearance },
      ...(dto.sponsorId ? [{ url: SPONSOR, valueReference: { reference: `Organization/${dto.sponsorId}`, display: dto.sponsorName } }] : [])];
    if (dto.coverageId) encounter.extension.push({ url: `${BASE}/encounter-coverage`, valueReference: { reference: `Coverage/${dto.coverageId}` } });
    await this.medplumService.getClient().updateResource(encounter);
    return { encounterId, hospitalId: dto.hospitalId, patientId: dto.patientId, financialClass: dto.financialClass, coverageId: dto.coverageId, sponsorId: dto.sponsorId, sponsorName: dto.sponsorName, financialClearanceStatus: clearance };
  }

  /** Clearance rule (docs/STAGES_03_05_ACCEPTANCE.md): only insurance has an eligibility flow, and re-classifying never discards a decision that still applies. */
  private clearanceAfterClassification(encounter: Encounter, dto: AssignFinancialClassDto) {
    const current = encounter.extension?.find((item) => item.url === CLEARANCE)?.valueCode;
    if (current === 'emergency-override') return current;
    if (dto.financialClass !== 'insurance') return 'cleared';
    const sameInsurance = encounter.extension?.find((item) => item.url === FINANCIAL_CLASS)?.valueCode === 'insurance'
      && encounter.extension?.find((item) => item.url === `${BASE}/encounter-coverage`)?.valueReference?.reference === `Coverage/${dto.coverageId}`;
    return sameInsurance && current && ['cleared', 'pending-authorization', 'denied'].includes(current) ? current : 'pending-eligibility';
  }

  private required(dto: object, fields: string[]) { for (const field of fields) if (!String((dto as Record<string, unknown>)[field] ?? '').trim()) throw new BadRequestException(`${field} is required`); }
  private date(value: string, message: string) { const date = new Date(value); if (Number.isNaN(date.getTime())) throw new BadRequestException(message); return date; }
  private nonNegative(value: number | undefined, label: string) { if (value !== undefined && (!Number.isFinite(value) || value < 0)) throw new BadRequestException(`${label} must be zero or greater`); }
  private percent(value: number | undefined, label: string) { if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > 100)) throw new BadRequestException(`${label} must be between 0 and 100`); }
  private hospitalId(resource: { extension?: Array<{ url: string; valueReference?: { reference?: string } }> }) { return resource.extension?.find((item) => item.url === HOSPITAL)?.valueReference?.reference?.replace('Organization/', ''); }
  private extension(resource: { extension?: Array<{ url?: string; valueCode?: string; valueString?: string; valueDateTime?: string }> } | undefined, url: string) { const item = resource?.extension?.find((value) => value.url === url); return item?.valueCode ?? item?.valueString ?? item?.valueDateTime; }
  private async patient(id: string, hospitalId: string) { let patient: Patient; try { patient = await this.medplumService.getClient().readResource('Patient', id); } catch { throw new NotFoundException('Patient not found'); } if (patient.managingOrganization?.reference !== `Organization/${hospitalId}`) throw new NotFoundException('Patient not found'); return patient; }
  private async coverage(id: string, hospitalId: string) { let coverage: Coverage; try { coverage = await this.medplumService.getClient().readResource('Coverage', id); } catch { throw new NotFoundException('Coverage not found'); } if (this.hospitalId(coverage) !== hospitalId) throw new NotFoundException('Coverage not found'); return coverage; }
  private async encounter(id: string, patientId: string, hospitalId: string) { let encounter: Encounter; try { encounter = await this.medplumService.getClient().readResource('Encounter', id); } catch { throw new NotFoundException('Encounter not found'); } if (encounter.serviceProvider?.reference !== `Organization/${hospitalId}` || encounter.subject?.reference !== `Patient/${patientId}`) throw new NotFoundException('Encounter not found'); return encounter; }
  private async eligibilityRequest(id: string, hospitalId: string) { let request: CoverageEligibilityRequest; try { request = await this.medplumService.getClient().readResource('CoverageEligibilityRequest', id); } catch { throw new NotFoundException('Eligibility request not found'); } if (this.hospitalId(request) !== hospitalId) throw new NotFoundException('Eligibility request not found'); if (request.status !== 'active') throw new ConflictException('Eligibility request is not active'); return request; }
  private mapCoverage(item: Coverage) { const ext = (url: string) => item.extension?.find((value) => value.url === url); return { id: item.id, identifier: item.identifier?.[0]?.value, hospitalId: this.hospitalId(item), patientId: item.beneficiary.reference?.replace('Patient/', ''), status: item.status, payerId: item.payor[0]?.reference?.replace('Organization/', ''), payerName: item.payor[0]?.display, subscriberId: item.subscriberId, planName: item.type?.text, policyNumber: item.class?.[0]?.value, networkId: ext(NETWORK_ID)?.valueString, networkName: ext(NETWORK_NAME)?.valueString, deductibleAmount: ext(DEDUCTIBLE)?.valueDecimal, copayAmount: ext(COPAY)?.valueDecimal, coveragePercentage: ext(COVERAGE_PERCENTAGE)?.valueDecimal, currency: ext(CURRENCY)?.valueCode, preAuthorizationRequired: ext(PREAUTH_REQUIRED)?.valueBoolean, validFrom: item.period?.start, validTo: item.period?.end }; }
  private mapEligibility(item: CoverageEligibilityRequest) { return { id: item.id, identifier: item.identifier?.[0]?.value, hospitalId: this.hospitalId(item), patientId: item.patient.reference?.replace('Patient/', ''), coverageId: item.insurance?.[0]?.coverage.reference?.replace('Coverage/', ''), status: item.status, created: item.created, serviceCodes: item.item?.map((value) => value.category?.coding?.[0]?.code).filter(Boolean) }; }
}
