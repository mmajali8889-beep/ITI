import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  Consent,
  Encounter,
  Procedure,
  QuestionnaireResponse,
  Task,
} from '@medplum/fhirtypes';
import { randomUUID } from 'node:crypto';
import { MedplumService } from '../medplum/medplum.service';
import {
  CreateSurgeryCaseDto,
  SurgeryStage,
  TransitionSurgeryDto,
} from './dto/surgery.dto';
const BASE = 'https://hospital-ehr.local/fhir/StructureDefinition',
  HOSPITAL = `${BASE}/surgery-hospital`,
  DATA = `${BASE}/surgery-case-data`,
  HISTORY = `${BASE}/surgery-history`;
const org = (id: string) => `Organization/${id}`;
const FLOW: SurgeryStage[] = [
  'requested',
  'authorized',
  'scheduled',
  'pre-op-assessed',
  'anesthesia-assessed',
  'consented',
  'pre-op-check-complete',
  'in-or',
  'who-check-complete',
  'anesthesia-started',
  'procedure-in-progress',
  'procedure-completed',
  'pacu',
  'completed',
];
type CaseData = {
  procedureCode?: string;
  procedureName: string;
  indication: string;
  surgeonId?: string;
  surgeonName: string;
  assistantName?: string;
  anesthesiologistName?: string;
  nurseNames?: string[];
  authorizationNumber?: string;
  operatingRoomId?: string;
  operatingRoomName?: string;
  scheduledStart?: string;
  scheduledEnd?: string;
  actualStart?: string;
  actualEnd?: string;
  implants?: TransitionSurgeryDto['implants'];
  medications?: string[];
  consumables?: string[];
  complications?: string[];
  destination?: string;
};
@Injectable()
export class SurgeryService {
  constructor(private readonly medplumService: MedplumService) {}
  async create(dto: CreateSurgeryCaseDto) {
    for (const key of [
      'hospitalId',
      'patientId',
      'encounterId',
      'procedureName',
      'indication',
      'surgeonName',
    ] as const)
      if (!String(dto[key] ?? '').trim())
        throw new BadRequestException(`${key} is required`);
    const encounter = await this.encounter(dto.encounterId, dto.hospitalId);
    if (encounter.subject?.reference !== `Patient/${dto.patientId}`)
      throw new NotFoundException('Patient encounter not found');
    const data: CaseData = {
      procedureCode: dto.procedureCode?.trim(),
      procedureName: dto.procedureName.trim(),
      indication: dto.indication.trim(),
      surgeonId: dto.surgeonId,
      surgeonName: dto.surgeonName.trim(),
      assistantName: dto.assistantName?.trim(),
      anesthesiologistName: dto.anesthesiologistName?.trim(),
      nurseNames: dto.nurseNames?.map((v) => v.trim()).filter(Boolean),
    };
    const task: Task = {
      resourceType: 'Task',
      status: 'requested',
      intent: 'order',
      priority: dto.priority ?? 'routine',
      identifier: [
        {
          system: `https://hospital-ehr.local/surgery/${dto.hospitalId}`,
          value: `SUR-${randomUUID().slice(0, 8).toUpperCase()}`,
        },
      ],
      code: {
        coding: [
          {
            system: 'https://hospital-ehr.local/CodeSystem/workflow-task',
            code: 'surgery-case',
            display: 'Surgery case',
          },
        ],
      },
      description: dto.indication.trim(),
      for: {
        reference: `Patient/${dto.patientId}`,
        display: encounter.subject?.display,
      },
      encounter: { reference: `Encounter/${dto.encounterId}` },
      authoredOn: new Date().toISOString(),
      requester: dto.surgeonId
        ? {
            reference: `Practitioner/${dto.surgeonId}`,
            display: dto.surgeonName.trim(),
          }
        : { display: dto.surgeonName.trim() },
      extension: [
        { url: HOSPITAL, valueReference: { reference: org(dto.hospitalId) } },
        { url: DATA, valueString: JSON.stringify(data) },
        {
          url: HISTORY,
          valueString: JSON.stringify([
            {
              stage: 'requested',
              actor: dto.surgeonName,
              at: new Date().toISOString(),
            },
          ]),
        },
      ],
    };
    return this.map(await this.medplumService.getClient().createResource(task));
  }
  async list(hospitalId: string, status?: string) {
    if (!hospitalId) throw new BadRequestException('Hospital ID is required');
    const tasks = await this.medplumService
      .getClient()
      .searchResources('Task', { _count: '500' });
    return {
      cases: tasks
        .filter(
          (t) =>
            this.isCase(t, hospitalId) &&
            (!status || status === 'all' || this.stage(t) === status),
        )
        .map((t) => this.map(t))
        .sort((a, b) =>
          String(a.scheduledStart ?? a.authoredOn).localeCompare(
            String(b.scheduledStart ?? b.authoredOn),
          ),
        ),
    };
  }
  async get(id: string, hospitalId: string) {
    return this.map(await this.read(id, hospitalId));
  }
  async transition(id: string, dto: TransitionSurgeryDto) {
    if (!dto.hospitalId || !dto.actorName?.trim() || !dto.stage)
      throw new BadRequestException(
        'Hospital, target stage and actor are required',
      );
    const task = await this.read(id, dto.hospitalId),
      current = this.stage(task);
    if (dto.stage === 'cancelled') {
      if (['completed', 'cancelled'].includes(current))
        throw new ConflictException('Closed surgery case cannot be cancelled');
      task.status = 'cancelled';
      return this.saveTransition(task, dto);
    }
    const expected = FLOW[FLOW.indexOf(current) + 1];
    if (dto.stage !== expected)
      throw new ConflictException({
        message: `Next required stage is ${expected ?? 'none'}`,
        currentStage: current,
        expectedStage: expected,
      });
    this.validateStage(dto);
    const data = this.data(task);
    if (dto.authorizationNumber)
      data.authorizationNumber = dto.authorizationNumber.trim();
    if (dto.operatingRoomName) {
      data.operatingRoomId = dto.operatingRoomId;
      data.operatingRoomName = dto.operatingRoomName.trim();
      data.scheduledStart = new Date(dto.scheduledStart!).toISOString();
      data.scheduledEnd = new Date(dto.scheduledEnd!).toISOString();
    }
    if (dto.stage === 'in-or') data.actualStart = new Date().toISOString();
    if (dto.stage === 'procedure-completed') {
      data.actualEnd = new Date().toISOString();
      data.implants = dto.implants ?? [];
      data.medications = dto.medications ?? [];
      data.consumables = dto.consumables ?? [];
      data.complications = dto.complications ?? [];
      await this.createProcedure(task, data, dto);
    }
    if (dto.stage === 'completed') data.destination = dto.destination;
    task.extension = [
      ...(task.extension ?? []).filter((e) => e.url !== DATA),
      { url: DATA, valueString: JSON.stringify(data) },
    ];
    task.status =
      dto.stage === 'completed'
        ? 'completed'
        : dto.stage === 'requested'
          ? 'requested'
          : 'in-progress';
    return this.saveTransition(task, dto);
  }
  private validateStage(dto: TransitionSurgeryDto) {
    if (dto.stage === 'authorized' && !dto.authorizationNumber?.trim())
      throw new BadRequestException('Pre-authorization number is required');
    if (
      dto.stage === 'scheduled' &&
      (!dto.operatingRoomName?.trim() ||
        !dto.scheduledStart ||
        !dto.scheduledEnd ||
        Date.parse(dto.scheduledEnd) <= Date.parse(dto.scheduledStart))
    )
      throw new BadRequestException(
        'Valid operating room and schedule are required',
      );
    if (
      [
        'pre-op-assessed',
        'anesthesia-assessed',
        'pre-op-check-complete',
        'who-check-complete',
      ].includes(dto.stage) &&
      (!dto.checklist || !Object.keys(dto.checklist).length)
    )
      throw new BadRequestException(
        'Completed assessment or checklist is required',
      );
    if (dto.stage === 'consented' && !dto.consentType?.trim())
      throw new BadRequestException('Consent type is required');
    if (dto.stage === 'procedure-completed' && !dto.note?.trim())
      throw new BadRequestException('Operative note is required');
    if (dto.stage === 'completed' && !dto.destination)
      throw new BadRequestException('Post-operative destination is required');
  }
  private async saveTransition(task: Task, dto: TransitionSurgeryDto) {
    const history = this.history(task);
    history.push({
      stage: dto.stage,
      actorId: dto.actorId,
      actor: dto.actorName.trim(),
      note: dto.note?.trim(),
      at: new Date().toISOString(),
    });
    task.extension = [
      ...(task.extension ?? []).filter((e) => e.url !== HISTORY),
      { url: HISTORY, valueString: JSON.stringify(history) },
    ];
    if (
      [
        'pre-op-assessed',
        'anesthesia-assessed',
        'pre-op-check-complete',
        'who-check-complete',
      ].includes(dto.stage)
    )
      await this.createChecklist(task, dto);
    if (dto.stage === 'consented') await this.createConsent(task, dto);
    return this.map(await this.medplumService.getClient().updateResource(task));
  }
  private async createChecklist(task: Task, dto: TransitionSurgeryDto) {
    const qr: QuestionnaireResponse = {
      resourceType: 'QuestionnaireResponse',
      status: 'completed',
      subject: task.for,
      encounter: task.encounter,
      authored: new Date().toISOString(),
      author: dto.actorId
        ? { reference: `Practitioner/${dto.actorId}`, display: dto.actorName }
        : { display: dto.actorName },
      item: [
        {
          linkId: dto.stage,
          text: dto.stage,
          answer: [{ valueString: JSON.stringify(dto.checklist) }],
        },
      ],
      extension: [
        { url: HOSPITAL, valueReference: { reference: org(dto.hospitalId) } },
      ],
    };
    await this.medplumService.getClient().createResource(qr);
  }
  private async createConsent(task: Task, dto: TransitionSurgeryDto) {
    const consent: Consent = {
      resourceType: 'Consent',
      status: 'active',
      scope: {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/consentscope',
            code: 'treatment',
          },
        ],
      },
      category: [{ text: dto.consentType }],
      patient: { reference: task.for?.reference, display: task.for?.display },
      dateTime: new Date().toISOString(),
      performer: [
        dto.actorId
          ? { reference: `Practitioner/${dto.actorId}`, display: dto.actorName }
          : { display: dto.actorName },
      ],
      organization: [{ reference: org(dto.hospitalId) }],
      provision: {
        type: 'permit',
        period: { start: new Date().toISOString() },
      },
      extension: [
        {
          url: `${BASE}/surgery-case`,
          valueReference: { reference: `Task/${task.id}` },
        },
        { url: HOSPITAL, valueReference: { reference: org(dto.hospitalId) } },
      ],
    };
    await this.medplumService.getClient().createResource(consent);
  }
  private async createProcedure(
    task: Task,
    data: CaseData,
    dto: TransitionSurgeryDto,
  ) {
    const performers = [
      {
        actor: data.surgeonId
          ? {
              reference: `Practitioner/${data.surgeonId}`,
              display: data.surgeonName,
            }
          : { display: data.surgeonName },
        function: { text: 'Primary surgeon' },
      },
      ...(data.assistantName
        ? [
            {
              actor: { display: data.assistantName },
              function: { text: 'Surgical assistant' },
            },
          ]
        : []),
      ...(data.anesthesiologistName
        ? [
            {
              actor: { display: data.anesthesiologistName },
              function: { text: 'Anesthesiologist' },
            },
          ]
        : []),
      ...(data.nurseNames ?? []).map((name) => ({
        actor: { display: name },
        function: { text: 'Operating room nurse' },
      })),
    ];
    const procedure: Procedure = {
      resourceType: 'Procedure',
      status: 'completed',
      code: {
        coding: data.procedureCode
          ? [
              {
                system: 'http://snomed.info/sct',
                code: data.procedureCode,
                display: data.procedureName,
              },
            ]
          : undefined,
        text: data.procedureName,
      },
      subject: { reference: task.for?.reference, display: task.for?.display },
      encounter: task.encounter,
      performedPeriod: { start: data.actualStart, end: data.actualEnd },
      performer: performers,
      location: data.operatingRoomId
        ? {
            reference: `Location/${data.operatingRoomId}`,
            display: data.operatingRoomName,
          }
        : { display: data.operatingRoomName },
      reasonCode: [{ text: data.indication }],
      complication: (dto.complications ?? []).map((text) => ({ text })),
      note: [
        {
          text: JSON.stringify({
            implants: dto.implants ?? [],
            medications: dto.medications ?? [],
            consumables: dto.consumables ?? [],
          }),
        },
      ],
      extension: [
        { url: HOSPITAL, valueReference: { reference: org(dto.hospitalId) } },
        {
          url: `${BASE}/surgery-case`,
          valueReference: { reference: `Task/${task.id}` },
        },
      ],
    };
    await this.medplumService.getClient().createResource(procedure);
  }
  private async encounter(id: string, hospitalId: string) {
    let e: Encounter;
    try {
      e = await this.medplumService.getClient().readResource('Encounter', id);
    } catch {
      throw new NotFoundException('Patient encounter not found');
    }
    if (
      e.serviceProvider?.reference !== org(hospitalId) ||
      !['in-progress', 'triaged', 'arrived'].includes(e.status)
    )
      throw new NotFoundException('Patient encounter not found');
    return e;
  }
  private async read(id: string, hospitalId: string) {
    let task: Task;
    try {
      task = await this.medplumService.getClient().readResource('Task', id);
    } catch {
      throw new NotFoundException('Surgery case not found');
    }
    if (!this.isCase(task, hospitalId))
      throw new NotFoundException('Surgery case not found');
    return task;
  }
  private isCase(t: Task, hospitalId: string) {
    return (
      t.code?.coding?.some((c) => c.code === 'surgery-case') &&
      t.extension?.some(
        (e) =>
          e.url === HOSPITAL && e.valueReference?.reference === org(hospitalId),
      )
    );
  }
  private data(t: Task) {
    try {
      return JSON.parse(
        t.extension?.find((e) => e.url === DATA)?.valueString ?? '{}',
      ) as CaseData;
    } catch {
      return {} as CaseData;
    }
  }
  private history(t: Task) {
    try {
      return JSON.parse(
        t.extension?.find((e) => e.url === HISTORY)?.valueString ?? '[]',
      ) as Array<Record<string, unknown>>;
    } catch {
      return [];
    }
  }
  private stage(t: Task) {
    return (this.history(t).at(-1)?.stage ?? 'requested') as SurgeryStage;
  }
  private map(t: Task) {
    const data = this.data(t);
    return {
      id: t.id,
      caseNumber: t.identifier?.[0]?.value,
      status: t.status,
      stage: this.stage(t),
      priority: t.priority,
      patientId: t.for?.reference?.replace('Patient/', ''),
      patientName: t.for?.display,
      encounterId: t.encounter?.reference?.replace('Encounter/', ''),
      authoredOn: t.authoredOn,
      ...data,
      history: this.history(t),
    };
  }
}
