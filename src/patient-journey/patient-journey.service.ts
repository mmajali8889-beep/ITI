import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Encounter, Resource } from '@medplum/fhirtypes';
import { MedplumService } from '../medplum/medplum.service';
type State = 'completed' | 'current' | 'pending' | 'not-applicable';
type Node = {
  key: string;
  label: string;
  state: State;
  evidence: number;
  detail?: string;
  branch?: string;
};
const FINAL_REPORT = ['final', 'amended', 'corrected', 'appended'];
@Injectable()
export class PatientJourneyService {
  constructor(private readonly medplumService: MedplumService) {}
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
      appointment = (appointments as any[]).filter(
        (a) =>
          a.participant?.some((p: any) => p.actor?.reference === pref) &&
          (encounter.appointment?.some(
            (x) => x.reference === `Appointment/${a.id}`,
          ) ||
            a.extension?.some(
              (x: any) => x.valueReference?.reference === eref,
            )),
      ),
      triage =
        encounter.extension?.some((x) =>
          x.url.endsWith('/triage-completed-at'),
        ) ||
        ['triaged', 'in-progress', 'onleave', 'finished'].includes(
          encounter.status,
        ),
      labOrders = (orders as any[]).filter((o) =>
        this.category(o).includes('lab'),
      ),
      radOrders = (orders as any[]).filter((o) =>
        /imag|radio/.test(this.category(o)),
      ),
      labReports = (reports as any[]).filter(
        (r) =>
          FINAL_REPORT.includes(r.status) &&
          this.reportCategory(r).includes('lab'),
      ),
      radReports = (reports as any[]).filter(
        (r) =>
          FINAL_REPORT.includes(r.status) &&
          /imag|radio/.test(this.reportCategory(r)),
      ),
      reviewed = (tasks as any[]).filter(
        (t) =>
          t.code?.coding?.some((x: any) => x.code === 'result-review') &&
          t.status === 'completed',
      ),
      completedReports = [...labReports, ...radReports],
      signedNotes = (notes as any[]).filter((note) => this.signedNote(note)),
      encounterDispenses = (dispenses as any[]).filter(
        (dispense) => dispense.context?.reference === eref,
      ),
      admission = (orders as any[]).filter(
        (o) =>
          this.category(o) === 'admission-request' ||
          o.code?.coding?.some((x: any) => x.code === 'admission-request'),
      ),
      referral =
        encounter.hospitalization?.dischargeDisposition?.coding?.some((x) =>
          ['transfer', 'referred'].includes(x.code ?? ''),
        ) ||
        encounter.extension?.some((x) =>
          x.url.endsWith('/referral-destination'),
        ),
      dischargeTasks = (tasks as any[]).filter((t) =>
        t.code?.coding?.some((x: any) => x.code === 'discharge-workflow'),
      ),
      dischargeDocs = (compositions as any[]).filter(
        (x) =>
          x.type?.coding?.some((v: any) => v.code === '18842-5') &&
          ['final', 'amended'].includes(x.status),
      ),
      medicalRecords = (compositions as any[]).filter(
        (x) =>
          x.type?.coding?.some((v: any) => v.code === '34133-9') &&
          ['final', 'amended'].includes(x.status),
      ),
      followups = (appointments as any[]).filter(
        (a) =>
          a.reasonCode?.some((x: any) => /follow/i.test(x.text ?? '')) ||
          /follow/i.test(a.description ?? ''),
      ),
      encounterInvoices = (invoices as any[]).filter(
        (i) =>
          scoped(i) &&
          i.extension?.some((x: any) => x.valueString === encounterId),
      ),
      encounterClaims = (claims as any[]).filter(
        (claim) =>
          scoped(claim) &&
          claim.item?.some((item: any) =>
            item.encounter?.some((value: any) => value.reference === eref),
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
                  (reference: any) =>
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
          procedures.some((p: any) =>
            p.extension?.some((x: any) => x.url.includes('surgery')),
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
          (encounterInvoices.every((i: any) => i.status === 'balanced') ||
            encounterClaims.length > 0),
        encounterInvoices.length + encounterClaims.length,
      ),
      this.node(
        'medical-record',
        'Medical Record',
        medicalRecords.some(
          (record: any) =>
            record.extension?.find((x: any) => x.url.endsWith('/record-status'))
              ?.valueCode === 'archived',
        ),
        medicalRecords.length,
        medicalRecords[0]?.extension?.find((x: any) =>
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
    let blocked = false;
    nodes = nodes.map((n) => {
      if (n.state === 'not-applicable' || n.state === 'completed') return n;
      if (!blocked) {
        blocked = true;
        return { ...n, state: 'current' };
      }
      return { ...n, state: 'pending' };
    });
    return {
      hospitalId,
      patientId,
      encounterId,
      encounterStatus: encounter.status,
      encounterClass: encounter.class?.code,
      completion: Math.round(
        (nodes.filter((n) => n.state === 'completed').length /
          Math.max(
            1,
            nodes.filter((n) => n.state !== 'not-applicable').length,
          )) *
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
  private category(o: any) {
    return `${o.category?.flatMap((x: any) => x.coding?.map((v: any) => v.code) ?? []).join(' ') ?? ''}`.toLowerCase();
  }
  private reportCategory(r: any) {
    return `${r.category?.flatMap((x: any) => x.coding?.map((v: any) => `${v.code} ${v.display}`) ?? []).join(' ') ?? ''} ${r.code?.text ?? ''}`.toLowerCase();
  }
  private reportForOrder(report: any, order: any) {
    return report.basedOn?.some(
      (reference: any) => reference.reference === `ServiceRequest/${order.id}`,
    );
  }
  private signedNote(note: any) {
    const data = note.content?.[0]?.attachment?.data;
    if (!data) return false;
    try {
      return (
        JSON.parse(Buffer.from(data, 'base64').toString('utf8')).status ===
        'signed'
      );
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
  private branch(t: any[], name: string) {
    return t.some((x) =>
      x.code?.coding?.some((c: any) => String(c.code).includes(name)),
    );
  }
  private branchCount(t: any[], name: string) {
    return t.filter((x) =>
      x.code?.coding?.some((c: any) => String(c.code).includes(name)),
    ).length;
  }
}
