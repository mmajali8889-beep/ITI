import { BadRequestException, Injectable } from '@nestjs/common';
import type { AuditEvent, Encounter, Extension, Invoice } from '@medplum/fhirtypes';
import { MedplumService } from '../medplum/medplum.service';

const BASE = 'https://hospital-ehr.local/fhir/StructureDefinition';
const HOSPITAL = `${BASE}/audit-hospital`, ROUTE = `${BASE}/audit-route`, HTTP_STATUS = `${BASE}/audit-http-status`, DURATION = `${BASE}/audit-duration-ms`;

@Injectable()
export class AuditAnalyticsService {
  constructor(private readonly medplumService: MedplumService) {}

  async record(input: { hospitalId?: string; userId?: string; userName?: string; method: string; route: string; ip?: string; statusCode: number; durationMs: number }) {
    if (!input.hospitalId) return;
    const action = input.method === 'POST' ? 'C' : input.method === 'DELETE' ? 'D' : input.method === 'GET' ? 'R' : 'U';
    const event: AuditEvent = { resourceType: 'AuditEvent', type: { system: 'http://terminology.hl7.org/CodeSystem/audit-event-type', code: 'rest', display: 'RESTful Operation' }, subtype: [{ system: 'http://hl7.org/fhir/restful-interaction', code: input.method.toLowerCase() }], action, recorded: new Date().toISOString(), outcome: input.statusCode < 400 ? '0' : input.statusCode < 500 ? '4' : '8', outcomeDesc: `HTTP ${input.statusCode}`, agent: [{ who: input.userId ? { reference: `Practitioner/${input.userId}`, display: input.userName } : undefined, name: input.userName ?? 'Unauthenticated actor', requestor: true, network: input.ip ? { address: input.ip, type: '2' } : undefined }], source: { site: input.hospitalId, observer: { reference: `Organization/${input.hospitalId}` }, type: [{ system: 'http://terminology.hl7.org/CodeSystem/security-source-type', code: '4', display: 'Application Server' }] }, entity: [{ name: input.route, description: `${input.method} ${input.route}` }], extension: [{ url: HOSPITAL, valueReference: { reference: `Organization/${input.hospitalId}` } }, { url: ROUTE, valueString: input.route }, { url: HTTP_STATUS, valueInteger: input.statusCode }, { url: DURATION, valueInteger: input.durationMs }] };
    await this.medplumService.getClient().createResource<AuditEvent>(event);
  }

  async events(hospitalId: string, limit = 100) {
    if (!hospitalId) throw new BadRequestException('Hospital ID is required');
    const count = Math.min(Math.max(Number(limit) || 100, 1), 500);
    // Scope and order on the server: fetching an unfiltered page and filtering it
    // here silently drops a hospital's recent events once others have older ones.
    const all = await this.medplumService.getClient().searchResources('AuditEvent', { source: `Organization/${hospitalId}`, _sort: '-date', _count: String(count) });
    const events = all.filter((item) => this.hospitalId(item) === hospitalId).sort((a, b) => b.recorded.localeCompare(a.recorded)).slice(0, count).map((item) => ({ id: item.id, recorded: item.recorded, action: item.action, outcome: item.outcome, outcomeDescription: item.outcomeDesc, actorId: item.agent[0]?.who?.reference, actorName: item.agent[0]?.name ?? item.agent[0]?.who?.display, route: this.extension(item.extension, ROUTE)?.valueString, statusCode: this.extension(item.extension, HTTP_STATUS)?.valueInteger, durationMs: this.extension(item.extension, DURATION)?.valueInteger }));
    return { hospitalId, total: events.length, events };
  }

  async overview(hospitalId: string) {
    if (!hospitalId) throw new BadRequestException('Hospital ID is required');
    const medplum = this.medplumService.getClient();
    const [patients, encounters, appointments, invoices, claims, tasks, audits] = await Promise.all([
      medplum.searchResources('Patient', { organization: `Organization/${hospitalId}`, _count: '1000' }), medplum.searchResources('Encounter', { 'service-provider': `Organization/${hospitalId}`, _count: '1000' }), medplum.searchResources('Appointment', { _count: '1000' }), medplum.searchResources('Invoice', { issuer: `Organization/${hospitalId}`, _count: '1000' }), medplum.searchResources('Claim', { provider: `Organization/${hospitalId}`, _count: '1000' }), medplum.searchResources('Task', { _count: '1000' }), medplum.searchResources('AuditEvent', { _count: '1000' }),
    ]);
    const scopedEncounters = encounters.filter((item) => item.serviceProvider?.reference === `Organization/${hospitalId}`);
    const scopedInvoices = invoices.filter((item) => this.genericHospital(item) === hospitalId || item.issuer?.reference === `Organization/${hospitalId}`);
    const scopedClaims = claims.filter((item) => this.genericHospital(item) === hospitalId || item.provider.reference === `Organization/${hospitalId}`);
    const scopedTasks = tasks.filter((item) => this.genericHospital(item) === hospitalId);
    return { hospitalId, generatedAt: new Date().toISOString(), patients: patients.filter((item) => item.managingOrganization?.reference === `Organization/${hospitalId}`).length, encounters: { total: scopedEncounters.length, active: scopedEncounters.filter((item) => !['finished', 'cancelled', 'entered-in-error'].includes(item.status)).length, finished: scopedEncounters.filter((item) => item.status === 'finished').length, byType: this.encounterTypes(scopedEncounters) }, appointments: appointments.filter((item) => item.extension?.some((ext) => ext.valueReference?.reference === `Organization/${hospitalId}`)).length, finance: { invoiceCount: scopedInvoices.length, gross: this.sum(scopedInvoices, 'totalGross'), outstanding: scopedInvoices.reduce((sum, item) => sum + (item.extension?.find((ext) => ext.url === `${BASE}/invoice-balance`)?.valueMoney?.value ?? 0), 0), claimCount: scopedClaims.length }, records: { openDeficiencies: scopedTasks.filter((item) => item.code?.coding?.[0]?.code === 'chart-deficiency' && item.status !== 'completed').length, pendingResultReviews: scopedTasks.filter((item) => item.code?.coding?.[0]?.code === 'result-review' && item.status !== 'completed').length }, auditEvents: audits.filter((item) => this.hospitalId(item) === hospitalId).length };
  }

  private hospitalId(item: AuditEvent) { return item.extension?.find((ext) => ext.url === HOSPITAL)?.valueReference?.reference?.replace('Organization/', ''); }
  private genericHospital(item: { extension?: Extension[] }) { return item.extension?.find((ext) => ext.valueReference?.reference?.startsWith('Organization/'))?.valueReference?.reference?.replace('Organization/', ''); }
  private extension(items: Extension[] | undefined, url: string) { return items?.find((item) => item.url === url); }
  private sum(items: Invoice[], field: 'totalGross') { return Number(items.reduce((sum, item) => sum + (item[field]?.value ?? 0), 0).toFixed(2)); }
  private encounterTypes(items: Encounter[]) { return items.reduce<Record<string, number>>((result, item) => { const type = item.type?.[0]?.coding?.[0]?.code ?? item.class?.code ?? 'unknown'; result[type] = (result[type] ?? 0) + 1; return result; }, {}); }
}
