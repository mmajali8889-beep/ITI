import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CarePlan,
  Condition,
  DiagnosticReport,
  DocumentReference,
  Encounter,
  Location,
  MedicationAdministration,
  MedicationRequest,
  Observation,
  Patient,
  ServiceRequest,
} from '@medplum/fhirtypes';
import { MedplumService } from '../medplum/medplum.service';
import {
  CreateInpatientRoundDto,
  RoundOrderDto,
} from './dto/inpatient-round.dto';
const BASE = 'https://hospital-ehr.local/fhir/StructureDefinition',
  HOSPITAL = `${BASE}/round-hospital`,
  ROUND = `${BASE}/inpatient-round`,
  WARD = `${BASE}/ward-code`;
const org = (id: string) => `Organization/${id}`;
const id = (ref?: string) => ref?.split('/')[1];
@Injectable()
export class InpatientRoundsService {
  constructor(private readonly medplumService: MedplumService) {}
  async patientList(hospitalId: string, wardCode?: string) {
    if (!hospitalId) throw new BadRequestException('Hospital ID is required');
    const client = this.medplumService.getClient();
    const [encounters, locations, notes] = await Promise.all([
      client.searchResources('Encounter', {
        status: 'in-progress,triaged,onleave',
        _count: '500',
      }),
      client.searchResources('Location', {
        organization: hospitalId,
        status: 'active',
        _count: '500',
      }),
      client.searchResources('DocumentReference', { _count: '1000' }),
    ]);
    const locationMap = new Map(locations.map((v) => [v.id, v]));
    const patients = encounters
      .filter(
        (e) =>
          e.serviceProvider?.reference === org(hospitalId) &&
          e.class?.code === 'IMP',
      )
      .map((e) => {
        const active = e.location?.find((v) => v.status === 'active'),
          bedId = id(active?.location.reference),
          bed = bedId ? locationMap.get(bedId) : undefined,
          ward = bed?.extension?.find((v) => v.url === WARD)?.valueString;
        const roundNotes = notes.filter(
          (n) =>
            n.context?.encounter?.some(
              (v) => v.reference === `Encounter/${e.id}`,
            ) && n.extension?.some((v) => v.url === ROUND && v.valueBoolean),
        );
        return {
          patientId: id(e.subject?.reference),
          patientName:
            e.subject?.display ??
            `Patient ${id(e.subject?.reference)?.slice(0, 8)}`,
          encounterId: e.id,
          wardCode: ward,
          roomNumber: bed?.extension?.find(
            (v) => v.url === `${BASE}/room-number`,
          )?.valueString,
          bedName: bed?.identifier?.[0]?.value ?? bed?.name,
          admittedAt: e.period?.start,
          lastRoundAt: roundNotes.sort((a, b) =>
            String(b.date).localeCompare(String(a.date)),
          )[0]?.date,
        };
      })
      .filter((v) => !wardCode || v.wardCode === wardCode);
    return {
      hospitalId,
      wards: [
        ...new Set(patients.map((v) => v.wardCode).filter(Boolean)),
      ].sort(),
      patients,
    };
  }
  async timeline(encounterId: string, hospitalId: string) {
    const encounter = await this.readEncounter(encounterId, hospitalId);
    const client = this.medplumService.getClient(),
      params = { encounter: `Encounter/${encounterId}`, _count: '500' };
    const [
      observations,
      reports,
      orders,
      medications,
      administrations,
      documents,
      conditions,
      plans,
    ] = await Promise.all([
      client.searchResources('Observation', params),
      client.searchResources('DiagnosticReport', params),
      client.searchResources('ServiceRequest', params),
      client.searchResources('MedicationRequest', params),
      client.searchResources('MedicationAdministration', params),
      client.searchResources('DocumentReference', params),
      client.searchResources('Condition', params),
      client.searchResources('CarePlan', params),
    ]);
    const items = [
      ...observations.map((v) => this.observation(v)),
      ...reports.map((v) => this.report(v)),
      ...orders.map((v) => this.order(v)),
      ...medications.map((v) => this.medication(v)),
      ...administrations.map((v) => this.administration(v)),
      ...documents.map((v) => this.document(v)),
      ...conditions.map((v) => this.condition(v)),
      ...plans.map((v) => this.plan(v)),
    ]
      .filter((v) => v.at)
      .sort((a, b) => String(b.at).localeCompare(String(a.at)));
    const overnightSince = Date.now() - 12 * 60 * 60 * 1000;
    return {
      encounterId,
      patientId: id(encounter.subject?.reference),
      patientName: encounter.subject?.display,
      generatedAt: new Date().toISOString(),
      overnightSince: new Date(overnightSince).toISOString(),
      summary: {
        vitals: observations.length,
        labResults: reports.filter((v) => this.category(v, 'laboratory'))
          .length,
        radiologyResults: reports.filter((v) => !this.category(v, 'laboratory'))
          .length,
        activeMedications: medications.filter((v) => v.status === 'active')
          .length,
        newEvents: items.filter((v) => Date.parse(v.at!) >= overnightSince)
          .length,
      },
      items,
    };
  }
  async createRound(dto: CreateInpatientRoundDto) {
    await this.validate(dto);
    const now = new Date().toISOString(),
      content = {
        overnightEvents: dto.overnightEvents?.trim(),
        physicalExamination: dto.physicalExamination.trim(),
        progressNote: dto.progressNote.trim(),
        assessment: dto.assessment.trim(),
        plan: dto.plan.trim(),
        createdAt: now,
        physicianId: dto.physicianId,
        physicianName: dto.physicianName.trim(),
      };
    const author = dto.physicianId
      ? {
          reference: `Practitioner/${dto.physicianId}`,
          display: dto.physicianName.trim(),
        }
      : { display: dto.physicianName.trim() };
    const note: DocumentReference = {
      resourceType: 'DocumentReference',
      status: 'current',
      type: {
        coding: [
          {
            system: 'http://loinc.org',
            code: '11506-3',
            display: 'Progress note',
          },
        ],
        text: 'Inpatient physician round',
      },
      subject: { reference: `Patient/${dto.patientId}` },
      author: [author],
      date: now,
      description: 'Inpatient physician round',
      context: {
        encounter: [{ reference: `Encounter/${dto.encounterId}` }],
        related: [{ reference: org(dto.hospitalId) }],
      },
      content: [
        {
          attachment: {
            contentType: 'application/json',
            data: Buffer.from(JSON.stringify(content)).toString('base64'),
            title: 'Inpatient physician round',
            creation: now,
          },
        },
      ],
      extension: [
        { url: HOSPITAL, valueReference: { reference: org(dto.hospitalId) } },
        { url: ROUND, valueBoolean: true },
      ],
    };
    const createdNote = await this.medplumService
      .getClient()
      .createResource(note);
    const createdOrders: Array<{
      id: string | undefined;
      type: string;
      name: string;
    }> = [];
    for (const order of dto.orders ?? [])
      createdOrders.push(await this.createOrder(dto, order, author));
    return { noteId: createdNote.id, createdAt: now, orders: createdOrders };
  }
  private async createOrder(
    dto: CreateInpatientRoundDto,
    order: RoundOrderDto,
    requester: { reference?: string; display?: string },
  ) {
    if (
      ![
        'laboratory',
        'radiology',
        'procedure',
        'consultation',
        'medication',
        'other',
      ].includes(order.type) ||
      !order.name?.trim()
    )
      throw new BadRequestException(
        'Every order requires a valid type and name',
      );
    const category =
      order.type === 'laboratory'
        ? 'laboratory'
        : order.type === 'radiology'
          ? 'imaging'
          : order.type;
    if (order.type === 'medication') {
      const resource: MedicationRequest = {
        resourceType: 'MedicationRequest',
        status: 'active',
        intent: 'order',
        priority: order.priority ?? 'routine',
        medicationCodeableConcept: {
          coding: order.code
            ? [
                {
                  system: 'https://hospital-ehr.local/CodeSystem/medications',
                  code: order.code,
                  display: order.name.trim(),
                },
              ]
            : undefined,
          text: order.name.trim(),
        },
        subject: { reference: `Patient/${dto.patientId}` },
        encounter: { reference: `Encounter/${dto.encounterId}` },
        authoredOn: new Date().toISOString(),
        requester,
        note: order.instructions
          ? [{ text: order.instructions.trim() }]
          : undefined,
      };
      const made = await this.medplumService
        .getClient()
        .createResource(resource);
      return { id: made.id, type: order.type, name: order.name };
    }
    const resource: ServiceRequest = {
      resourceType: 'ServiceRequest',
      status: 'active',
      intent: 'order',
      priority: order.priority ?? 'routine',
      category: [
        {
          coding: [
            {
              system: 'https://hospital-ehr.local/CodeSystem/order-category',
              code: category,
              display: order.type,
            },
          ],
        },
      ],
      code: {
        coding: order.code
          ? [
              {
                system: 'https://hospital-ehr.local/CodeSystem/services',
                code: order.code,
                display: order.name.trim(),
              },
            ]
          : undefined,
        text: order.name.trim(),
      },
      subject: { reference: `Patient/${dto.patientId}` },
      encounter: { reference: `Encounter/${dto.encounterId}` },
      authoredOn: new Date().toISOString(),
      requester,
      note: order.instructions
        ? [{ text: order.instructions.trim() }]
        : undefined,
      extension: [
        { url: HOSPITAL, valueReference: { reference: org(dto.hospitalId) } },
      ],
    };
    const made = await this.medplumService.getClient().createResource(resource);
    return { id: made.id, type: order.type, name: order.name };
  }
  private async validate(dto: CreateInpatientRoundDto) {
    for (const key of [
      'hospitalId',
      'patientId',
      'encounterId',
      'physicianName',
      'physicalExamination',
      'progressNote',
      'assessment',
      'plan',
    ] as const)
      if (!String(dto[key] ?? '').trim())
        throw new BadRequestException(`${key} is required`);
    let patient: Patient;
    try {
      patient = await this.medplumService
        .getClient()
        .readResource('Patient', dto.patientId);
    } catch {
      throw new NotFoundException('Patient not found');
    }
    const encounter = await this.readEncounter(dto.encounterId, dto.hospitalId);
    if (
      patient.managingOrganization?.reference !== org(dto.hospitalId) ||
      encounter.subject?.reference !== `Patient/${dto.patientId}`
    )
      throw new NotFoundException('Patient or encounter not found');
    if (
      encounter.class?.code !== 'IMP' ||
      !['in-progress', 'triaged', 'onleave'].includes(encounter.status)
    )
      throw new ConflictException('An active inpatient encounter is required');
  }
  private async readEncounter(encounterId: string, hospitalId: string) {
    if (!encounterId || !hospitalId)
      throw new BadRequestException('Encounter and hospital are required');
    let encounter: Encounter;
    try {
      encounter = await this.medplumService
        .getClient()
        .readResource('Encounter', encounterId);
    } catch {
      throw new NotFoundException('Inpatient encounter not found');
    }
    if (encounter.serviceProvider?.reference !== org(hospitalId))
      throw new NotFoundException('Inpatient encounter not found');
    return encounter;
  }
  private text(value?: string) {
    return value?.trim() || 'No narrative';
  }
  private category(v: DiagnosticReport, code: string) {
    return v.category?.some((c) => c.coding?.some((x) => x.code === code));
  }
  private observation(v: Observation) {
    return {
      id: v.id,
      type: 'vital',
      title: v.code.text ?? v.code.coding?.[0]?.display ?? 'Observation',
      detail: v.valueQuantity
        ? `${v.valueQuantity.value ?? ''} ${v.valueQuantity.unit ?? ''}`
        : (v.valueString ?? v.note?.[0]?.text),
      status: v.status,
      at: v.effectiveDateTime ?? v.issued,
      source: 'Observation',
    };
  }
  private report(v: DiagnosticReport) {
    return {
      id: v.id,
      type: this.category(v, 'laboratory') ? 'laboratory' : 'radiology',
      title: v.code.text ?? v.code.coding?.[0]?.display ?? 'Diagnostic report',
      detail: this.text(v.conclusion),
      status: v.status,
      at: v.issued ?? v.effectiveDateTime,
      source: 'DiagnosticReport',
    };
  }
  private order(v: ServiceRequest) {
    return {
      id: v.id,
      type: 'order',
      title: v.code?.text ?? v.code?.coding?.[0]?.display ?? 'Clinical order',
      detail: v.note?.[0]?.text,
      status: v.status,
      at: v.authoredOn,
      source: 'ServiceRequest',
    };
  }
  private medication(v: MedicationRequest) {
    return {
      id: v.id,
      type: 'medication',
      title:
        v.medicationCodeableConcept?.text ??
        v.medicationCodeableConcept?.coding?.[0]?.display ??
        'Medication order',
      detail: v.dosageInstruction?.[0]?.text ?? v.note?.[0]?.text,
      status: v.status,
      at: v.authoredOn,
      source: 'MedicationRequest',
    };
  }
  private administration(v: MedicationAdministration) {
    return {
      id: v.id,
      type: 'medication',
      title:
        v.medicationCodeableConcept?.text ??
        v.medicationCodeableConcept?.coding?.[0]?.display ??
        'Medication administration',
      detail: v.note?.[0]?.text,
      status: v.status,
      at: v.effectiveDateTime ?? v.effectivePeriod?.start,
      source: 'MedicationAdministration',
    };
  }
  private document(v: DocumentReference) {
    let detail = v.description;
    try {
      const data = v.content?.[0]?.attachment.data;
      if (data) {
        const parsed = JSON.parse(Buffer.from(data, 'base64').toString('utf8'));
        detail =
          parsed.progressNote ?? parsed.note ?? parsed.assessment ?? detail;
      }
    } catch {}
    return {
      id: v.id,
      type: v.extension?.some((x) => x.url === ROUND && x.valueBoolean)
        ? 'round'
        : 'note',
      title: v.type?.text ?? v.description ?? 'Clinical note',
      detail,
      status: v.status,
      at: v.date ?? v.content?.[0]?.attachment.creation,
      source: 'DocumentReference',
    };
  }
  private condition(v: Condition) {
    return {
      id: v.id,
      type: 'diagnosis',
      title: v.code?.text ?? v.code?.coding?.[0]?.display ?? 'Diagnosis',
      detail: v.code?.coding?.[0]?.code,
      status: v.clinicalStatus?.coding?.[0]?.code,
      at: v.recordedDate,
      source: 'Condition',
    };
  }
  private plan(v: CarePlan) {
    return {
      id: v.id,
      type: 'care-plan',
      title: v.title ?? 'Care plan',
      detail: v.activity
        ?.map((a) => a.detail?.description)
        .filter(Boolean)
        .join(' · '),
      status: v.status,
      at: v.period?.start,
      source: 'CarePlan',
    };
  }
}
