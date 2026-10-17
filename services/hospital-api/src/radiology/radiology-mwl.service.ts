import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type { Patient, ServiceRequest } from '@medplum/fhirtypes';

import { MedplumService } from '../medplum/medplum.service';

import { RadiologyService } from './radiology.service';

import { RadiologyStationsService } from './radiology-stations.service';

import { PublishRadiologyWorklistDto } from './dto/publish-radiology-worklist.dto';
import { orthancAuthHeaders } from './orthanc-connection';

const MWL_ID_EXTENSION =
  'http://hospital-ehr.local/fhir/StructureDefinition/radiology-mwl-id';

const MWL_SCHEDULED_AT_EXTENSION =
  'http://hospital-ehr.local/fhir/StructureDefinition/radiology-mwl-scheduled-at';

const MWL_STATION_AET_EXTENSION =
  'http://hospital-ehr.local/fhir/StructureDefinition/radiology-mwl-station-aet';

const MWL_STATION_ID_EXTENSION =
  'http://hospital-ehr.local/fhir/StructureDefinition/radiology-mwl-station-id';

type OrthancCreateWorklistResponse = {
  ID?: string;
  Path?: string;
};

type RadiologyOrderView = Awaited<ReturnType<RadiologyService['getOrder']>>;

@Injectable()
export class RadiologyMwlService {
  private readonly orthancUrl =
    process.env.ORTHANC_URL?.replace(/\/+$/, '') ?? 'http://localhost:8042';

  constructor(
    private readonly medplumService: MedplumService,

    private readonly radiologyService: RadiologyService,

    private readonly radiologyStationsService: RadiologyStationsService,
  ) {}

  async getStatus() {
    const worklists = await this.orthancRequest<unknown>(
      '/worklists/?format=Short',
    );

    return {
      connected: true,
      worklistsPlugin: true,
      orthancUrl: this.orthancUrl,
      worklists,
    };
  }

  async listWorklists(format = 'Short') {
    const allowed = ['Short', 'Simplify', 'Full'];

    if (!allowed.includes(format)) {
      throw new BadRequestException('format must be Short, Simplify or Full');
    }

    return this.orthancRequest<unknown>(
      `/worklists/?format=${encodeURIComponent(format)}`,
    );
  }

  async getOrderWorklist(orderId: string) {
    const order = await this.readOrder(orderId);

    const worklistId = this.extensionString(order, MWL_ID_EXTENSION);

    const scheduledAt = this.extensionDateTime(
      order,
      MWL_SCHEDULED_AT_EXTENSION,
    );

    const stationAet = this.extensionString(order, MWL_STATION_AET_EXTENSION);

    const stationId = this.extensionString(order, MWL_STATION_ID_EXTENSION);

    if (!worklistId) {
      return {
        published: false,
        orderId,
        accessionNumber: this.accessionNumber(order),
        scheduledAt,
        stationAet,
        stationId,
      };
    }

    let orthancWorklist: unknown;

    try {
      orthancWorklist = await this.orthancRequest<unknown>(
        `/worklists/${encodeURIComponent(worklistId)}`,
      );
    } catch {
      orthancWorklist = undefined;
    }

    return {
      published: true,
      orderId,
      worklistId,
      accessionNumber: this.accessionNumber(order),
      scheduledAt,
      stationAet,
      stationId,
      orthancWorklist,
    };
  }

  async publishOrder(orderId: string, dto: PublishRadiologyWorklistDto = {}) {
    const orderView = await this.radiologyService.getOrder(orderId);

    this.validateOrderForMwl(orderView);

    const resolvedDto = await this.resolveStation(orderView, dto);

    const order = await this.readOrder(orderId);

    const patient = await this.readPatient(orderView.patientId!);

    const scheduledAt = this.resolveScheduledAt(resolvedDto.scheduledAt);

    const existingWorklistId = this.extensionString(order, MWL_ID_EXTENSION);

    const tags = this.buildWorklistTags(
      orderView,
      patient,
      scheduledAt,
      resolvedDto,
    );

    let worklistId = existingWorklistId;

    let action: 'created' | 'updated';

    if (existingWorklistId) {
      await this.orthancRequest<unknown>(
        `/worklists/${encodeURIComponent(existingWorklistId)}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            Tags: tags,
          }),
        },
      );

      action = 'updated';
    } else {
      const created = await this.orthancRequest<OrthancCreateWorklistResponse>(
        '/worklists/create',
        {
          method: 'POST',
          body: JSON.stringify({
            Tags: tags,
          }),
        },
      );

      worklistId = created.ID ?? this.idFromPath(created.Path);

      if (!worklistId) {
        throw new BadGatewayException(
          'Orthanc created the worklist but did not return its ID.',
        );
      }

      action = 'created';
    }

    if (!worklistId) {
      throw new BadGatewayException('Orthanc worklist ID is missing.');
    }

    const confirmedWorklistId = worklistId;

    await this.saveWorklistContext(
      order,
      confirmedWorklistId,
      scheduledAt,
      resolvedDto.stationAet,
      resolvedDto.stationId,
    );

    const updatedOrder = await this.radiologyService.updateWorkflowStatus(
      orderId,
      'scheduled',
    );

    return {
      action,
      worklistId: confirmedWorklistId,
      scheduledAt: scheduledAt.toISOString(),
      stationId: resolvedDto.stationId?.trim() || undefined,
      stationAet: resolvedDto.stationAet?.trim() || undefined,
      stationName: resolvedDto.stationName?.trim() || undefined,
      accessionNumber: orderView.accessionNumber,
      patientId: orderView.patientId,
      modality: orderView.modality,
      examName: orderView.examName,
      workflowStatus: updatedOrder.workflowStatus,
      tags,
    };
  }

  private async resolveStation(
    order: RadiologyOrderView,
    dto: PublishRadiologyWorklistDto,
  ): Promise<PublishRadiologyWorklistDto> {
    const stationId = dto.stationId?.trim();

    if (!stationId) {
      if (!dto.stationAet?.trim()) {
        throw new BadRequestException(
          'A configured stationId or stationAet is required for DICOM MWL publishing.',
        );
      }

      return {
        ...dto,
        stationAet: dto.stationAet.trim().toUpperCase(),
        stationName: dto.stationName?.trim() || undefined,
      };
    }

    const station = await this.radiologyStationsService.getStation(stationId);

    if (!station.active) {
      throw new BadRequestException(
        `Radiology station ${station.name} is inactive.`,
      );
    }

    if (order.hospitalId && station.hospitalId !== order.hospitalId) {
      throw new BadRequestException(
        'Selected modality station belongs to a different hospital.',
      );
    }

    const orderModality = String(order.modality ?? '')
      .trim()
      .toUpperCase();

    if (orderModality && station.modality !== orderModality) {
      throw new BadRequestException(
        `Selected station modality ${station.modality} does not match order modality ${orderModality}.`,
      );
    }

    return {
      ...dto,
      stationId: station.id,
      stationAet: station.aet,
      stationName: station.name,
    };
  }

  async deleteWorklist(worklistId: string) {
    const id = worklistId?.trim();

    if (!id) {
      throw new BadRequestException('worklistId is required.');
    }

    await this.orthancRequest<unknown>(`/worklists/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });

    return {
      deleted: true,
      worklistId: id,
    };
  }

  private buildWorklistTags(
    order: RadiologyOrderView,
    patient: Patient,
    scheduledAt: Date,
    dto: PublishRadiologyWorklistDto,
  ) {
    const accession = order.accessionNumber!;

    const patientId = this.patientDicomId(patient);

    const patientName = this.patientDicomName(patient);

    const procedureId = order.examCode || accession;

    const procedureDescription = order.examName || 'Radiology Exam';

    const scheduledStep: Record<string, unknown> = {
      Modality: this.dicomModality(order.modality),

      ScheduledProcedureStepStartDate: this.dicomDate(scheduledAt),

      ScheduledProcedureStepStartTime: this.dicomTime(scheduledAt),

      ScheduledProcedureStepID: accession,

      ScheduledProcedureStepDescription: procedureDescription,
    };

    if (dto.stationAet?.trim()) {
      scheduledStep.ScheduledStationAETitle = dto.stationAet.trim();
    }

    if (dto.stationName?.trim()) {
      scheduledStep.ScheduledStationName = dto.stationName.trim();
    }

    if (dto.performingPhysicianName?.trim()) {
      scheduledStep.ScheduledPerformingPhysicianName =
        dto.performingPhysicianName.trim();
    }

    const tags: Record<string, unknown> = {
      SpecificCharacterSet: 'ISO_IR 192',

      PatientID: patientId,

      PatientName: patientName,

      AccessionNumber: accession,

      RequestedProcedureID: procedureId,

      RequestedProcedureDescription: procedureDescription,

      ScheduledProcedureStepSequence: [scheduledStep],
    };

    const birthDate = this.dicomBirthDate(patient.birthDate);

    if (birthDate) {
      tags.PatientBirthDate = birthDate;
    }

    const sex = this.dicomSex(patient.gender);

    if (sex) {
      tags.PatientSex = sex;
    }

    if (order.requesterName?.trim()) {
      tags.ReferringPhysicianName = order.requesterName.trim();
    }

    return tags;
  }

  private validateOrderForMwl(order: RadiologyOrderView) {
    if (!order.id) {
      throw new BadRequestException('Radiology order has no ID.');
    }

    if (!order.patientId) {
      throw new BadRequestException('Radiology order has no patient.');
    }

    const accessionNumber = order.accessionNumber?.trim();

    if (!accessionNumber) {
      throw new BadRequestException('Radiology order has no accession number.');
    }

    if (accessionNumber.length > 16) {
      throw new BadRequestException(
        `Radiology accession number must be 16 characters or fewer for DICOM MWL. Received: ${accessionNumber}`,
      );
    }

    if (order.status === 'revoked' || order.status === 'entered-in-error') {
      throw new BadRequestException(
        'Cancelled or erroneous radiology orders cannot be published to MWL.',
      );
    }
  }

  private async saveWorklistContext(
    order: ServiceRequest,
    worklistId: string,
    scheduledAt: Date,
    stationAet?: string,
    stationId?: string,
  ) {
    const extensions = [
      ...(order.extension ?? []).filter(
        (extension) =>
          extension.url !== MWL_ID_EXTENSION &&
          extension.url !== MWL_SCHEDULED_AT_EXTENSION &&
          extension.url !== MWL_STATION_AET_EXTENSION &&
          extension.url !== MWL_STATION_ID_EXTENSION,
      ),

      {
        url: MWL_ID_EXTENSION,
        valueString: worklistId,
      },

      {
        url: MWL_SCHEDULED_AT_EXTENSION,
        valueDateTime: scheduledAt.toISOString(),
      },

      ...(stationAet?.trim()
        ? [
            {
              url: MWL_STATION_AET_EXTENSION,
              valueString: stationAet.trim(),
            },
          ]
        : []),

      ...(stationId?.trim()
        ? [
            {
              url: MWL_STATION_ID_EXTENSION,
              valueString: stationId.trim(),
            },
          ]
        : []),
    ];

    await this.medplumService.getClient().updateResource({
      ...order,
      extension: extensions,
    });
  }

  private async readOrder(id: string): Promise<ServiceRequest> {
    try {
      return await this.medplumService
        .getClient()
        .readResource('ServiceRequest', id);
    } catch {
      throw new NotFoundException(`Radiology order ${id} was not found.`);
    }
  }

  private async readPatient(id: string): Promise<Patient> {
    try {
      return await this.medplumService.getClient().readResource('Patient', id);
    } catch {
      throw new NotFoundException(`Patient ${id} was not found.`);
    }
  }

  private accessionNumber(order: ServiceRequest) {
    return order.identifier?.find((identifier) =>
      identifier.system?.includes('radiology-accession'),
    )?.value;
  }

  private patientDicomId(patient: Patient) {
    const identifiers = patient.identifier ?? [];

    const preferred = identifiers.find((identifier) => {
      const system = identifier.system?.toLowerCase() ?? '';

      return (
        system.includes('mrn') ||
        system.includes('medical-record') ||
        system.includes('patient-id')
      );
    });

    return (
      preferred?.value ||
      identifiers.find((identifier) => Boolean(identifier.value))?.value ||
      patient.id ||
      'UNKNOWN'
    );
  }

  private patientDicomName(patient: Patient) {
    const name = patient.name?.[0];

    if (!name) {
      return 'UNKNOWN';
    }

    const family = name.family?.trim() ?? '';

    const given = name.given?.filter(Boolean).join(' ').trim() ?? '';

    if (family || given) {
      return `${family}^${given}`;
    }

    return name.text?.trim() || 'UNKNOWN';
  }

  private dicomBirthDate(value?: string) {
    if (!value) {
      return undefined;
    }

    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

    if (!match) {
      return undefined;
    }

    return match[1] + match[2] + match[3];
  }

  private dicomSex(gender?: string) {
    switch (gender) {
      case 'male':
        return 'M';
      case 'female':
        return 'F';
      case 'other':
        return 'O';
      default:
        return undefined;
    }
  }

  private dicomModality(modality: unknown) {
    const value = (typeof modality === 'string' && modality ? modality : 'OT')
      .trim()
      .toUpperCase();

    if (value === 'OTHER') {
      return 'OT';
    }

    return value;
  }

  private dicomDate(date: Date) {
    const year = date.getFullYear().toString().padStart(4, '0');

    const month = (date.getMonth() + 1).toString().padStart(2, '0');

    const day = date.getDate().toString().padStart(2, '0');

    return year + month + day;
  }

  private dicomTime(date: Date) {
    const hour = date.getHours().toString().padStart(2, '0');

    const minute = date.getMinutes().toString().padStart(2, '0');

    const second = date.getSeconds().toString().padStart(2, '0');

    return hour + minute + second;
  }

  private resolveScheduledAt(value?: string) {
    if (!value?.trim()) {
      return new Date();
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(
        'scheduledAt must be a valid ISO-8601 date/time.',
      );
    }

    return date;
  }

  private extensionString(order: ServiceRequest, url: string) {
    const extension = order.extension?.find((item) => item.url === url);

    return extension?.valueString;
  }

  private extensionDateTime(order: ServiceRequest, url: string) {
    const extension = order.extension?.find((item) => item.url === url);

    return extension?.valueDateTime;
  }

  private idFromPath(path?: string) {
    if (!path) {
      return undefined;
    }

    const parts = path.split('/').filter(Boolean);

    return parts.at(-1);
  }

  private async orthancRequest<T>(
    path: string,
    init?: RequestInit,
  ): Promise<T> {
    let response: Response;

    try {
      response = await fetch(`${this.orthancUrl}${path}`, {
        ...init,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...orthancAuthHeaders(),
          ...(init?.headers ?? {}),
        },
      });
    } catch {
      throw new BadGatewayException(
        `Unable to connect to Orthanc at ${this.orthancUrl}.`,
      );
    }

    if (!response.ok) {
      const message = await response.text();

      if (response.status === 404) {
        throw new NotFoundException(
          message || 'Orthanc Worklists plugin endpoint was not found.',
        );
      }

      throw new BadGatewayException(
        `Orthanc returned HTTP ${response.status}: ${
          message || response.statusText
        }`,
      );
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const text = await response.text();

    if (!text) {
      return undefined as T;
    }

    try {
      return JSON.parse(text) as T;
    } catch {
      return text as T;
    }
  }
}
