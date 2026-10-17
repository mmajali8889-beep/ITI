import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  Appointment,
  Composition,
  Encounter,
  Invoice,
  ServiceRequest,
  Task,
} from '@medplum/fhirtypes';
import { MedplumService } from '../medplum/medplum.service';
import { BedManagementService } from '../bed-management/bed-management.service';
import {
  CreateDischargeDto,
  DischargeClearanceDto,
  DischargeSummaryDto,
  FinalizeDischargeDto,
  ReconcileDischargeDto,
} from './dto/discharge.dto';
const BASE = 'https://hospital-ehr.local/fhir/StructureDefinition',
  HOSPITAL = `${BASE}/discharge-hospital`,
  RECON = `${BASE}/discharge-reconciliation`,
  SUMMARY = `${BASE}/discharge-summary`,
  FOLLOWUP = `${BASE}/discharge-follow-up`,
  CLEAR = `${BASE}/discharge-clearances`,
  ORG = (id: string) => `Organization/${id}`;
const ext = (t: Task, u: string) => t.extension?.find((e) => e.url === u);
@Injectable()
export class DischargeService {
  constructor(
    private readonly medplumService: MedplumService,
    private readonly beds: BedManagementService,
  ) {}
  async create(dto: CreateDischargeDto) {
    for (const k of [
      'hospitalId',
      'patientId',
      'encounterId',
      'physicianName',
      'decisionReason',
    ] as const)
      if (!String(dto[k] ?? '').trim())
        throw new BadRequestException(`${k} is required`);
    const e = await this.encounter(dto.encounterId, dto.hospitalId);
    if (
      e.subject?.reference !== `Patient/${dto.patientId}` ||
      e.class?.code !== 'IMP'
    )
      throw new NotFoundException('Inpatient encounter not found');
    const existing = await this.medplumService
      .getClient()
      .searchResources('Task', {
        encounter: `Encounter/${dto.encounterId}`,
        status: 'ready,in-progress',
        _count: '50',
      });
    if (
      existing.some((t) =>
        t.code?.coding?.some((c) => c.code === 'discharge-workflow'),
      )
    )
      throw new ConflictException('Active discharge workflow already exists');
    const task: Task = {
      resourceType: 'Task',
      status: 'in-progress',
      intent: 'order',
      code: {
        coding: [
          {
            system: 'https://hospital-ehr.local/CodeSystem/workflow-task',
            code: 'discharge-workflow',
          },
        ],
      },
      description: dto.decisionReason.trim(),
      for: e.subject,
      encounter: { reference: `Encounter/${dto.encounterId}` },
      authoredOn: new Date().toISOString(),
      requester: dto.physicianId
        ? {
            reference: `Practitioner/${dto.physicianId}`,
            display: dto.physicianName,
          }
        : { display: dto.physicianName },
      extension: [
        { url: HOSPITAL, valueReference: { reference: ORG(dto.hospitalId) } },
        { url: CLEAR, valueString: '{}' },
      ],
    };
    return this.map(await this.medplumService.getClient().createResource(task));
  }
  async queue(hospitalId: string) {
    if (!hospitalId) throw new BadRequestException('Hospital ID is required');
    const tasks = await this.medplumService
      .getClient()
      .searchResources('Task', { _count: '500' });
    return {
      items: tasks
        .filter(
          (t) =>
            t.code?.coding?.some((c) => c.code === 'discharge-workflow') &&
            ext(t, HOSPITAL)?.valueReference?.reference === ORG(hospitalId),
        )
        .map((t) => this.map(t)),
    };
  }
  async reconcile(id: string, d: ReconcileDischargeDto) {
    const t = await this.read(id, d.hospitalId);
    if (!d.clinicianName?.trim() || !d.homeMedications?.length)
      throw new BadRequestException(
        'Clinician and reconciled home medications are required',
      );
    t.extension = this.replace(
      t,
      RECON,
      JSON.stringify({ ...d, recordedAt: new Date().toISOString() }),
    );
    return this.map(await this.medplumService.getClient().updateResource(t));
  }
  async summary(id: string, d: DischargeSummaryDto) {
    const t = await this.read(id, d.hospitalId);
    for (const k of [
      'authorName',
      'admissionReason',
      'hospitalCourse',
      'investigations',
      'conditionAtDischarge',
      'instructions',
      'followUp',
    ] as const)
      if (!String(d[k] ?? '').trim())
        throw new BadRequestException(`${k} is required`);
    if (!d.finalDiagnoses?.length || !d.dischargeMedications?.length)
      throw new BadRequestException(
        'Final diagnoses and discharge medications are required',
      );
    const sections = [
      ['Admission reason', d.admissionReason],
      ['Final diagnoses', d.finalDiagnoses.join('; ')],
      ['Procedures', d.procedures.join('; ') || 'None'],
      ['Hospital course', d.hospitalCourse],
      ['Investigations', d.investigations],
      ['Discharge medications', d.dischargeMedications.join('; ')],
      ['Condition at discharge', d.conditionAtDischarge],
      ['Patient instructions', d.instructions],
      ['Follow-up', d.followUp],
    ];
    const c: Composition = {
      resourceType: 'Composition',
      status: 'final',
      type: {
        coding: [
          {
            system: 'http://loinc.org',
            code: '18842-5',
            display: 'Discharge summary',
          },
        ],
      },
      subject: { reference: t.for?.reference, display: t.for?.display },
      encounter: { reference: t.encounter?.reference },
      date: new Date().toISOString(),
      author: [{ display: d.authorName.trim() }],
      title: 'Hospital Discharge Summary',
      section: sections.map(([title, text]) => ({
        title,
        text: {
          status: 'generated',
          div: `<div xmlns="http://www.w3.org/1999/xhtml"><p>${this.escape(text)}</p></div>`,
        },
      })),
      extension: [
        { url: HOSPITAL, valueReference: { reference: ORG(d.hospitalId) } },
      ],
    };
    const made = await this.medplumService.getClient().createResource(c);
    const appointment: Appointment = {
      resourceType: 'Appointment',
      status: 'proposed',
      description: d.followUp.trim(),
      reasonCode: [{ text: 'Post-discharge follow-up' }],
      participant: [
        {
          actor: { reference: t.for?.reference, display: t.for?.display },
          status: 'needs-action',
        },
      ],
      created: new Date().toISOString(),
      extension: [
        { url: HOSPITAL, valueReference: { reference: ORG(d.hospitalId) } },
        {
          url: `${BASE}/appointment-encounter`,
          valueReference: { reference: t.encounter?.reference },
        },
      ],
    };
    const followUp = await this.medplumService
      .getClient()
      .createResource(appointment);
    t.extension = this.replace(t, SUMMARY, `Composition/${made.id}`);
    t.extension = this.replace(t, FOLLOWUP, `Appointment/${followUp.id}`);
    return this.map(await this.medplumService.getClient().updateResource(t));
  }
  async clearance(id: string, d: DischargeClearanceDto) {
    const t = await this.read(id, d.hospitalId);
    if (
      !d.actorName?.trim() ||
      !['billing', 'pharmacy', 'nursing'].includes(d.department)
    )
      throw new BadRequestException('Valid department and actor are required');
    const clear = this.json(ext(t, CLEAR)?.valueString);
    clear[d.department] = {
      cleared: d.cleared,
      actorName: d.actorName,
      note: d.note,
      at: new Date().toISOString(),
    };
    t.extension = this.replace(t, CLEAR, JSON.stringify(clear));
    return this.map(await this.medplumService.getClient().updateResource(t));
  }
  async finalize(id: string, d: FinalizeDischargeDto) {
    if (!d.confirmation || !d.actorName?.trim())
      throw new BadRequestException(
        'Explicit confirmation and actor are required',
      );
    const t = await this.read(id, d.hospitalId),
      recon = ext(t, RECON)?.valueString,
      summary = ext(t, SUMMARY)?.valueString,
      clear = this.json(ext(t, CLEAR)?.valueString);
    if (!recon || !summary)
      throw new ConflictException(
        'Medication reconciliation and discharge summary are required',
      );
    for (const dep of ['billing', 'pharmacy', 'nursing'])
      if (!clear[dep]?.cleared)
        throw new ConflictException(`${dep} clearance is required`);
    const encounter = await this.encounter(
        t.encounter!.reference!.replace('Encounter/', ''),
        d.hospitalId,
      ),
      client = this.medplumService.getClient();
    const [orders, invoices] = await Promise.all([
      client.searchResources('ServiceRequest', {
        encounter: `Encounter/${encounter.id}`,
        _count: '500',
      }),
      client.searchResources('Invoice', {
        subject: encounter.subject?.reference,
        _count: '200',
      }),
    ]);
    if (
      orders.some((o: ServiceRequest) =>
        ['draft', 'active', 'on-hold'].includes(o.status),
      )
    )
      throw new ConflictException('Pending clinical orders must be resolved');
    const scoped = invoices.filter(
      (i: Invoice) =>
        i.issuer?.reference === ORG(d.hospitalId) &&
        i.extension?.some(
          (e) =>
            e.url === `${BASE}/billing-encounter` &&
            e.valueString === encounter.id,
        ),
    );
    if (!scoped.length || scoped.some((i) => i.status !== 'balanced'))
      throw new ConflictException('Billing is not fully cleared');
    const active = encounter.location?.find(
        (l) =>
          l.status === 'active' &&
          l.location.reference?.startsWith('Location/'),
      ),
      now = new Date().toISOString();
    encounter.location = encounter.location?.map((l) =>
      l === active
        ? { ...l, status: 'completed', period: { ...l.period, end: now } }
        : l,
    );
    encounter.status = 'finished';
    encounter.period = { ...encounter.period, end: now };
    encounter.hospitalization = {
      ...encounter.hospitalization,
      dischargeDisposition: { text: 'Home / completed discharge' },
    };
    await client.updateResource(encounter);
    if (active?.location.reference)
      await this.beds.markDirty(
        active.location.reference.replace('Location/', ''),
        d.hospitalId,
        d.actorName,
        'Patient discharged',
      );
    t.status = 'completed';
    t.executionPeriod = { end: now };
    return this.map(await client.updateResource(t));
  }
  private async encounter(id: string, h: string) {
    let e: Encounter;
    try {
      e = await this.medplumService.getClient().readResource('Encounter', id);
    } catch {
      throw new NotFoundException('Inpatient encounter not found');
    }
    if (
      e.serviceProvider?.reference !== ORG(h) ||
      !['in-progress', 'onleave'].includes(e.status)
    )
      throw new NotFoundException('Inpatient encounter not found');
    return e;
  }
  private async read(id: string, h: string) {
    let t: Task;
    try {
      t = await this.medplumService.getClient().readResource('Task', id);
    } catch {
      throw new NotFoundException('Discharge workflow not found');
    }
    if (
      ext(t, HOSPITAL)?.valueReference?.reference !== ORG(h) ||
      !t.code?.coding?.some((c) => c.code === 'discharge-workflow')
    )
      throw new NotFoundException('Discharge workflow not found');
    if (t.status === 'completed')
      throw new ConflictException('Discharge workflow is already completed');
    return t;
  }
  private replace(t: Task, url: string, valueString: string) {
    return [
      ...(t.extension ?? []).filter((e) => e.url !== url),
      { url, valueString },
    ];
  }
  private json(v?: string) {
    try {
      return JSON.parse(v ?? '{}') as Record<string, any>;
    } catch {
      return {};
    }
  }
  private escape(v: string) {
    return v.replace(
      /[&<>"']/g,
      (c) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[c]!,
    );
  }
  private map(t: Task) {
    const clear = this.json(ext(t, CLEAR)?.valueString);
    return {
      id: t.id,
      status: t.status,
      patientId: t.for?.reference?.replace('Patient/', ''),
      patientName: t.for?.display,
      encounterId: t.encounter?.reference?.replace('Encounter/', ''),
      decisionReason: t.description,
      physicianName: t.requester?.display,
      authoredOn: t.authoredOn,
      reconciliationComplete: Boolean(ext(t, RECON)),
      summaryId: ext(t, SUMMARY)?.valueString?.replace('Composition/', ''),
      followUpAppointmentId: ext(t, FOLLOWUP)?.valueString?.replace(
        'Appointment/',
        '',
      ),
      clearances: clear,
      ready: Boolean(
        ext(t, RECON) &&
        ext(t, SUMMARY) &&
        ['billing', 'pharmacy', 'nursing'].every((k) => clear[k]?.cleared),
      ),
    };
  }
}
