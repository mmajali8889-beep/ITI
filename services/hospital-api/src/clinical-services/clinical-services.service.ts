import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Encounter, Patient, ServiceRequest } from '@medplum/fhirtypes';
import { randomUUID } from 'node:crypto';
import { MedplumService } from '../medplum/medplum.service';
import {
  CreateClinicalServiceOrderDto,
  UpdateClinicalServiceStatusDto,
} from './dto/clinical-service.dto';

const BASE = 'https://hospital-ehr.local/fhir/StructureDefinition';
const HOSPITAL = `${BASE}/clinical-service-hospital`;
const SERVICE_TYPE = `${BASE}/clinical-service-type`;
const PERFORMER = `${BASE}/clinical-service-performer`;
const COMPLETION_NOTE = `${BASE}/clinical-service-completion-note`;
const COMPLETED_AT = `${BASE}/clinical-service-completed-at`;

@Injectable()
export class ClinicalServicesService {
  constructor(private readonly medplumService: MedplumService) {}

  async create(dto: CreateClinicalServiceOrderDto) {
    for (const field of [
      'hospitalId',
      'patientId',
      'encounterId',
      'serviceType',
      'serviceCode',
      'serviceName',
    ] as const) {
      if (!String(dto[field] ?? '').trim())
        throw new BadRequestException(`${field} is required`);
    }
    if (
      ![
        'procedure',
        'consultation',
        'admission-request',
        'follow-up',
        'sick-leave',
        'document',
        'other',
      ].includes(dto.serviceType)
    )
      throw new BadRequestException('Invalid clinical service type');
    if (
      dto.priority &&
      !['routine', 'urgent', 'asap', 'stat'].includes(dto.priority)
    )
      throw new BadRequestException('Invalid priority');
    const { patient, encounter } = await this.context(
      dto.patientId,
      dto.encounterId,
      dto.hospitalId,
    );
    if (
      ['finished', 'cancelled', 'entered-in-error'].includes(encounter.status)
    )
      throw new ConflictException(
        'Cannot add services to a finalized encounter',
      );
    this.assertFinancialClearance(encounter);

    const order: ServiceRequest = {
      resourceType: 'ServiceRequest',
      status: 'active',
      intent: 'order',
      priority: dto.priority ?? 'routine',
      identifier: [
        {
          system: `https://hospital-ehr.local/clinical-service/${dto.hospitalId}`,
          value: `SVC-${randomUUID().slice(0, 8).toUpperCase()}`,
        },
      ],
      category: [
        {
          coding: [
            {
              system:
                'https://hospital-ehr.local/CodeSystem/clinical-service-category',
              code: dto.serviceType,
              display: this.display(dto.serviceType),
            },
          ],
          text: this.display(dto.serviceType),
        },
      ],
      code: {
        coding: [
          {
            system: 'https://hospital-ehr.local/CodeSystem/clinical-services',
            code: dto.serviceCode.trim(),
            display: dto.serviceName.trim(),
          },
        ],
        text: dto.serviceName.trim(),
      },
      subject: {
        reference: `Patient/${dto.patientId}`,
        display: patient.name?.[0]?.text,
      },
      encounter: { reference: `Encounter/${dto.encounterId}` },
      authoredOn: new Date().toISOString(),
      requester: dto.requesterId
        ? {
            reference: `Practitioner/${dto.requesterId}`,
            display: dto.requesterName,
          }
        : { reference: `Organization/${dto.hospitalId}` },
      performer: dto.performerId
        ? [
            {
              reference: `Practitioner/${dto.performerId}`,
              display: dto.performerName,
            },
          ]
        : dto.performerName
          ? [{ display: dto.performerName }]
          : undefined,
      note: dto.clinicalNote?.trim()
        ? [{ text: dto.clinicalNote.trim() }]
        : undefined,
      extension: [
        {
          url: HOSPITAL,
          valueReference: { reference: `Organization/${dto.hospitalId}` },
        },
        { url: SERVICE_TYPE, valueCode: dto.serviceType },
      ],
    };
    return this.map(
      await this.medplumService
        .getClient()
        .createResource<ServiceRequest>(order),
    );
  }

  async byEncounter(encounterId: string, hospitalId: string) {
    if (!encounterId || !hospitalId)
      throw new BadRequestException('Encounter and hospital are required');
    const encounter = await this.readEncounter(encounterId, hospitalId);
    const items = await this.medplumService
      .getClient()
      .searchResources('ServiceRequest', {
        encounter: `Encounter/${encounterId}`,
        _count: '500',
      });
    const orders = items.filter(
      (item) => this.hospitalId(item) === hospitalId && this.isGeneral(item),
    );
    return {
      encounterId: encounter.id,
      total: orders.length,
      orders: orders.map((item) => this.map(item)),
    };
  }

  async byPatient(patientId: string, hospitalId: string) {
    await this.readPatient(patientId, hospitalId);
    const items = await this.medplumService
      .getClient()
      .searchResources('ServiceRequest', {
        subject: `Patient/${patientId}`,
        _count: '500',
      });
    const orders = items.filter(
      (item) => this.hospitalId(item) === hospitalId && this.isGeneral(item),
    );
    return {
      patientId,
      total: orders.length,
      orders: orders.map((item) => this.map(item)),
    };
  }

  async updateStatus(orderId: string, dto: UpdateClinicalServiceStatusDto) {
    if (!dto.hospitalId)
      throw new BadRequestException('Hospital ID is required');
    if (!['active', 'on-hold', 'completed', 'revoked'].includes(dto.status))
      throw new BadRequestException('Invalid clinical service status');
    const order = await this.readOrder(orderId, dto.hospitalId);
    const transitions: Record<string, string[]> = {
      active: ['on-hold', 'completed', 'revoked'],
      'on-hold': ['active', 'completed', 'revoked'],
      completed: [],
      revoked: [],
    };
    if (!transitions[order.status]?.includes(dto.status))
      throw new ConflictException(
        `Cannot change clinical service from ${order.status} to ${dto.status}`,
      );
    if (
      dto.status === 'completed' &&
      (!dto.completionNote?.trim() || !dto.performerName?.trim())
    )
      throw new BadRequestException(
        'Performer and completion note are required to complete a service',
      );
    order.status = dto.status;
    order.extension = [
      ...(order.extension ?? []).filter(
        (item) =>
          ![PERFORMER, COMPLETION_NOTE, COMPLETED_AT].includes(item.url),
      ),
      ...(dto.performerName
        ? [
            {
              url: PERFORMER,
              valueReference: dto.performerId
                ? {
                    reference: `Practitioner/${dto.performerId}`,
                    display: dto.performerName.trim(),
                  }
                : { display: dto.performerName.trim() },
            },
          ]
        : []),
      ...(dto.completionNote
        ? [{ url: COMPLETION_NOTE, valueString: dto.completionNote.trim() }]
        : []),
      ...(dto.status === 'completed'
        ? [{ url: COMPLETED_AT, valueDateTime: new Date().toISOString() }]
        : []),
    ];
    return this.map(
      await this.medplumService
        .getClient()
        .updateResource<ServiceRequest>(order),
    );
  }

  private async context(
    patientId: string,
    encounterId: string,
    hospitalId: string,
  ) {
    const patient = await this.readPatient(patientId, hospitalId);
    const encounter = await this.readEncounter(encounterId, hospitalId);
    if (encounter.subject?.reference !== `Patient/${patientId}`)
      throw new NotFoundException('Encounter not found');
    return { patient, encounter };
  }
  private async readPatient(id: string, hospitalId: string) {
    let item: Patient;
    try {
      item = await this.medplumService.getClient().readResource('Patient', id);
    } catch {
      throw new NotFoundException('Patient not found');
    }
    if (item.managingOrganization?.reference !== `Organization/${hospitalId}`)
      throw new NotFoundException('Patient not found');
    return item;
  }
  private async readEncounter(id: string, hospitalId: string) {
    let item: Encounter;
    try {
      item = await this.medplumService
        .getClient()
        .readResource('Encounter', id);
    } catch {
      throw new NotFoundException('Encounter not found');
    }
    if (item.serviceProvider?.reference !== `Organization/${hospitalId}`)
      throw new NotFoundException('Encounter not found');
    return item;
  }
  private async readOrder(id: string, hospitalId: string) {
    let item: ServiceRequest;
    try {
      item = await this.medplumService
        .getClient()
        .readResource('ServiceRequest', id);
    } catch {
      throw new NotFoundException('Clinical service order not found');
    }
    if (this.hospitalId(item) !== hospitalId || !this.isGeneral(item))
      throw new NotFoundException('Clinical service order not found');
    return item;
  }
  private hospitalId(item: ServiceRequest) {
    return item.extension
      ?.find((ext) => ext.url === HOSPITAL)
      ?.valueReference?.reference?.replace('Organization/', '');
  }
  private isGeneral(item: ServiceRequest) {
    return [
      'procedure',
      'consultation',
      'admission-request',
      'follow-up',
      'sick-leave',
      'document',
      'other',
    ].includes(item.category?.[0]?.coding?.[0]?.code ?? '');
  }
  private display(type: string) {
    const labels: Record<string, string> = {
      procedure: 'Procedure',
      consultation: 'Consultation',
      'admission-request': 'Admission Request',
      'follow-up': 'Follow-up',
      'sick-leave': 'Sick Leave',
      document: 'Clinical Document',
      other: 'Other Service',
    };
    return labels[type] ?? 'Other Service';
  }
  private assertFinancialClearance(encounter: Encounter) {
    const status = encounter.extension?.find(
      (item) => item.url === `${BASE}/financial-clearance-status`,
    )?.valueCode;
    if (status && !['cleared', 'emergency-override'].includes(status))
      throw new ConflictException({
        message:
          'Financial clearance is required before non-emergency services',
        code: 'FINANCIAL_CLEARANCE_REQUIRED',
        status,
      });
  }
  private ext(item: ServiceRequest, url: string) {
    const value = item.extension?.find((extension) => extension.url === url);
    return (
      value?.valueString ??
      value?.valueDateTime ??
      value?.valueCode ??
      value?.valueReference?.display
    );
  }
  private map(item: ServiceRequest) {
    return {
      id: item.id,
      identifier: item.identifier?.[0]?.value,
      hospitalId: this.hospitalId(item),
      patientId: item.subject.reference?.replace('Patient/', ''),
      encounterId: item.encounter?.reference?.replace('Encounter/', ''),
      serviceType: item.category?.[0]?.coding?.[0]?.code,
      serviceCode: item.code?.coding?.[0]?.code,
      serviceName: item.code?.text,
      status: item.status,
      priority: item.priority,
      requesterId: item.requester?.reference?.replace('Practitioner/', ''),
      requesterName: item.requester?.display,
      performerName: this.ext(item, PERFORMER) ?? item.performer?.[0]?.display,
      completionNote: this.ext(item, COMPLETION_NOTE),
      completedAt: this.ext(item, COMPLETED_AT),
      authoredOn: item.authoredOn,
    };
  }
}
