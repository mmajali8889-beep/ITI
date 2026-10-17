import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CarePlan,
  DocumentReference,
  Encounter,
  Location,
  Observation,
  Patient,
  QuestionnaireResponse,
  Task,
} from '@medplum/fhirtypes';
import { MedplumService } from '../medplum/medplum.service';
import {
  CompleteNursingTaskDto,
  CreateCarePlanDto,
  CreateNursingNoteDto,
  CreateNursingTaskDto,
  NursingAdmissionAssessmentDto,
  NursingContextDto,
  NursingObservationType,
  RecordNursingObservationDto,
} from './dto/nursing.dto';

const BASE = 'https://hospital-ehr.local/fhir/StructureDefinition';
const HOSPITAL = `${BASE}/nursing-hospital`,
  KIND = `${BASE}/nursing-kind`,
  WARD = `${BASE}/ward-code`;
const org = (id: string) => `Organization/${id}`;
const refId = (reference?: string) => reference?.split('/')[1];
const ext = (
  resource: {
    extension?: Array<{
      url: string;
      valueString?: string;
      valueReference?: { reference?: string };
    }>;
  },
  url: string,
) => resource.extension?.find((item) => item.url === url);

@Injectable()
export class NursingService {
  constructor(private readonly medplumService: MedplumService) {}

  async admissionAssessment(dto: NursingAdmissionAssessmentDto) {
    await this.validateContext(dto);
    if (
      !dto.confirmed ||
      !dto.assessment ||
      !Object.keys(dto.assessment).length
    )
      throw new BadRequestException(
        'A confirmed nursing admission assessment is required',
      );
    const client = this.medplumService.getClient();
    const existing = await client.searchResources('QuestionnaireResponse', {
      encounter: `Encounter/${dto.encounterId}`,
      _count: '50',
    });
    if (
      existing.some(
        (item) => ext(item, KIND)?.valueString === 'admission-assessment',
      )
    )
      throw new ConflictException(
        'Nursing admission assessment is already complete',
      );
    const resource: QuestionnaireResponse = {
      resourceType: 'QuestionnaireResponse',
      status: 'completed',
      subject: { reference: `Patient/${dto.patientId}` },
      encounter: { reference: `Encounter/${dto.encounterId}` },
      authored: new Date().toISOString(),
      author: this.nurse(dto),
      item: [
        {
          linkId: 'assessment',
          text: 'Nursing admission assessment',
          answer: [{ valueString: JSON.stringify(dto.assessment) }],
        },
      ],
      extension: this.extensions(dto.hospitalId, 'admission-assessment'),
    };
    return this.mapAssessment(await client.createResource(resource));
  }

  async createCarePlan(dto: CreateCarePlanDto) {
    await this.validateContext(dto);
    if (!dto.title?.trim() || !dto.goals?.length || !dto.interventions?.length)
      throw new BadRequestException(
        'Title, goals and interventions are required',
      );
    if (dto.reviewAt && !Number.isFinite(Date.parse(dto.reviewAt)))
      throw new BadRequestException('Invalid review date');
    const resource: CarePlan = {
      resourceType: 'CarePlan',
      status: 'active',
      intent: 'plan',
      title: dto.title.trim(),
      subject: { reference: `Patient/${dto.patientId}` },
      encounter: { reference: `Encounter/${dto.encounterId}` },
      author: this.nurse(dto),
      period: {
        start: new Date().toISOString(),
        ...(dto.reviewAt ? { end: new Date(dto.reviewAt).toISOString() } : {}),
      },
      activity: dto.interventions.map((description) => ({
        detail: { status: 'not-started', description: description.trim() },
      })),
      extension: [
        ...this.extensions(dto.hospitalId, 'care-plan'),
        {
          url: `${BASE}/care-goals`,
          valueString: JSON.stringify(dto.goals.map((v) => v.trim())),
        },
      ],
    };
    return this.medplumService.getClient().createResource(resource);
  }

  async recordObservation(dto: RecordNursingObservationDto) {
    await this.validateContext(dto);
    const allowed: NursingObservationType[] = [
      'iv-fluid',
      'intake',
      'output',
      'pain',
      'fall-risk',
      'pressure-injury-risk',
      'monitoring',
    ];
    if (!allowed.includes(dto.type))
      throw new BadRequestException('Invalid nursing observation type');
    const numeric = dto.score ?? dto.value;
    if (numeric === undefined && !dto.text?.trim())
      throw new BadRequestException('A value, score or note is required');
    if (
      dto.type === 'pain' &&
      (numeric === undefined || numeric < 0 || numeric > 10)
    )
      throw new BadRequestException('Pain score must be between 0 and 10');
    if (
      ['fall-risk', 'pressure-injury-risk'].includes(dto.type) &&
      numeric !== undefined &&
      numeric < 0
    )
      throw new BadRequestException('Risk score cannot be negative');
    if (dto.occurredAt && !Number.isFinite(Date.parse(dto.occurredAt)))
      throw new BadRequestException('Invalid observation date');
    const codes: Record<NursingObservationType, [string, string]> = {
      'iv-fluid': ['nursing-iv-fluid', 'IV / fluid monitoring'],
      intake: ['nursing-intake', 'Fluid intake'],
      output: ['nursing-output', 'Fluid output'],
      pain: ['72514-3', 'Pain severity'],
      'fall-risk': ['73831-0', 'Fall risk assessment'],
      'pressure-injury-risk': ['nursing-pressure-risk', 'Pressure injury risk'],
      monitoring: ['nursing-monitoring', 'Ongoing nursing monitoring'],
    };
    const [code, display] = codes[dto.type];
    const resource: Observation = {
      resourceType: 'Observation',
      status: 'final',
      category: [
        {
          coding: [
            {
              system:
                'http://terminology.hl7.org/CodeSystem/observation-category',
              code: 'survey',
              display: 'Survey',
            },
          ],
        },
      ],
      code: {
        coding: [
          {
            system: code.match(/^\d/)
              ? 'http://loinc.org'
              : 'https://hospital-ehr.local/CodeSystem/nursing-observation',
            code,
            display,
          },
        ],
        text: display,
      },
      subject: { reference: `Patient/${dto.patientId}` },
      encounter: { reference: `Encounter/${dto.encounterId}` },
      performer: [this.nurse(dto)],
      effectiveDateTime: dto.occurredAt
        ? new Date(dto.occurredAt).toISOString()
        : new Date().toISOString(),
      extension: this.extensions(dto.hospitalId, dto.type),
    };
    if (numeric !== undefined)
      resource.valueQuantity = { value: numeric, unit: dto.unit };
    else resource.valueString = dto.text!.trim();
    if (dto.text?.trim() && numeric !== undefined)
      resource.note = [{ text: dto.text.trim() }];
    return this.medplumService.getClient().createResource(resource);
  }

  async createNote(dto: CreateNursingNoteDto) {
    await this.validateContext(dto);
    if (!dto.note?.trim())
      throw new BadRequestException('Nursing note is required');
    const resource: DocumentReference = {
      resourceType: 'DocumentReference',
      status: 'current',
      type: {
        coding: [
          {
            system: 'http://loinc.org',
            code: '34746-8',
            display: 'Nursing note',
          },
        ],
      },
      subject: { reference: `Patient/${dto.patientId}` },
      author: [this.nurse(dto)],
      date: new Date().toISOString(),
      content: [
        {
          attachment: {
            contentType: 'text/plain;charset=utf-8',
            data: Buffer.from(dto.note.trim(), 'utf8').toString('base64'),
          },
        },
      ],
      context: {
        encounter: [{ reference: `Encounter/${dto.encounterId}` }],
        related: [{ reference: org(dto.hospitalId) }],
      },
      extension: this.extensions(dto.hospitalId, 'nursing-note'),
    };
    return this.medplumService.getClient().createResource(resource);
  }

  async createTask(dto: CreateNursingTaskDto) {
    await this.validateContext(dto);
    if (!dto.title?.trim() || !Number.isFinite(Date.parse(dto.dueAt)))
      throw new BadRequestException('Title and valid due date are required');
    const resource: Task = {
      resourceType: 'Task',
      status: 'ready',
      intent: 'order',
      priority: dto.priority ?? 'routine',
      code: {
        coding: [
          {
            system: 'https://hospital-ehr.local/CodeSystem/workflow-task',
            code: 'nursing-care',
            display: 'Nursing care task',
          },
        ],
      },
      description: dto.description?.trim(),
      for: { reference: `Patient/${dto.patientId}` },
      encounter: { reference: `Encounter/${dto.encounterId}` },
      authoredOn: new Date().toISOString(),
      requester: this.nurse(dto),
      owner: this.nurse(dto),
      restriction: { period: { end: new Date(dto.dueAt).toISOString() } },
      extension: [
        ...this.extensions(dto.hospitalId, 'nursing-task'),
        { url: `${BASE}/task-title`, valueString: dto.title.trim() },
      ],
    };
    return this.mapTask(
      await this.medplumService.getClient().createResource(resource),
    );
  }

  async completeTask(id: string, dto: CompleteNursingTaskDto) {
    if (!id || !dto.hospitalId || !dto.nurseName?.trim())
      throw new BadRequestException('Task, hospital and nurse are required');
    let task: Task;
    try {
      task = await this.medplumService.getClient().readResource('Task', id);
    } catch {
      throw new NotFoundException('Nursing task not found');
    }
    if (
      ext(task, HOSPITAL)?.valueReference?.reference !== org(dto.hospitalId) ||
      !task.code?.coding?.some((code) => code.code === 'nursing-care')
    )
      throw new NotFoundException('Nursing task not found');
    if (!['ready', 'in-progress'].includes(task.status))
      throw new ConflictException('Only an open nursing task can be completed');
    task.status = 'completed';
    task.executionPeriod = {
      ...(task.executionPeriod ?? {}),
      end: new Date().toISOString(),
    };
    task.owner = dto.nurseId
      ? {
          reference: `Practitioner/${dto.nurseId}`,
          display: dto.nurseName.trim(),
        }
      : { display: dto.nurseName.trim() };
    if (dto.completionNote?.trim())
      task.output = [
        {
          type: { text: 'Completion note' },
          valueString: dto.completionNote.trim(),
        },
      ];
    return this.mapTask(
      await this.medplumService.getClient().updateResource(task),
    );
  }

  async dashboard(hospitalId: string, wardCode?: string) {
    if (!hospitalId) throw new BadRequestException('Hospital ID is required');
    const client = this.medplumService.getClient();
    const [encounters, locations, tasks, assessments, plans, observations] =
      await Promise.all([
        client.searchResources('Encounter', {
          status: 'in-progress,triaged,onleave',
          _count: '500',
        }),
        client.searchResources('Location', {
          organization: hospitalId,
          status: 'active',
          _count: '500',
        }),
        client.searchResources('Task', {
          status: 'ready,in-progress',
          _count: '1000',
        }),
        client.searchResources('QuestionnaireResponse', {
          status: 'completed',
          _count: '1000',
        }),
        client.searchResources('CarePlan', {
          status: 'active',
          _count: '1000',
        }),
        client.searchResources('Observation', {
          status: 'final',
          _count: '1000',
        }),
      ]);
    const locationMap = new Map(locations.map((item) => [item.id, item]));
    const now = Date.now();
    const admitted = encounters
      .filter(
        (item) =>
          item.serviceProvider?.reference === org(hospitalId) &&
          item.class?.code === 'IMP',
      )
      .filter(
        (item) => !wardCode || this.wardFor(item, locationMap) === wardCode,
      );
    const patients = admitted
      .map((encounter) => {
        const encounterRef = `Encounter/${encounter.id}`;
        const patientId = refId(encounter.subject?.reference);
        const patientTasks = tasks
          .filter(
            (task) =>
              task.encounter?.reference === encounterRef &&
              ext(task, HOSPITAL)?.valueReference?.reference ===
                org(hospitalId) &&
              task.code?.coding?.some((code) => code.code === 'nursing-care'),
          )
          .map((task) => this.mapTask(task, now))
          .sort((a, b) => String(a.dueAt).localeCompare(String(b.dueAt)));
        const latest = observations
          .filter(
            (item) =>
              item.encounter?.reference === encounterRef &&
              ext(item, HOSPITAL)?.valueReference?.reference ===
                org(hospitalId),
          )
          .sort((a, b) =>
            String(b.effectiveDateTime ?? '').localeCompare(
              String(a.effectiveDateTime ?? ''),
            ),
          )
          .slice(0, 5)
          .map((item) => ({
            id: item.id,
            type: ext(item, KIND)?.valueString,
            at: item.effectiveDateTime,
            value: item.valueQuantity?.value ?? item.valueString,
            unit: item.valueQuantity?.unit,
          }));
        const active = encounter.location?.find(
          (item) => item.status === 'active',
        );
        const bedId = refId(active?.location.reference);
        const bed = bedId ? locationMap.get(bedId) : undefined;
        return {
          patientId,
          patientName:
            encounter.subject?.display ?? `Patient ${patientId?.slice(0, 8)}`,
          encounterId: encounter.id,
          wardCode: this.wardFor(encounter, locationMap),
          wardName: ext(bed ?? {}, `${BASE}/ward-name`)?.valueString,
          roomNumber: ext(bed ?? {}, `${BASE}/room-number`)?.valueString,
          bedName: bed?.identifier?.[0]?.value ?? bed?.name,
          admittedAt: encounter.period?.start,
          admissionAssessmentComplete: assessments.some(
            (item) =>
              item.encounter?.reference === encounterRef &&
              ext(item, KIND)?.valueString === 'admission-assessment',
          ),
          activeCarePlan: plans.some(
            (item) =>
              item.encounter?.reference === encounterRef &&
              ext(item, HOSPITAL)?.valueReference?.reference ===
                org(hospitalId),
          ),
          tasks: patientTasks,
          overdueCount: patientTasks.filter((task) => task.overdue).length,
          latestObservations: latest,
        };
      })
      .sort(
        (a, b) =>
          b.overdueCount - a.overdueCount ||
          a.patientName.localeCompare(b.patientName),
      );
    const allTasks = patients.flatMap((item) => item.tasks);
    return {
      generatedAt: new Date().toISOString(),
      hospitalId,
      wardCode: wardCode ?? null,
      summary: {
        patients: patients.length,
        tasksDue: allTasks.length,
        overdue: allTasks.filter((item) => item.overdue).length,
        assessmentsPending: patients.filter(
          (item) => !item.admissionAssessmentComplete,
        ).length,
        carePlansPending: patients.filter((item) => !item.activeCarePlan)
          .length,
      },
      wards: [
        ...new Set(patients.map((item) => item.wardCode).filter(Boolean)),
      ].sort(),
      patients,
    };
  }

  private async validateContext(dto: NursingContextDto) {
    for (const key of [
      'hospitalId',
      'patientId',
      'encounterId',
      'nurseName',
    ] as const)
      if (!String(dto[key] ?? '').trim())
        throw new BadRequestException(`${key} is required`);
    let patient: Patient, encounter: Encounter;
    try {
      [patient, encounter] = await Promise.all([
        this.medplumService.getClient().readResource('Patient', dto.patientId),
        this.medplumService
          .getClient()
          .readResource('Encounter', dto.encounterId),
      ]);
    } catch {
      throw new NotFoundException('Patient or inpatient encounter not found');
    }
    if (
      patient.managingOrganization?.reference !== org(dto.hospitalId) ||
      encounter.serviceProvider?.reference !== org(dto.hospitalId) ||
      encounter.subject?.reference !== `Patient/${dto.patientId}`
    )
      throw new NotFoundException('Patient or inpatient encounter not found');
    if (
      encounter.class?.code !== 'IMP' ||
      !['in-progress', 'triaged', 'onleave'].includes(encounter.status)
    )
      throw new ConflictException('An active inpatient encounter is required');
  }
  private nurse(dto: { nurseId?: string; nurseName: string }) {
    return dto.nurseId
      ? {
          reference: `Practitioner/${dto.nurseId}`,
          display: dto.nurseName.trim(),
        }
      : { display: dto.nurseName.trim() };
  }
  private extensions(hospitalId: string, kind: string) {
    return [
      { url: HOSPITAL, valueReference: { reference: org(hospitalId) } },
      { url: KIND, valueString: kind },
    ];
  }
  private mapAssessment(item: QuestionnaireResponse) {
    return {
      id: item.id,
      status: item.status,
      patientId: refId(item.subject?.reference),
      encounterId: refId(item.encounter?.reference),
      authored: item.authored,
    };
  }
  private mapTask(task: Task, now = Date.now()) {
    const dueAt = task.restriction?.period?.end;
    return {
      id: task.id,
      title:
        ext(task, `${BASE}/task-title`)?.valueString ??
        task.description ??
        'Nursing task',
      description: task.description,
      status: task.status,
      priority: task.priority,
      dueAt,
      overdue: Boolean(
        dueAt &&
        Date.parse(dueAt) < now &&
        !['completed', 'cancelled', 'failed'].includes(task.status),
      ),
      patientId: refId(task.for?.reference),
      encounterId: refId(task.encounter?.reference),
    };
  }
  private wardFor(
    encounter: Encounter,
    locations: Map<string | undefined, Location>,
  ) {
    const active = encounter.location?.find((item) => item.status === 'active');
    return ext(locations.get(refId(active?.location.reference)) ?? {}, WARD)
      ?.valueString;
  }
}
