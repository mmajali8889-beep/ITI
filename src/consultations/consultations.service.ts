import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  Communication,
  DocumentReference,
  Encounter,
  Patient,
  ServiceRequest,
  Task,
} from '@medplum/fhirtypes';
import { randomUUID } from 'node:crypto';
import { MedplumService } from '../medplum/medplum.service';
import {
  AcceptConsultationDto,
  CancelConsultationDto,
  CompleteConsultationDto,
  CreateConsultationDto,
} from './dto/consultation.dto';
const BASE = 'https://hospital-ehr.local/fhir/StructureDefinition',
  HOSPITAL = `${BASE}/consultation-hospital`,
  SPECIALTY = `${BASE}/consultation-specialty`,
  REQUEST = `${BASE}/consultation-request`;
const org = (id: string) => `Organization/${id}`,
  id = (v?: string) => v?.split('/')[1];
const ext = (
  r: {
    extension?: Array<{
      url: string;
      valueString?: string;
      valueReference?: { reference?: string };
    }>;
  },
  url: string,
) => r.extension?.find((e) => e.url === url);
@Injectable()
export class ConsultationsService {
  constructor(private readonly medplumService: MedplumService) {}
  async create(dto: CreateConsultationDto) {
    for (const key of [
      'hospitalId',
      'patientId',
      'encounterId',
      'specialty',
      'reason',
      'clinicalQuestion',
      'requesterName',
    ] as const)
      if (!String(dto[key] ?? '').trim())
        throw new BadRequestException(`${key} is required`);
    if (!['routine', 'urgent', 'stat'].includes(dto.priority))
      throw new BadRequestException(
        'Priority must be routine, urgent or emergency',
      );
    const client = this.medplumService.getClient();
    let patient: Patient, encounter: Encounter;
    try {
      [patient, encounter] = await Promise.all([
        client.readResource('Patient', dto.patientId),
        client.readResource('Encounter', dto.encounterId),
      ]);
    } catch {
      throw new NotFoundException('Patient or encounter not found');
    }
    if (
      patient.managingOrganization?.reference !== org(dto.hospitalId) ||
      encounter.serviceProvider?.reference !== org(dto.hospitalId) ||
      encounter.subject?.reference !== `Patient/${dto.patientId}`
    )
      throw new NotFoundException('Patient or encounter not found');
    const requester = dto.requesterId
      ? {
          reference: `Practitioner/${dto.requesterId}`,
          display: dto.requesterName.trim(),
        }
      : { display: dto.requesterName.trim() };
    const request: ServiceRequest = {
      resourceType: 'ServiceRequest',
      status: 'active',
      intent: 'order',
      priority: dto.priority,
      identifier: [
        {
          system: `https://hospital-ehr.local/consultation/${dto.hospitalId}`,
          value: `CON-${randomUUID().slice(0, 8).toUpperCase()}`,
        },
      ],
      category: [
        {
          coding: [
            {
              system: 'https://hospital-ehr.local/CodeSystem/clinical-service',
              code: 'consultation',
              display: 'Consultation',
            },
          ],
        },
      ],
      code: { text: `${dto.specialty.trim()} consultation` },
      subject: {
        reference: `Patient/${dto.patientId}`,
        display: encounter.subject?.display,
      },
      encounter: { reference: `Encounter/${dto.encounterId}` },
      authoredOn: new Date().toISOString(),
      requester,
      reasonCode: [{ text: dto.reason.trim() }],
      note: [{ text: dto.clinicalQuestion.trim() }],
      extension: [
        { url: HOSPITAL, valueReference: { reference: org(dto.hospitalId) } },
        { url: SPECIALTY, valueString: dto.specialty.trim() },
      ],
    };
    const made = await client.createResource(request);
    const task: Task = {
      resourceType: 'Task',
      status: 'ready',
      intent: 'order',
      priority: dto.priority,
      code: {
        coding: [
          {
            system: 'https://hospital-ehr.local/CodeSystem/workflow-task',
            code: 'specialty-consultation',
          },
        ],
      },
      focus: { reference: `ServiceRequest/${made.id}` },
      for: request.subject,
      encounter: request.encounter,
      authoredOn: request.authoredOn,
      requester,
      description: dto.clinicalQuestion.trim(),
      extension: [
        { url: HOSPITAL, valueReference: { reference: org(dto.hospitalId) } },
        { url: SPECIALTY, valueString: dto.specialty.trim() },
        {
          url: REQUEST,
          valueReference: { reference: `ServiceRequest/${made.id}` },
        },
      ],
    };
    return this.map(await client.createResource(task), made);
  }
  async queue(hospitalId: string, specialty?: string, status?: string) {
    if (!hospitalId) throw new BadRequestException('Hospital ID is required');
    const client = this.medplumService.getClient(),
      tasks = await client.searchResources('Task', { _count: '500' }),
      filtered = tasks.filter(
        (t) =>
          this.isTask(t, hospitalId) &&
          (!specialty || ext(t, SPECIALTY)?.valueString === specialty) &&
          (!status || status === 'all' || t.status === status),
      );
    const requests = await Promise.all(
      filtered.map((t) =>
        client.readResource('ServiceRequest', id(t.focus?.reference)!),
      ),
    );
    const items = filtered
      .map((t, index) => this.map(t, requests[index]))
      .sort(
        (a, b) =>
          this.rank(a.priority) - this.rank(b.priority) ||
          String(a.authoredOn).localeCompare(String(b.authoredOn)),
      );
    return {
      items,
      specialties: [...new Set(items.map((v) => v.specialty))].sort(),
      summary: {
        total: items.length,
        waiting: items.filter((v) => v.status === 'ready').length,
        inProgress: items.filter((v) => v.status === 'in-progress').length,
        emergency: items.filter(
          (v) =>
            v.priority === 'stat' &&
            !['completed', 'cancelled'].includes(v.status),
        ).length,
      },
    };
  }
  async accept(taskId: string, dto: AcceptConsultationDto) {
    const task = await this.read(taskId, dto.hospitalId);
    if (!dto.consultantName?.trim())
      throw new BadRequestException('Consultant is required');
    if (task.status !== 'ready')
      throw new ConflictException(
        'Only a waiting consultation can be accepted',
      );
    task.status = 'in-progress';
    task.owner = dto.consultantId
      ? {
          reference: `Practitioner/${dto.consultantId}`,
          display: dto.consultantName.trim(),
        }
      : { display: dto.consultantName.trim() };
    task.executionPeriod = { start: new Date().toISOString() };
    return this.map(await this.medplumService.getClient().updateResource(task));
  }
  async complete(taskId: string, dto: CompleteConsultationDto) {
    const task = await this.read(taskId, dto.hospitalId);
    if (task.status !== 'in-progress')
      throw new ConflictException(
        'Consultation must be accepted before completion',
      );
    if (
      !dto.consultantName?.trim() ||
      !dto.assessment?.trim() ||
      !dto.consultationNote?.trim() ||
      !dto.recommendations?.length
    )
      throw new BadRequestException(
        'Consultant, assessment, note and recommendations are required',
      );
    const now = new Date().toISOString(),
      content = {
        assessment: dto.assessment.trim(),
        consultationNote: dto.consultationNote.trim(),
        recommendations: dto.recommendations
          .map((v) => v.trim())
          .filter(Boolean),
        followUpRequired: Boolean(dto.followUpRequired),
        consultantName: dto.consultantName.trim(),
        createdAt: now,
      };
    const author = dto.consultantId
      ? {
          reference: `Practitioner/${dto.consultantId}`,
          display: dto.consultantName.trim(),
        }
      : { display: dto.consultantName.trim() };
    const note: DocumentReference = {
      resourceType: 'DocumentReference',
      status: 'current',
      type: {
        coding: [
          {
            system: 'http://loinc.org',
            code: '11488-4',
            display: 'Consultation note',
          },
        ],
      },
      subject: { reference: task.for?.reference, display: task.for?.display },
      author: [author],
      date: now,
      description: `${ext(task, SPECIALTY)?.valueString} consultation note`,
      context: {
        encounter: task.encounter ? [task.encounter] : undefined,
        related: [
          { reference: task.focus?.reference },
          { reference: org(dto.hospitalId) },
        ],
      },
      content: [
        {
          attachment: {
            contentType: 'application/json',
            data: Buffer.from(JSON.stringify(content)).toString('base64'),
            title: 'Consultation note',
          },
        },
      ],
      extension: [
        { url: HOSPITAL, valueReference: { reference: org(dto.hospitalId) } },
      ],
    };
    const created = await this.medplumService.getClient().createResource(note);
    task.status = 'completed';
    task.executionPeriod = { ...(task.executionPeriod ?? {}), end: now };
    task.output = [
      {
        type: { text: 'Consultation note' },
        valueReference: { reference: `DocumentReference/${created.id}` },
      },
    ];
    const updated = await this.medplumService.getClient().updateResource(task);
    const notification: Communication = {
      resourceType: 'Communication',
      status: 'completed',
      category: [{ text: 'Consultation completed' }],
      subject: { reference: task.for?.reference, display: task.for?.display },
      encounter: task.encounter,
      sent: now,
      sender: author,
      recipient: task.requester ? [task.requester] : undefined,
      payload: [
        {
          contentString: `${ext(task, SPECIALTY)?.valueString} consultation completed. Recommendations: ${content.recommendations.join('; ')}`,
        },
        { contentReference: { reference: `DocumentReference/${created.id}` } },
      ],
      extension: [
        { url: HOSPITAL, valueReference: { reference: org(dto.hospitalId) } },
      ],
    };
    await this.medplumService.getClient().createResource(notification);
    const request = await this.medplumService
      .getClient()
      .readResource('ServiceRequest', id(task.focus?.reference)!);
    request.status = 'completed';
    await this.medplumService.getClient().updateResource(request);
    return this.map(updated, request);
  }
  async cancel(idValue: string, dto: CancelConsultationDto) {
    const task = await this.read(idValue, dto.hospitalId);
    if (!dto.actorName?.trim() || !dto.reason?.trim())
      throw new BadRequestException(
        'Actor and cancellation reason are required',
      );
    if (['completed', 'cancelled'].includes(task.status))
      throw new ConflictException('Consultation is already closed');
    task.status = 'cancelled';
    task.statusReason = { text: dto.reason.trim() };
    return this.map(await this.medplumService.getClient().updateResource(task));
  }
  private async read(taskId: string, hospitalId: string) {
    let task: Task;
    try {
      task = await this.medplumService.getClient().readResource('Task', taskId);
    } catch {
      throw new NotFoundException('Consultation not found');
    }
    if (!this.isTask(task, hospitalId))
      throw new NotFoundException('Consultation not found');
    return task;
  }
  private isTask(t: Task, hospitalId: string) {
    return (
      t.code?.coding?.some((c) => c.code === 'specialty-consultation') &&
      ext(t, HOSPITAL)?.valueReference?.reference === org(hospitalId)
    );
  }
  private rank(p?: string) {
    return p === 'stat' ? 0 : p === 'urgent' ? 1 : 2;
  }
  private map(t: Task, r?: ServiceRequest) {
    return {
      id: t.id,
      requestId: id(t.focus?.reference),
      identifier: r?.identifier?.[0]?.value,
      status: t.status,
      priority: t.priority,
      specialty: ext(t, SPECIALTY)?.valueString,
      patientId: id(t.for?.reference),
      patientName: t.for?.display,
      encounterId: id(t.encounter?.reference),
      requesterName: t.requester?.display,
      consultantName: t.owner?.display,
      reason: r?.reasonCode?.[0]?.text,
      clinicalQuestion: t.description,
      authoredOn: t.authoredOn,
      startedAt: t.executionPeriod?.start,
      completedAt: t.executionPeriod?.end,
      noteId: id(t.output?.[0]?.valueReference?.reference),
    };
  }
}
