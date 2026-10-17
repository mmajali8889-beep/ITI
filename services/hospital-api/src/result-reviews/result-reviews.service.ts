import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  DiagnosticReport,
  Observation,
  Procedure,
  Task,
} from '@medplum/fhirtypes';
import { MedplumService } from '../medplum/medplum.service';
import {
  RecordResultReviewDto,
  ReviewTargetType,
} from './dto/result-review.dto';

const BASE = 'https://hospital-ehr.local/fhir/StructureDefinition';
const HOSPITAL = `${BASE}/result-review-hospital`;
const DECISION = `${BASE}/result-review-decision`;
const CRITICAL = `${BASE}/result-review-critical`;
const NOTE = `${BASE}/result-review-note`;
type ReviewTarget = DiagnosticReport | Observation | Procedure;

@Injectable()
export class ResultReviewsService {
  constructor(private readonly medplumService: MedplumService) {}

  async record(dto: RecordResultReviewDto) {
    for (const field of [
      'hospitalId',
      'patientId',
      'encounterId',
      'targetType',
      'targetId',
      'practitionerId',
      'practitionerName',
      'decision',
    ] as const) {
      if (!String(dto[field] ?? '').trim())
        throw new BadRequestException(`${field} is required`);
    }
    if (
      !['DiagnosticReport', 'Observation', 'Procedure'].includes(dto.targetType)
    )
      throw new BadRequestException('Invalid review target type');
    if (!['acknowledged', 'action-required'].includes(dto.decision))
      throw new BadRequestException('Invalid review decision');
    if (
      (dto.critical || dto.decision === 'action-required') &&
      (!dto.note || dto.note.trim().length < 10)
    )
      throw new BadRequestException(
        'A meaningful review note is required for critical or actionable results',
      );
    await this.encounter(dto.encounterId, dto.patientId, dto.hospitalId);
    const target = await this.target(dto.targetType, dto.targetId);
    this.assertTargetContext(target, dto);
    this.assertFinal(target);
    const existing = await this.medplumService
      .getClient()
      .searchResources('Task', {
        focus: `${dto.targetType}/${dto.targetId}`,
        _count: '50',
      });
    if (
      existing.some(
        (item) =>
          this.hospitalId(item) === dto.hospitalId &&
          item.status === 'completed',
      )
    )
      throw new ConflictException('This result version is already reviewed');

    const task: Task = {
      resourceType: 'Task',
      status: 'completed',
      intent: 'order',
      code: {
        coding: [
          {
            system: 'https://hospital-ehr.local/CodeSystem/clinical-task',
            code: 'result-review',
            display: 'Clinical result review',
          },
        ],
        text: 'Clinical result review',
      },
      focus: { reference: `${dto.targetType}/${dto.targetId}` },
      for: { reference: `Patient/${dto.patientId}` },
      encounter: { reference: `Encounter/${dto.encounterId}` },
      authoredOn: new Date().toISOString(),
      lastModified: new Date().toISOString(),
      owner: {
        reference: `Practitioner/${dto.practitionerId}`,
        display: dto.practitionerName.trim(),
      },
      extension: [
        {
          url: HOSPITAL,
          valueReference: { reference: `Organization/${dto.hospitalId}` },
        },
        { url: DECISION, valueCode: dto.decision },
        { url: CRITICAL, valueBoolean: dto.critical },
        ...(dto.note ? [{ url: NOTE, valueString: dto.note.trim() }] : []),
      ],
    };
    return this.map(
      await this.medplumService.getClient().createResource<Task>(task),
    );
  }

  async byEncounter(encounterId: string, hospitalId: string) {
    if (!encounterId || !hospitalId)
      throw new BadRequestException('Encounter and hospital are required');
    const encounter = await this.readEncounter(encounterId);
    if (encounter.serviceProvider?.reference !== `Organization/${hospitalId}`)
      throw new NotFoundException('Encounter not found');
    const tasks = await this.medplumService
      .getClient()
      .searchResources('Task', {
        encounter: `Encounter/${encounterId}`,
        _count: '500',
      });
    const reviews = tasks
      .filter(
        (item) =>
          this.hospitalId(item) === hospitalId &&
          item.code?.coding?.[0]?.code === 'result-review',
      )
      .map((item) => this.map(item));
    return { encounterId, total: reviews.length, reviews };
  }

  private async target(
    type: ReviewTargetType,
    id: string,
  ): Promise<ReviewTarget> {
    try {
      return await this.medplumService.getClient().readResource(type, id);
    } catch {
      throw new NotFoundException('Result not found');
    }
  }
  private async readEncounter(id: string) {
    try {
      return await this.medplumService
        .getClient()
        .readResource('Encounter', id);
    } catch {
      throw new NotFoundException('Encounter not found');
    }
  }
  private async encounter(id: string, patientId: string, hospitalId: string) {
    const item = await this.readEncounter(id);
    if (
      item.serviceProvider?.reference !== `Organization/${hospitalId}` ||
      item.subject?.reference !== `Patient/${patientId}`
    )
      throw new NotFoundException('Encounter not found');
    return item;
  }
  private assertTargetContext(
    target: ReviewTarget,
    dto: RecordResultReviewDto,
  ) {
    if (
      target.subject?.reference !== `Patient/${dto.patientId}` ||
      target.encounter?.reference !== `Encounter/${dto.encounterId}`
    )
      throw new NotFoundException('Result not found');
  }
  private assertFinal(target: ReviewTarget) {
    const allowed: Record<string, string[]> = {
      DiagnosticReport: ['final', 'amended', 'corrected', 'appended'],
      Observation: ['final', 'amended', 'corrected'],
      Procedure: ['completed'],
    };
    if (!allowed[target.resourceType].includes(target.status))
      throw new ConflictException('Only a final result can be reviewed');
  }
  private hospitalId(item: Task) {
    return item.extension
      ?.find((ext) => ext.url === HOSPITAL)
      ?.valueReference?.reference?.replace('Organization/', '');
  }
  private ext(item: Task, url: string) {
    const value = item.extension?.find((extension) => extension.url === url);
    return value?.valueCode ?? value?.valueString ?? value?.valueBoolean;
  }
  private map(item: Task) {
    return {
      id: item.id,
      hospitalId: this.hospitalId(item),
      status: item.status,
      targetReference: item.focus?.reference,
      patientId: item.for?.reference?.replace('Patient/', ''),
      encounterId: item.encounter?.reference?.replace('Encounter/', ''),
      practitionerId: item.owner?.reference?.replace('Practitioner/', ''),
      practitionerName: item.owner?.display,
      decision: this.ext(item, DECISION),
      critical: this.ext(item, CRITICAL),
      note: this.ext(item, NOTE),
      reviewedAt: item.lastModified,
    };
  }
}
