import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  Composition,
  DocumentReference,
  Encounter,
  Extension,
  Provenance,
  Task,
} from '@medplum/fhirtypes';
import { createHash } from 'node:crypto';
import { MedplumService } from '../medplum/medplum.service';
import {
  AmendRecordDto,
  ArchiveRecordDto,
  AssessRecordDto,
  CloseRecordDto,
  LockRecordDto,
  ResolveDeficiencyDto,
} from './dto/medical-record.dto';

const BASE = 'https://hospital-ehr.local/fhir/StructureDefinition';
const HOSPITAL = `${BASE}/medical-record-hospital`,
  BILLING_HOSPITAL = `${BASE}/billing-hospital`,
  DEFICIENCY = `${BASE}/record-deficiency-code`,
  RESOLUTION = `${BASE}/deficiency-resolution`,
  CLOSED_AT = `${BASE}/record-closed-at`,
  AMEND_REASON = `${BASE}/record-amendment-reason`,
  RECORD_STATUS = `${BASE}/record-status`,
  SIGNATURE = `${BASE}/record-electronic-signature`,
  LOCKED_AT = `${BASE}/record-locked-at`,
  LOCKED_BY = `${BASE}/record-locked-by`,
  ARCHIVED_AT = `${BASE}/record-archived-at`,
  ARCHIVED_BY = `${BASE}/record-archived-by`,
  RETENTION_UNTIL = `${BASE}/record-retention-until`;
type Gap = { code: string; message: string };

@Injectable()
export class MedicalRecordsService {
  constructor(private readonly medplumService: MedplumService) {}

  async assess(encounterId: string, dto: AssessRecordDto) {
    if (!dto.hospitalId)
      throw new BadRequestException('Hospital ID is required');
    const encounter = await this.encounter(encounterId, dto.hospitalId);
    if (encounter.status !== 'finished')
      throw new ConflictException(
        'Encounter must be completed before HIM review',
      );
    const gaps = await this.gaps(encounter);
    const existing = await this.medplumService
      .getClient()
      .searchResources('Task', {
        encounter: `Encounter/${encounterId}`,
        _count: '200',
      });
    const open = existing.filter(
      (item) =>
        this.hospitalId(item) === dto.hospitalId &&
        item.code?.coding?.[0]?.code === 'chart-deficiency' &&
        !['completed', 'cancelled', 'failed'].includes(item.status),
    );
    for (const gap of gaps) {
      if (open.some((item) => this.ext(item, DEFICIENCY) === gap.code))
        continue;
      const task: Task = {
        resourceType: 'Task',
        status: 'requested',
        intent: 'order',
        code: {
          coding: [
            {
              system: 'https://hospital-ehr.local/CodeSystem/clinical-task',
              code: 'chart-deficiency',
            },
          ],
          text: 'Medical record deficiency',
        },
        description: gap.message,
        for: encounter.subject,
        encounter: { reference: `Encounter/${encounterId}` },
        authoredOn: new Date().toISOString(),
        owner: dto.ownerId
          ? { reference: `Practitioner/${dto.ownerId}`, display: dto.ownerName }
          : {
              reference: `Organization/${dto.hospitalId}`,
              display: dto.ownerName ?? 'Health Information Management',
            },
        extension: [
          {
            url: HOSPITAL,
            valueReference: { reference: `Organization/${dto.hospitalId}` },
          },
          { url: DEFICIENCY, valueCode: gap.code },
        ],
      };
      await this.medplumService.getClient().createResource<Task>(task);
    }
    return {
      encounterId,
      hospitalId: dto.hospitalId,
      complete: gaps.length === 0,
      deficiencyCount: gaps.length,
      deficiencies: gaps,
    };
  }

  async resolveDeficiency(taskId: string, dto: ResolveDeficiencyDto) {
    if (
      !dto.hospitalId ||
      !dto.resolutionNote?.trim() ||
      dto.resolutionNote.trim().length < 10
    )
      throw new BadRequestException(
        'Hospital and a meaningful resolution note are required',
      );
    let task: Task;
    try {
      task = await this.medplumService.getClient().readResource('Task', taskId);
    } catch {
      throw new NotFoundException('Deficiency not found');
    }
    if (
      this.hospitalId(task) !== dto.hospitalId ||
      task.code?.coding?.[0]?.code !== 'chart-deficiency'
    )
      throw new NotFoundException('Deficiency not found');
    if (task.status === 'completed')
      throw new ConflictException('Deficiency is already resolved');
    task.status = 'completed';
    task.lastModified = new Date().toISOString();
    task.extension = [
      ...(task.extension ?? []),
      { url: RESOLUTION, valueString: dto.resolutionNote.trim() },
    ];
    return this.mapTask(
      await this.medplumService.getClient().updateResource<Task>(task),
    );
  }

  async close(encounterId: string, dto: CloseRecordDto) {
    if (
      !dto.hospitalId ||
      !dto.practitionerId ||
      !dto.practitionerName?.trim() ||
      !dto.confirmation
    )
      throw new BadRequestException(
        'Confirmed practitioner authorization is required',
      );
    const encounter = await this.encounter(encounterId, dto.hospitalId);
    if (encounter.status !== 'finished')
      throw new ConflictException(
        'Encounter must be finished before record closure',
      );
    const gaps = await this.gaps(encounter);
    if (gaps.length)
      throw new ConflictException({
        message: 'Medical record has unresolved deficiencies',
        code: 'RECORD_DEFICIENCIES',
        deficiencies: gaps,
      });
    const prior = await this.compositions(encounterId, dto.hospitalId);
    if (prior.some((item) => item.status === 'final'))
      throw new ConflictException('Medical record is already closed');
    const signedAt = new Date().toISOString();
    const digest = createHash('sha256')
      .update(
        `${encounterId}|${dto.hospitalId}|${dto.practitionerId}|${signedAt}`,
      )
      .digest('base64');
    const signature = JSON.stringify({
      signerId: dto.practitionerId,
      signerName: dto.practitionerName.trim(),
      meaning: 'approved',
      signedAt,
      algorithm: 'SHA-256',
      digest,
    });
    const composition: Composition = {
      resourceType: 'Composition',
      status: 'final',
      type: {
        coding: [
          {
            system: 'http://loinc.org',
            code: '34133-9',
            display: 'Summary of episode note',
          },
        ],
        text: 'Completed medical record',
      },
      subject: encounter.subject,
      encounter: { reference: `Encounter/${encounterId}` },
      date: signedAt,
      author: [
        {
          reference: `Practitioner/${dto.practitionerId}`,
          display: dto.practitionerName.trim(),
        },
      ],
      title: 'Completed Encounter Medical Record',
      custodian: { reference: `Organization/${dto.hospitalId}` },
      extension: [
        {
          url: HOSPITAL,
          valueReference: { reference: `Organization/${dto.hospitalId}` },
        },
        { url: CLOSED_AT, valueDateTime: signedAt },
        { url: RECORD_STATUS, valueCode: 'signed' },
        { url: SIGNATURE, valueString: signature },
      ],
    };
    const created = await this.medplumService
      .getClient()
      .createResource<Composition>(composition);
    const provenance: Provenance = {
      resourceType: 'Provenance',
      target: [{ reference: `Composition/${created.id}` }],
      recorded: signedAt,
      activity: {
        coding: [
          {
            system:
              'http://terminology.hl7.org/CodeSystem/v3-DocumentCompletion',
            code: 'LA',
            display: 'legally authenticated',
          },
        ],
      },
      agent: [
        {
          type: {
            coding: [
              {
                system:
                  'http://terminology.hl7.org/CodeSystem/provenance-participant-type',
                code: 'author',
              },
            ],
          },
          who: {
            reference: `Practitioner/${dto.practitionerId}`,
            display: dto.practitionerName.trim(),
          },
        },
      ],
      signature: [
        {
          type: [
            {
              system: 'urn:iso-astm:E1762-95:2013',
              code: '1.2.840.10065.1.12.1.1',
              display: "Author's Signature",
            },
          ],
          when: signedAt,
          who: {
            reference: `Practitioner/${dto.practitionerId}`,
            display: dto.practitionerName.trim(),
          },
          sigFormat: 'application/octet-stream',
          data: digest,
        },
      ],
    };
    await this.medplumService
      .getClient()
      .createResource<Provenance>(provenance);
    return this.mapComposition(created);
  }

  async lock(recordId: string, dto: LockRecordDto) {
    if (
      !dto.hospitalId ||
      !dto.himOfficerId ||
      !dto.himOfficerName?.trim() ||
      !dto.confirmation
    )
      throw new BadRequestException(
        'Confirmed HIM officer authorization is required',
      );
    const record = await this.record(recordId, dto.hospitalId);
    const state = this.recordStatus(record);
    if (state !== 'signed')
      throw new ConflictException(
        state === 'locked' || state === 'archived'
          ? 'Medical record is already locked'
          : 'Medical record must be electronically signed before locking',
      );
    const at = new Date().toISOString();
    record.extension = this.withExtensions(record.extension, [
      { url: RECORD_STATUS, valueCode: 'locked' },
      { url: LOCKED_AT, valueDateTime: at },
      {
        url: LOCKED_BY,
        valueReference: {
          reference: `Practitioner/${dto.himOfficerId}`,
          display: dto.himOfficerName.trim(),
        },
      },
    ]);
    const updated = await this.medplumService
      .getClient()
      .updateResource<Composition>(record);
    return this.mapComposition(updated);
  }

  async archive(recordId: string, dto: ArchiveRecordDto) {
    if (
      !dto.hospitalId ||
      !dto.archivistId ||
      !dto.archivistName?.trim() ||
      !dto.confirmation
    )
      throw new BadRequestException(
        'Confirmed archivist authorization is required',
      );
    if (dto.retentionUntil && Number.isNaN(Date.parse(dto.retentionUntil)))
      throw new BadRequestException('Retention date is invalid');
    const record = await this.record(recordId, dto.hospitalId);
    const state = this.recordStatus(record);
    if (state !== 'locked')
      throw new ConflictException(
        state === 'archived'
          ? 'Medical record is already archived'
          : 'Medical record must be locked before archiving',
      );
    const additions: Extension[] = [
      { url: RECORD_STATUS, valueCode: 'archived' },
      { url: ARCHIVED_AT, valueDateTime: new Date().toISOString() },
      {
        url: ARCHIVED_BY,
        valueReference: {
          reference: `Practitioner/${dto.archivistId}`,
          display: dto.archivistName.trim(),
        },
      },
    ];
    if (dto.retentionUntil)
      additions.push({
        url: RETENTION_UNTIL,
        valueDate: dto.retentionUntil.slice(0, 10),
      });
    record.extension = this.withExtensions(record.extension, additions);
    return this.mapComposition(
      await this.medplumService.getClient().updateResource<Composition>(record),
    );
  }

  async queue(hospitalId: string) {
    if (!hospitalId) throw new BadRequestException('Hospital ID is required');
    const [encounters, tasks, records] = await Promise.all([
      this.medplumService
        .getClient()
        .searchResources('Encounter', { status: 'finished', _count: '500' }),
      this.medplumService
        .getClient()
        .searchResources('Task', { _count: '500' }),
      this.medplumService
        .getClient()
        .searchResources('Composition', { _count: '500' }),
    ]);
    const rows = encounters
      .filter((item) => this.encounterHospital(item) === hospitalId)
      .map((encounter) => {
        const encounterTasks = tasks.filter(
          (task) =>
            task.encounter?.reference === `Encounter/${encounter.id}` &&
            this.hospitalId(task) === hospitalId &&
            task.code?.coding?.[0]?.code === 'chart-deficiency',
        );
        const openDeficiencies = encounterTasks.filter(
          (task) => !['completed', 'cancelled', 'failed'].includes(task.status),
        ).length;
        const record = records
          .filter(
            (item) =>
              item.encounter?.reference === `Encounter/${encounter.id}` &&
              this.hospitalId(item) === hospitalId,
          )
          .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))[0];
        const workflowStatus = record
          ? this.recordStatus(record)
          : openDeficiencies
            ? 'deficient'
            : 'pending-review';
        return {
          encounterId: encounter.id,
          patientId: encounter.subject?.reference?.replace('Patient/', ''),
          patientName: encounter.subject?.display,
          visitNumber: encounter.identifier?.[0]?.value,
          completedAt: encounter.period?.end,
          workflowStatus,
          openDeficiencies,
          record: record ? this.mapComposition(record) : undefined,
        };
      });
    return {
      hospitalId,
      total: rows.length,
      summary: rows.reduce<Record<string, number>>(
        (acc, row) => ({
          ...acc,
          [row.workflowStatus]: (acc[row.workflowStatus] ?? 0) + 1,
        }),
        {},
      ),
      items: rows,
    };
  }

  async amend(recordId: string, dto: AmendRecordDto) {
    if (
      !dto.hospitalId ||
      !dto.practitionerId ||
      !dto.practitionerName?.trim() ||
      !dto.reason?.trim() ||
      !dto.note?.trim() ||
      dto.note.trim().length < 10
    )
      throw new BadRequestException(
        'Authorized author, reason, and an amendment note of at least 10 characters are required',
      );
    let original: Composition;
    try {
      original = await this.medplumService
        .getClient()
        .readResource('Composition', recordId);
    } catch {
      throw new NotFoundException('Medical record not found');
    }
    if (
      this.hospitalId(original) !== dto.hospitalId ||
      !['final', 'amended'].includes(original.status)
    )
      throw new NotFoundException('Medical record not found');
    const amendment: Composition = {
      ...original,
      id: undefined,
      meta: undefined,
      status: 'amended',
      date: new Date().toISOString(),
      author: [
        {
          reference: `Practitioner/${dto.practitionerId}`,
          display: dto.practitionerName.trim(),
        },
      ],
      title: `${original.title} — Amendment`,
      relatesTo: [
        {
          code: 'appends',
          targetReference: { reference: `Composition/${recordId}` },
        },
      ],
      section: [
        ...(original.section ?? []),
        {
          title: 'Authorized amendment',
          text: {
            status: 'generated',
            div: `<div xmlns="http://www.w3.org/1999/xhtml">${this.escape(dto.note.trim())}</div>`,
          },
        },
      ],
      extension: [
        ...(original.extension ?? []),
        { url: AMEND_REASON, valueString: dto.reason.trim() },
      ],
    };
    return this.mapComposition(
      await this.medplumService
        .getClient()
        .createResource<Composition>(amendment),
    );
  }

  async get(encounterId: string, hospitalId: string) {
    await this.encounter(encounterId, hospitalId);
    const records = (await this.compositions(encounterId, hospitalId)).map(
      (item) => this.mapComposition(item),
    );
    const tasks = await this.medplumService
      .getClient()
      .searchResources('Task', {
        encounter: `Encounter/${encounterId}`,
        _count: '200',
      });
    return {
      encounterId,
      records,
      deficiencies: tasks
        .filter(
          (item) =>
            this.hospitalId(item) === hospitalId &&
            item.code?.coding?.[0]?.code === 'chart-deficiency',
        )
        .map((item) => this.mapTask(item)),
    };
  }
  private async gaps(encounter: Encounter): Promise<Gap[]> {
    const id = encounter.id!;
    const medplum = this.medplumService.getClient();
    const [diagnoses, notes, services, reports, reviews, invoices] =
      await Promise.all([
        medplum.searchResources('Condition', {
          encounter: `Encounter/${id}`,
          _count: '200',
        }),
        medplum.searchResources('DocumentReference', {
          encounter: `Encounter/${id}`,
          _count: '200',
        }),
        medplum.searchResources('ServiceRequest', {
          encounter: `Encounter/${id}`,
          _count: '500',
        }),
        medplum.searchResources('DiagnosticReport', {
          encounter: `Encounter/${id}`,
          _count: '200',
        }),
        medplum.searchResources('Task', {
          encounter: `Encounter/${id}`,
          _count: '500',
        }),
        medplum.searchResources('Invoice', {
          subject: encounter.subject?.reference,
          _count: '200',
        }),
      ]);
    const gaps: Gap[] = [];
    if (
      !diagnoses.some((item) =>
        item.extension?.some(
          (ext) =>
            ext.url === `${BASE}/diagnosis-rank` && ext.valueCode === 'primary',
        ),
      )
    )
      gaps.push({
        code: 'primary-diagnosis',
        message: 'Primary diagnosis is missing',
      });
    if (!notes.some((item) => this.signed(item)))
      gaps.push({
        code: 'signed-note',
        message: 'Signed clinical note is missing',
      });
    if (
      services.some((item) =>
        ['draft', 'active', 'on-hold'].includes(item.status),
      )
    )
      gaps.push({ code: 'open-orders', message: 'Open service orders remain' });
    const finalReports = reports.filter((item) =>
      ['final', 'amended', 'corrected', 'appended'].includes(item.status),
    );
    if (
      finalReports.some(
        (report) =>
          !reviews.some(
            (task) =>
              task.status === 'completed' &&
              task.focus?.reference === `DiagnosticReport/${report.id}`,
          ),
      )
    )
      gaps.push({
        code: 'unreviewed-results',
        message: 'Final results await clinician review',
      });
    const scopedInvoices = invoices.filter(
      (item) =>
        this.billingHospitalId(item) === this.encounterHospital(encounter) &&
        item.extension?.some(
          (ext) =>
            ext.url === `${BASE}/billing-encounter` && ext.valueString === id,
        ),
    );
    if (!scopedInvoices.length)
      gaps.push({
        code: 'invoice-missing',
        message: 'Encounter invoice is missing',
      });
    else if (scopedInvoices.some((item) => item.status !== 'balanced'))
      gaps.push({
        code: 'financial-open',
        message: 'Encounter invoice is not financially settled',
      });
    return gaps;
  }
  private signed(document: DocumentReference) {
    const data = document.content?.[0]?.attachment?.data;
    if (!data) return false;
    try {
      return (
        (
          JSON.parse(Buffer.from(data, 'base64').toString('utf8')) as {
            status?: string;
          }
        ).status === 'signed'
      );
    } catch {
      return false;
    }
  }
  private async encounter(id: string, hospitalId: string) {
    let item: Encounter;
    try {
      item = await this.medplumService
        .getClient()
        .readResource('Encounter', id);
    } catch {
      throw new NotFoundException('Encounter not found');
    }
    if (this.encounterHospital(item) !== hospitalId)
      throw new NotFoundException('Encounter not found');
    return item;
  }
  private encounterHospital(item: Encounter) {
    return item.serviceProvider?.reference?.replace('Organization/', '');
  }
  private async compositions(id: string, hospitalId: string) {
    const items = await this.medplumService
      .getClient()
      .searchResources('Composition', {
        encounter: `Encounter/${id}`,
        _count: '100',
      });
    return items.filter((item) => this.hospitalId(item) === hospitalId);
  }
  private async record(id: string, hospitalId: string) {
    let item: Composition;
    try {
      item = await this.medplumService
        .getClient()
        .readResource('Composition', id);
    } catch {
      throw new NotFoundException('Medical record not found');
    }
    if (this.hospitalId(item) !== hospitalId)
      throw new NotFoundException('Medical record not found');
    return item;
  }
  private hospitalId(item: {
    extension?: Array<{ url: string; valueReference?: { reference?: string } }>;
  }) {
    return item.extension
      ?.find((ext) => ext.url === HOSPITAL)
      ?.valueReference?.reference?.replace('Organization/', '');
  }
  private billingHospitalId(item: {
    extension?: Array<{ url: string; valueReference?: { reference?: string } }>;
  }) {
    return item.extension
      ?.find((ext) => ext.url === BILLING_HOSPITAL)
      ?.valueReference?.reference?.replace('Organization/', '');
  }
  private ext(item: Task, url: string) {
    const ext = item.extension?.find((value) => value.url === url);
    return ext?.valueCode ?? ext?.valueString;
  }
  private mapTask(item: Task) {
    return {
      id: item.id,
      status: item.status,
      code: this.ext(item, DEFICIENCY),
      description: item.description,
      ownerId: item.owner?.reference,
      ownerName: item.owner?.display,
      resolution: this.ext(item, RESOLUTION),
      updatedAt: item.lastModified ?? item.authoredOn,
    };
  }
  private recordStatus(item: Composition) {
    return (
      item.extension?.find((ext) => ext.url === RECORD_STATUS)?.valueCode ??
      (item.status === 'final' ? 'signed' : 'reviewed')
    );
  }
  private withExtensions(
    current: Extension[] | undefined,
    additions: Extension[],
  ) {
    const urls = new Set(additions.map((item) => item.url));
    return [
      ...(current ?? []).filter((item) => !urls.has(item.url)),
      ...additions,
    ];
  }
  private mapComposition(item: Composition) {
    return {
      id: item.id,
      status: item.status,
      workflowStatus: this.recordStatus(item),
      hospitalId: this.hospitalId(item),
      encounterId: item.encounter?.reference?.replace('Encounter/', ''),
      patientId: item.subject?.reference?.replace('Patient/', ''),
      title: item.title,
      date: item.date,
      authorId: item.author[0]?.reference,
      authorName: item.author[0]?.display,
      signedAt: item.extension?.find((ext) => ext.url === CLOSED_AT)
        ?.valueDateTime,
      lockedAt: item.extension?.find((ext) => ext.url === LOCKED_AT)
        ?.valueDateTime,
      lockedBy: item.extension?.find((ext) => ext.url === LOCKED_BY)
        ?.valueReference?.display,
      archivedAt: item.extension?.find((ext) => ext.url === ARCHIVED_AT)
        ?.valueDateTime,
      archivedBy: item.extension?.find((ext) => ext.url === ARCHIVED_BY)
        ?.valueReference?.display,
      retentionUntil: item.extension?.find((ext) => ext.url === RETENTION_UNTIL)
        ?.valueDate,
      replacesOrAppends: item.relatesTo?.[0]?.targetReference?.reference,
    };
  }
  private escape(value: string) {
    return value.replace(
      /[&<>"']/g,
      (character) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[character]!,
    );
  }
}
