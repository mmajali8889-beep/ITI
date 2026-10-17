import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Appointment, Communication, Patient } from '@medplum/fhirtypes';
import { randomUUID } from 'node:crypto';
import { EncountersService } from '../encounters/encounters.service';
import { MedplumService } from '../medplum/medplum.service';
import {
  CreateAppointmentDto,
  RescheduleAppointmentDto,
  UpdateAppointmentStatusDto,
} from './dto/appointment.dto';
import { SchedulingService } from './scheduling.service';

const HOSPITAL_EXTENSION =
  'https://hospital-ehr.local/fhir/StructureDefinition/appointment-hospital';
const DEPARTMENT_EXTENSION =
  'https://hospital-ehr.local/fhir/StructureDefinition/appointment-department';
const PRIORITY_EXTENSION =
  'https://hospital-ehr.local/fhir/StructureDefinition/appointment-priority';
const WORKFLOW_EXTENSION =
  'https://hospital-ehr.local/fhir/StructureDefinition/appointment-workflow-status';
const RESCHEDULE_REASON =
  'https://hospital-ehr.local/fhir/StructureDefinition/appointment-reschedule-reason';
const ACTIVE_STATUSES = [
  'proposed',
  'pending',
  'booked',
  'arrived',
  'checked-in',
];

@Injectable()
export class AppointmentsService {
  constructor(
    private readonly medplumService: MedplumService,
    private readonly encountersService: EncountersService,
    private readonly schedulingService: SchedulingService,
  ) {}

  async create(dto: CreateAppointmentDto) {
    this.validateCreate(dto);
    const medplum = this.medplumService.getClient();
    let patient: Patient;
    try {
      patient = await medplum.readResource('Patient', dto.patientId);
    } catch {
      throw new NotFoundException('Patient not found');
    }
    if (
      patient.managingOrganization?.reference !==
      `Organization/${dto.hospitalId}`
    )
      throw new NotFoundException('Patient not found');

    const slot = dto.slotId
      ? await this.schedulingService.reserve(dto.slotId, dto.hospitalId)
      : undefined;
    const start = slot ? new Date(slot.start) : new Date(dto.start);
    const end = slot
      ? new Date(slot.end)
      : new Date(start.getTime() + Number(dto.durationMinutes) * 60_000);
    if (Number.isNaN(start.getTime()) || start <= new Date())
      throw new BadRequestException(
        'Appointment start must be a valid future time',
      );
    if (
      !Number.isInteger(Number(dto.durationMinutes)) ||
      dto.durationMinutes < 10 ||
      dto.durationMinutes > 480
    ) {
      throw new BadRequestException(
        'Duration must be between 10 and 480 minutes',
      );
    }
    await this.assertNoConflict(
      dto.hospitalId,
      dto.patientId,
      dto.practitionerId,
      dto.practitionerName,
      start,
      end,
    );

    const patientName =
      patient.name?.find((name) => name.use === 'official')?.text ??
      patient.name?.[0]?.text;
    const resource: Appointment = {
      resourceType: 'Appointment',
      status: 'booked',
      identifier: [
        {
          system: `https://hospital-ehr.local/appointment/${dto.hospitalId}`,
          value: `APT-${start.getUTCFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`,
          assigner: { reference: `Organization/${dto.hospitalId}` },
        },
      ],
      serviceType: [{ text: dto.serviceType.trim() }],
      specialty: [{ text: dto.department.trim() }],
      appointmentType: {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/v2-0276',
            code: 'ROUTINE',
            display: 'Routine appointment',
          },
        ],
      },
      reasonCode: [{ text: dto.reason.trim() }],
      description: dto.reason.trim(),
      start: start.toISOString(),
      end: end.toISOString(),
      minutesDuration: Number(dto.durationMinutes),
      comment: dto.notes?.trim(),
      created: new Date().toISOString(),
      participant: [
        {
          actor: {
            reference: `Patient/${dto.patientId}`,
            display: patientName,
          },
          required: 'required',
          status: 'accepted',
        },
        {
          actor: dto.practitionerId
            ? {
                reference: `Practitioner/${dto.practitionerId}`,
                display: dto.practitionerName.trim(),
              }
            : { display: dto.practitionerName.trim() },
          required: 'required',
          status: 'accepted',
        },
      ],
      slot: slot?.id ? [{ reference: `Slot/${slot.id}` }] : undefined,
      extension: [
        {
          url: HOSPITAL_EXTENSION,
          valueReference: { reference: `Organization/${dto.hospitalId}` },
        },
        { url: DEPARTMENT_EXTENSION, valueString: dto.department.trim() },
        { url: PRIORITY_EXTENSION, valueCode: dto.priority ?? 'routine' },
        { url: WORKFLOW_EXTENSION, valueCode: 'booked' },
      ],
    };
    const created = await medplum.createResource<Appointment>(resource);
    if (slot) await this.schedulingService.mark(slot, 'busy');
    await this.notify(created, 'booked');
    return this.map(created);
  }

  async list(hospitalId: string, date?: string, status?: string) {
    if (!hospitalId) throw new BadRequestException('Hospital ID is required');
    let from: number | undefined;
    let to: number | undefined;
    if (date) {
      const parsed = new Date(`${date}T00:00:00`);
      if (Number.isNaN(parsed.getTime()))
        throw new BadRequestException('Invalid appointment date');
      from = parsed.getTime();
      to = from + 24 * 60 * 60 * 1000;
    }
    const resources = await this.medplumService
      .getClient()
      .searchResources('Appointment', { _count: '500' });
    const appointments = resources
      .filter((item) => this.hospitalId(item) === hospitalId)
      .filter(
        (item) =>
          !status || status === 'all' || this.workflowStatus(item) === status,
      )
      .filter(
        (item) =>
          !from ||
          !to ||
          (!!item.start &&
            new Date(item.start).getTime() >= from &&
            new Date(item.start).getTime() < to),
      )
      .sort((a, b) => (a.start ?? '').localeCompare(b.start ?? ''))
      .map((item) => this.map(item));
    return { total: appointments.length, appointments };
  }

  async updateStatus(appointmentId: string, dto: UpdateAppointmentStatusDto) {
    const allowed = [
      'booked',
      'confirmed',
      'arrived',
      'checked-in',
      'fulfilled',
      'cancelled',
      'noshow',
    ];
    if (!allowed.includes(dto.status))
      throw new BadRequestException('Invalid appointment status');
    const appointment = await this.readScoped(appointmentId, dto.hospitalId);
    if (['cancelled', 'fulfilled', 'noshow'].includes(appointment.status))
      throw new ConflictException('Finalized appointment cannot be changed');
    if (
      ['cancelled', 'noshow'].includes(dto.status) &&
      !dto.cancellationReason?.trim()
    )
      throw new BadRequestException('Reason is required');
    const current = this.workflowStatus(appointment);
    const transitions: Record<string, string[]> = {
      booked: ['confirmed', 'arrived', 'cancelled', 'noshow'],
      confirmed: ['arrived', 'cancelled', 'noshow'],
      arrived: ['checked-in', 'cancelled', 'noshow'],
      'checked-in': ['fulfilled'],
      fulfilled: [],
      cancelled: [],
      noshow: [],
    };
    if (!transitions[current]?.includes(dto.status) && dto.status !== current)
      throw new ConflictException(
        `Cannot change appointment from ${current} to ${dto.status}`,
      );
    appointment.status = dto.status === 'confirmed' ? 'booked' : dto.status;
    appointment.extension = [
      ...(appointment.extension ?? []).filter(
        (ext) => ext.url !== WORKFLOW_EXTENSION,
      ),
      { url: WORKFLOW_EXTENSION, valueCode: dto.status },
    ];
    appointment.cancelationReason = ['cancelled', 'noshow'].includes(dto.status)
      ? { text: dto.cancellationReason!.trim() }
      : undefined;
    const updated = await this.medplumService
      .getClient()
      .updateResource<Appointment>(appointment);
    if (['confirmed', 'cancelled'].includes(dto.status))
      await this.notify(updated, dto.status);
    if (dto.status === 'cancelled' && appointment.slot?.[0]?.reference) {
      const slot = await this.schedulingService.slot(
        appointment.slot[0].reference.replace('Slot/', ''),
        dto.hospitalId,
      );
      await this.schedulingService.mark(slot, 'free');
    }
    return this.map(updated);
  }

  async checkIn(appointmentId: string, dto: { hospitalId: string }) {
    const appointment = await this.readScoped(appointmentId, dto.hospitalId);
    if (!['arrived', 'booked'].includes(appointment.status))
      throw new ConflictException(
        'Only arrived or booked appointments can be checked in',
      );
    const patientId = appointment.participant
      .find((item) => item.actor?.reference?.startsWith('Patient/'))
      ?.actor?.reference?.replace('Patient/', '');
    if (!patientId)
      throw new BadRequestException('Appointment patient is missing');
    const practitioner = appointment.participant.find(
      (item) =>
        item.actor?.reference?.startsWith('Practitioner/') ||
        (!item.actor?.reference && item.actor?.display),
    );
    const encounter = await this.encountersService.create({
      patientId,
      hospitalId: dto.hospitalId,
      encounterType: 'outpatient',
      department:
        this.extension(appointment, DEPARTMENT_EXTENSION) ?? 'Outpatient',
      practitionerId: practitioner?.actor?.reference?.replace(
        'Practitioner/',
        '',
      ),
      practitionerName: practitioner?.actor?.display,
      reason:
        appointment.reasonCode?.[0]?.text ??
        appointment.description ??
        'Scheduled appointment',
      priority:
        this.extension(appointment, PRIORITY_EXTENSION) === 'urgent'
          ? 'urgent'
          : 'routine',
      arrivalMode: 'appointment',
      registrationConfirmed: true,
      appointmentId,
    });
    appointment.status = 'checked-in';
    appointment.extension = [
      ...(appointment.extension ?? []).filter(
        (ext) => ext.url !== WORKFLOW_EXTENSION,
      ),
      { url: WORKFLOW_EXTENSION, valueCode: 'checked-in' },
    ];
    await this.medplumService
      .getClient()
      .updateResource<Appointment>(appointment);
    return { appointment: this.map(appointment), encounter };
  }

  async reschedule(appointmentId: string, dto: RescheduleAppointmentDto) {
    if (!dto.reason?.trim())
      throw new BadRequestException('Reschedule reason is required');
    const appointment = await this.readScoped(appointmentId, dto.hospitalId);
    if (['fulfilled', 'cancelled', 'noshow'].includes(appointment.status))
      throw new ConflictException(
        'Finalized appointment cannot be rescheduled',
      );
    const next = await this.schedulingService.reserve(
      dto.slotId,
      dto.hospitalId,
    );
    const previousRef = appointment.slot?.[0]?.reference;
    appointment.start = next.start;
    appointment.end = next.end;
    appointment.minutesDuration = Math.round(
      (new Date(next.end).getTime() - new Date(next.start).getTime()) / 60000,
    );
    appointment.slot = next.id ? [{ reference: `Slot/${next.id}` }] : undefined;
    appointment.status = 'booked';
    appointment.extension = [
      ...(appointment.extension ?? []).filter(
        (ext) => ![WORKFLOW_EXTENSION, RESCHEDULE_REASON].includes(ext.url),
      ),
      { url: WORKFLOW_EXTENSION, valueCode: 'rescheduled' },
      { url: RESCHEDULE_REASON, valueString: dto.reason.trim() },
    ];
    const updated = await this.medplumService
      .getClient()
      .updateResource<Appointment>(appointment);
    await this.schedulingService.mark(next, 'busy');
    if (previousRef && previousRef !== `Slot/${next.id}`) {
      const previous = await this.schedulingService.slot(
        previousRef.replace('Slot/', ''),
        dto.hospitalId,
      );
      await this.schedulingService.mark(previous, 'free');
    }
    await this.notify(updated, 'rescheduled');
    return this.map(updated);
  }

  private validateCreate(dto: CreateAppointmentDto) {
    for (const key of [
      'hospitalId',
      'patientId',
      'practitionerName',
      'department',
      'serviceType',
      'reason',
    ] as const) {
      if (!String(dto[key] ?? '').trim())
        throw new BadRequestException(`${key} is required`);
    }
    if (dto.reason.trim().length < 3 || dto.reason.trim().length > 500)
      throw new BadRequestException('Reason must contain 3 to 500 characters');
    if (dto.priority && !['routine', 'urgent'].includes(dto.priority))
      throw new BadRequestException('Invalid priority');
  }

  private async assertNoConflict(
    hospitalId: string,
    patientId: string,
    practitionerId: string | undefined,
    practitionerName: string,
    start: Date,
    end: Date,
  ) {
    const items = await this.medplumService
      .getClient()
      .searchResources('Appointment', { _count: '500' });
    const conflict = items.find(
      (item) =>
        this.hospitalId(item) === hospitalId &&
        ACTIVE_STATUSES.includes(item.status) &&
        item.start &&
        item.end &&
        new Date(item.start) < end &&
        new Date(item.end) > start &&
        item.participant.some(
          (participant) =>
            participant.actor?.reference === `Patient/${patientId}` ||
            (practitionerId &&
              participant.actor?.reference ===
                `Practitioner/${practitionerId}`) ||
            (!practitionerId &&
              participant.actor?.display?.trim().toLowerCase() ===
                practitionerName.trim().toLowerCase()),
        ),
    );
    if (conflict)
      throw new ConflictException({
        message: 'Patient or practitioner has a conflicting appointment',
        code: 'APPOINTMENT_CONFLICT',
        appointmentId: conflict.id,
      });
  }

  private async readScoped(id: string, hospitalId: string) {
    if (!id || !hospitalId)
      throw new BadRequestException('Appointment and hospital are required');
    let appointment: Appointment;
    try {
      appointment = await this.medplumService
        .getClient()
        .readResource('Appointment', id);
    } catch {
      throw new NotFoundException('Appointment not found');
    }
    if (this.hospitalId(appointment) !== hospitalId)
      throw new NotFoundException('Appointment not found');
    return appointment;
  }

  private hospitalId(item: Appointment) {
    return item.extension
      ?.find((ext) => ext.url === HOSPITAL_EXTENSION)
      ?.valueReference?.reference?.replace('Organization/', '');
  }
  private extension(item: Appointment, url: string) {
    const ext = item.extension?.find((value) => value.url === url);
    return ext?.valueString ?? ext?.valueCode;
  }
  private workflowStatus(item: Appointment) {
    return this.extension(item, WORKFLOW_EXTENSION) ?? item.status;
  }
  private async notify(item: Appointment, event: string) {
    const patient = item.participant.find((p) =>
      p.actor?.reference?.startsWith('Patient/'),
    )?.actor;
    if (!patient) return;
    const communication: Communication = {
      resourceType: 'Communication',
      status: 'completed',
      category: [{ text: 'Appointment notification' }],
      subject: { reference: patient.reference },
      sent: new Date().toISOString(),
      recipient: [{ reference: patient.reference }],
      payload: [{ contentString: `Appointment ${event}: ${item.start ?? ''}` }],
      about: item.id ? [{ reference: `Appointment/${item.id}` }] : undefined,
      extension: [
        {
          url: HOSPITAL_EXTENSION,
          valueReference: {
            reference: `Organization/${this.hospitalId(item)}`,
          },
        },
      ],
    };
    await this.medplumService
      .getClient()
      .createResource<Communication>(communication);
  }
  private map(item: Appointment) {
    const patient = item.participant.find((p) =>
      p.actor?.reference?.startsWith('Patient/'),
    )?.actor;
    const practitioner = item.participant.find(
      (p) =>
        p.actor?.reference?.startsWith('Practitioner/') ||
        (!p.actor?.reference && p.actor?.display),
    )?.actor;
    return {
      id: item.id,
      identifier: item.identifier?.[0]?.value,
      hospitalId: this.hospitalId(item),
      status: this.workflowStatus(item),
      fhirStatus: item.status,
      start: item.start,
      end: item.end,
      durationMinutes: item.minutesDuration,
      patientId: patient?.reference?.replace('Patient/', ''),
      patientName: patient?.display,
      practitionerId: practitioner?.reference?.replace('Practitioner/', ''),
      practitionerName: practitioner?.display,
      department: this.extension(item, DEPARTMENT_EXTENSION),
      serviceType: item.serviceType?.[0]?.text,
      reason: item.reasonCode?.[0]?.text ?? item.description,
      priority: this.extension(item, PRIORITY_EXTENSION),
      notes: item.comment,
      cancellationReason: item.cancelationReason?.text,
      slotId: item.slot?.[0]?.reference?.replace('Slot/', ''),
      rescheduleReason: this.extension(item, RESCHEDULE_REASON),
    };
  }
}
