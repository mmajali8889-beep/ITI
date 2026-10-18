import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CodeableConcept,
  DiagnosticReport,
  DocumentReference,
  Encounter,
  Resource,
  ServiceRequest,
} from '@medplum/fhirtypes';
import { MedplumService } from '../medplum/medplum.service';
import { milestoneOf, pathwayFor } from './journey-pathways';
import { JourneyPathwaysService } from './journey-pathways.service';
// 'optional': not done, but not mandatory on this encounter's pathway.
type State =
  'completed' | 'current' | 'pending' | 'optional' | 'not-applicable';
type Node = {
  key: string;
  label: string;
  state: State;
  evidence: number;
  detail?: string;
  branch?: string;
  required?: boolean;
};
const FINAL_REPORT = ['final', 'amended', 'corrected', 'appended'];
// Radiology orders carry SNOMED 363679005 ("Imaging"); reports carry v2-0074 RAD.
const RADIOLOGY = /imag|radio|363679005|\brad\b/;
@Injectable()
export class PatientJourneyService {
  constructor(
    private readonly medplumService: MedplumService,
    private readonly pathways: JourneyPathwaysService,
  ) {}
  async get(patientId: string, encounterId: string, hospitalId: string) {
    if (!patientId || !encounterId || !hospitalId)
      throw new BadRequestException(
        'Patient, encounter and hospital are required',
      );
    let encounter: Encounter;
    try {
      encounter = await this.medplumService
        .getClient()
        .readResource('Encounter', encounterId);
    } catch {
      throw new NotFoundException('Journey not found');
    }
    if (
      encounter.subject?.reference !== `Patient/${patientId}` ||
      encounter.serviceProvider?.reference !== `Organization/${hospitalId}`
    )
      throw new NotFoundException('Journey not found');
    const c = this.medplumService.getClient(),
      eref = `Encounter/${encounterId}`,
      pref = `Patient/${patientId}`;
    const [
      appointments,
      coverages,
      eligibility,
      observations,
      conditions,
      notes,
      orders,
      reports,
      medications,
      dispenses,
      tasks,
      procedures,
      compositions,
      invoices,
      claims,
      carePlans,
    ] = await Promise.all([
      c.searchResources('Appointment', { actor: pref, _count: '500' }),
      c.searchResources('Coverage', { beneficiary: pref, _count: '200' }),
      c.searchResources('CoverageEligibilityResponse', {
        patient: pref,
        _count: '200',
      }),
      c.searchResources('Observation', { encounter: eref, _count: '1000' }),
      c.searchResources('Condition', { encounter: eref, _count: '500' }),
      c.searchResources('DocumentReference', {
        encounter: eref,
        _count: '500',
      }),
      c.searchResources('ServiceRequest', { encounter: eref, _count: '1000' }),
      c.searchResources('DiagnosticReport', { encounter: eref, _count: '500' }),
      c.searchResources('MedicationRequest', {
        encounter: eref,
        _count: '500',
      }),
      c.searchResources('MedicationDispense', { subject: pref, _count: '500' }),
      c.searchResources('Task', { encounter: eref, _count: '1000' }),
      c.searchResources('Procedure', { encounter: eref, _count: '500' }),
      c.searchResources('Composition', { encounter: eref, _count: '500' }),
      c.searchResources('Invoice', { subject: pref, _count: '500' }),
      c.searchResources('Claim', { patient: pref, _count: '500' }),
      c.searchResources('CarePlan', { encounter: eref, _count: '200' }),
    ]);
    const scoped = (r: Resource) => this.scoped(r, hospitalId),
      appointment = appointments.filter(
        (a) =>
          a.participant?.some((p) => p.actor?.reference === pref) &&
          (encounter.appointment?.some(
            (x) => x.reference === `Appointment/${a.id}`,
          ) ||
            a.extension?.some((x) => x.valueReference?.reference === eref)),
      ),
      triage =
        encounter.extension?.some((x) =>
          x.url.endsWith('/triage-completed-at'),
        ) ||
        ['triaged', 'in-progress', 'onleave', 'finished'].includes(
          encounter.status,
        ),
      labOrders = orders.filter((o) => this.category(o).includes('lab')),
      radOrders = orders.filter((o) => RADIOLOGY.test(this.category(o))),
      labReports = reports.filter(
        (r) =>
          FINAL_REPORT.includes(r.status) &&
          this.reportCategory(r).includes('lab'),
      ),
      radReports = reports.filter(
        (r) =>
          FINAL_REPORT.includes(r.status) &&
          RADIOLOGY.test(this.reportCategory(r)),
      ),
      reviewed = tasks.filter(
        (t) =>
          t.code?.coding?.some((x) => x.code === 'result-review') &&
          t.status === 'completed',
      ),
      completedReports = [...labReports, ...radReports],
      signedNotes = notes.filter((note) => this.signedNote(note)),
      encounterDispenses = dispenses.filter(
        (dispense) => dispense.context?.reference === eref,
      ),
      admission = orders.filter(
        (o) =>
          this.category(o) === 'admission-request' ||
          o.code?.coding?.some((x) => x.code === 'admission-request'),
      ),
      referral =
        encounter.hospitalization?.dischargeDisposition?.coding?.some((x) =>
          ['transfer', 'referred'].includes(x.code ?? ''),
        ) ||
        encounter.extension?.some((x) =>
          x.url.endsWith('/referral-destination'),
        ),
      dischargeTasks = tasks.filter((t) =>
        t.code?.coding?.some((x) => x.code === 'discharge-workflow'),
      ),
      dischargeDocs = compositions.filter(
        (x) =>
          x.type?.coding?.some((v) => v.code === '18842-5') &&
          ['final', 'amended'].includes(x.status),
      ),
      medicalRecords = compositions.filter(
        (x) =>
          x.type?.coding?.some((v) => v.code === '34133-9') &&
          ['final', 'amended'].includes(x.status),
      ),
      followups = appointments.filter(
        (a) =>
          a.reasonCode?.some((x) => /follow/i.test(x.text ?? '')) ||
          /follow/i.test(a.description ?? ''),
      ),
      encounterInvoices = invoices.filter(
        (i) =>
          scoped(i) && i.extension?.some((x) => x.valueString === encounterId),
      ),
      encounterClaims = claims.filter(
        (claim) =>
          scoped(claim) &&
          claim.item?.some((item) =>
            item.encounter?.some((value) => value.reference === eref),
          ),
      ),
      inpatient = encounter.class?.code === 'IMP',
      finished = encounter.status === 'finished';
    let nodes: Node[] = [
      this.node('mpi', 'Patient / MPI', true, 1),
      this.node(
        appointment.length ? 'appointment' : 'emergency',
        appointment.length ? 'Appointment' : 'Emergency / Direct Arrival',
        true,
        appointment.length || 1,
        appointment.length ? appointment[0].status : encounter.class?.code,
      ),
      this.node('encounter', 'Encounter', true, 1, encounter.status),
      this.node(
        'payer',
        'Insurance / Payer',
        coverages.filter(scoped).length > 0 || this.financial(encounter),
        coverages.filter(scoped).length + eligibility.filter(scoped).length,
      ),
      this.node('triage', 'Triage', Boolean(triage), observations.length),
      this.node(
        'assessment',
        'Doctor Assessment',
        conditions.length > 0 && signedNotes.length > 0,
        conditions.length + signedNotes.length,
      ),
      this.node(
        'lab',
        'Laboratory',
        labOrders.length === 0
          ? 'na'
          : labOrders.every((order) =>
              labReports.some((report) => this.reportForOrder(report, order)),
            ),
        labReports.length,
        labOrders.length
          ? `${labReports.length}/${labOrders.length} reported`
          : 'No order',
      ),
      this.node(
        'radiology',
        'Radiology',
        radOrders.length === 0
          ? 'na'
          : radOrders.every((order) =>
              radReports.some((report) => this.reportForOrder(report, order)),
            ),
        radReports.length,
        radOrders.length
          ? `${radReports.length}/${radOrders.length} reported`
          : 'No order',
      ),
      this.node(
        'pharmacy',
        'Pharmacy',
        medications.length === 0
          ? 'na'
          : medications.every((request) =>
              encounterDispenses.some((dispense) =>
                dispense.authorizingPrescription?.some(
                  (reference) =>
                    reference.reference === `MedicationRequest/${request.id}`,
                ),
              ),
            ),
        encounterDispenses.length,
      ),
      this.node(
        'review',
        'Doctor Review',
        completedReports.length === 0
          ? 'na'
          : completedReports.every((report) =>
              reviewed.some(
                (review) =>
                  review.focus?.reference === `DiagnosticReport/${report.id}`,
              ),
            ),
        reviewed.length,
      ),
      this.node(
        'disposition',
        'Disposition',
        finished || admission.length > 0 || Boolean(referral),
        Number(finished) + admission.length + Number(Boolean(referral)),
        referral
          ? 'Referral'
          : admission.length
            ? 'Admission'
            : finished
              ? 'Discharge'
              : 'Decision pending',
      ),
      this.node(
        'admission',
        'Admission',
        !inpatient && admission.length === 0 ? 'na' : inpatient,
        inpatient ? 1 : admission.length,
      ),
      this.node(
        'bed',
        'Bed Management',
        !inpatient ? 'na' : Boolean(encounter.location?.length),
        encounter.location?.length ?? 0,
      ),
      this.node(
        'ward',
        'Ward',
        !inpatient ? 'na' : inpatient && Boolean(encounter.location?.length),
        carePlans.length,
      ),
      this.node(
        'nursing-doctor',
        'Nursing + Doctor',
        !inpatient ? 'na' : carePlans.length > 0 || notes.length > 0,
        carePlans.length + notes.length,
      ),
      this.node(
        'surgery',
        'Surgery',
        this.branch(tasks, 'surgery') ||
          procedures.some((p) =>
            p.extension?.some((x) => x.url.includes('surgery')),
          )
          ? true
          : 'na',
        this.branchCount(tasks, 'surgery'),
      ),
      this.node(
        'icu',
        'ICU',
        this.branch(tasks, 'icu') ? true : 'na',
        this.branchCount(tasks, 'icu'),
      ),
      this.node(
        'procedures',
        'Procedures',
        procedures.length ? true : 'na',
        procedures.length,
      ),
      this.node(
        'discharge',
        'Discharge',
        !inpatient && finished
          ? true
          : dischargeTasks.length || dischargeDocs.length
            ? dischargeDocs.length > 0
            : false,
        dischargeTasks.length + dischargeDocs.length,
      ),
      this.node(
        'billing',
        'Billing / Insurance Claim',
        encounterInvoices.length > 0 &&
          (encounterInvoices.every((i) => i.status === 'balanced') ||
            encounterClaims.length > 0),
        encounterInvoices.length + encounterClaims.length,
      ),
      this.node(
        'medical-record',
        'Medical Record',
        medicalRecords.some(
          (record) =>
            record.extension?.find((x) => x.url.endsWith('/record-status'))
              ?.valueCode === 'archived',
        ),
        medicalRecords.length,
        medicalRecords[0]?.extension?.find((x) =>
          x.url.endsWith('/record-status'),
        )?.valueCode,
      ),
      this.node(
        'follow-up',
        'Follow-up',
        followups.length > 0,
        followups.length,
      ),
    ];
    // 27.3: only the milestones mandatory on this service line's pathway block
    // the journey and count towards completion.
    const pathway = await this.pathways.resolve(
      hospitalId,
      pathwayFor(encounter),
    );
    const required = new Set(pathway.required);
    let blocked = false;
    nodes = nodes.map((n) => {
      const node = { ...n, required: required.has(milestoneOf(n.key)) };
      if (node.state === 'not-applicable' || node.state === 'completed')
        return node;
      if (!node.required) return { ...node, state: 'optional' };
      if (!blocked) {
        blocked = true;
        return { ...node, state: 'current' };
      }
      return { ...node, state: 'pending' };
    });
    const counted = nodes.filter(
      (n) => n.required && n.state !== 'not-applicable',
    );
    return {
      hospitalId,
      patientId,
      encounterId,
      encounterStatus: encounter.status,
      encounterClass: encounter.class?.code,
      pathway: {
        code: pathway.code,
        label: pathway.label,
        source: pathway.source,
      },
      completion: Math.round(
        (counted.filter((n) => n.state === 'completed').length /
          Math.max(1, counted.length)) *
          100,
      ),
      currentStage:
        nodes.find((n) => n.state === 'current')?.key ??
        (finished ? 'complete' : 'encounter'),
      nodes,
      branches: {
        entry: appointment.length
          ? 'appointment'
          : encounter.class?.code === 'EMER'
            ? 'emergency'
            : 'direct',
        disposition: referral
          ? 'referral'
          : inpatient
            ? 'admission'
            : finished
              ? 'discharge'
              : 'undecided',
      },
    };
  }
  private node(
    key: string,
    label: string,
    done: boolean | 'na',
    evidence: number,
    detail?: string,
  ): Node {
    return {
      key,
      label,
      state: done === 'na' ? 'not-applicable' : done ? 'completed' : 'pending',
      evidence,
      detail,
    };
  }
  private scoped(r: Resource, h: string) {
    const x = r as Resource & {
      extension?: Array<{ valueReference?: { reference?: string } }>;
      provider?: { reference?: string };
      issuer?: { reference?: string };
    };
    return (
      x.extension?.some(
        (e) => e.valueReference?.reference === `Organization/${h}`,
      ) ||
      x.provider?.reference === `Organization/${h}` ||
      x.issuer?.reference === `Organization/${h}` ||
      false
    );
  }
  private category(o: ServiceRequest) {
    return (
      o.category
        ?.flatMap((x) => [
          ...(x.coding?.flatMap((v) => [v.code, v.display]) ?? []),
          x.text,
        ])
        .filter(Boolean)
        .join(' ') ?? ''
    ).toLowerCase();
  }
  private reportCategory(r: DiagnosticReport) {
    return `${r.category?.flatMap((x) => x.coding?.map((v) => `${v.code} ${v.display}`) ?? []).join(' ') ?? ''} ${r.code?.text ?? ''}`.toLowerCase();
  }
  private reportForOrder(report: DiagnosticReport, order: ServiceRequest) {
    return report.basedOn?.some(
      (reference) => reference.reference === `ServiceRequest/${order.id}`,
    );
  }
  private signedNote(note: DocumentReference) {
    const data = note.content?.[0]?.attachment?.data;
    if (!data) return false;
    try {
      const content = JSON.parse(
        Buffer.from(data, 'base64').toString('utf8'),
      ) as { status?: unknown };
      return content.status === 'signed';
    } catch {
      return false;
    }
  }
  private financial(e: Encounter) {
    return (
      e.extension?.some((x) => x.url.endsWith('/encounter-financial-class')) ??
      false
    );
  }
  private branch(t: Array<{ code?: CodeableConcept }>, name: string) {
    return t.some((x) =>
      x.code?.coding?.some((c) => String(c.code).includes(name)),
    );
  }
  private branchCount(t: Array<{ code?: CodeableConcept }>, name: string) {
    return t.filter((x) =>
      x.code?.coding?.some((c) => String(c.code).includes(name)),
    ).length;
  }
}
