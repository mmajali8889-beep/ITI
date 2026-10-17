import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { randomUUID } from 'node:crypto';

import type { Encounter, Observation, Patient } from '@medplum/fhirtypes';

import { MedplumService } from '../medplum/medplum.service';

import {
  CreateEncounterDto,
  ArrivalMode,
  EncounterPriority,
  EncounterType,
} from './dto/create-encounter.dto';
import { FinishEncounterDto } from './dto/finish-encounter.dto';
import {
  AssignEmergencyBedDto,
  EmergencyQuickArrivalDto,
  EmergencyReassessmentDto,
} from './dto/emergency.dto';

@Injectable()
export class EncountersService {
  constructor(private readonly medplumService: MedplumService) {}

  // =====================================================
  // CREATE ENCOUNTER
  // =====================================================

  async create(dto: CreateEncounterDto) {
    const medplum = this.medplumService.getClient();

    // ===================================================
    // Validate request
    // ===================================================

    if (!dto.patientId) {
      throw new BadRequestException('Patient ID is required');
    }

    if (!dto.hospitalId) {
      throw new BadRequestException('Hospital ID is required');
    }

    if (!dto.encounterType) {
      throw new BadRequestException('Encounter type is required');
    }

    const allowedTypes: EncounterType[] = [
      'outpatient',
      'emergency',
      'inpatient',
      'day-case',
      'laboratory-only',
      'radiology-only',
      'procedure',
      'diagnostic',
    ];

    if (!allowedTypes.includes(dto.encounterType)) {
      throw new BadRequestException('Invalid encounter type');
    }

    dto.department = dto.department?.trim();
    dto.practitionerId = dto.practitionerId?.trim();
    dto.practitionerName = dto.practitionerName?.trim();
    dto.reason = dto.reason?.trim();
    dto.referralReference = dto.referralReference?.trim();

    if (!dto.department) {
      throw new BadRequestException('Department is required');
    }
    if (!dto.reason || dto.reason.length < 3 || dto.reason.length > 500) {
      throw new BadRequestException(
        'Reason for visit must contain 3 to 500 characters',
      );
    }
    const allowedPriorities: EncounterPriority[] = [
      'routine',
      'urgent',
      'emergency',
    ];
    if (!allowedPriorities.includes(dto.priority)) {
      throw new BadRequestException('Invalid encounter priority');
    }
    const allowedArrivalModes: ArrivalMode[] = [
      'walk-in',
      'appointment',
      'referral',
      'ambulance',
    ];
    if (!allowedArrivalModes.includes(dto.arrivalMode)) {
      throw new BadRequestException('Invalid arrival mode');
    }
    if (dto.arrivalMode === 'referral' && !dto.referralReference) {
      throw new BadRequestException(
        'Referral reference is required for referred patients',
      );
    }
    if (!dto.registrationConfirmed) {
      throw new BadRequestException(
        'Encounter registration confirmation is required',
      );
    }
    if (
      dto.financialClass &&
      !['cash', 'insurance', 'corporate', 'government'].includes(
        dto.financialClass,
      )
    ) {
      throw new BadRequestException('Invalid financial class');
    }

    // ===================================================
    // Verify patient
    // ===================================================

    let patient: Patient;

    try {
      patient = await medplum.readResource('Patient', dto.patientId);
    } catch {
      throw new NotFoundException('Patient not found');
    }

    // ===================================================
    // Verify patient belongs to hospital
    // ===================================================

    const expectedHospitalReference = `Organization/${dto.hospitalId}`;

    if (patient.managingOrganization?.reference !== expectedHospitalReference) {
      throw new BadRequestException(
        'Patient does not belong to the selected hospital',
      );
    }

    const existingEncounters = await medplum.searchResources('Encounter', {
      subject: `Patient/${dto.patientId}`,
      _count: '20',
    });
    const activeEncounter = existingEncounters.find(
      (item) =>
        ['planned', 'arrived', 'triaged', 'in-progress', 'onleave'].includes(
          item.status,
        ) && item.serviceProvider?.reference === expectedHospitalReference,
    );
    if (activeEncounter) {
      throw new ConflictException({
        message: 'Patient already has an active encounter in this hospital',
        code: 'ACTIVE_ENCOUNTER_EXISTS',
        encounterId: activeEncounter.id,
      });
    }

    // ===================================================
    // Start date
    // ===================================================

    let startDateTime: string;

    try {
      startDateTime = dto.startDateTime
        ? new Date(dto.startDateTime).toISOString()
        : new Date().toISOString();
    } catch {
      throw new BadRequestException('Invalid encounter start date');
    }

    // ===================================================
    // Build encounter
    // ===================================================

    const encounter: Encounter = {
      resourceType: 'Encounter',

      status: 'in-progress',

      identifier: [
        {
          use: 'official',
          system: `https://hospital-ehr.local/encounter/${dto.hospitalId}`,
          value: `VIS-${new Date().getUTCFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`,
          assigner: { reference: `Organization/${dto.hospitalId}` },
        },
      ],

      class: this.getEncounterClass(dto.encounterType),

      type: [this.getEncounterType(dto.encounterType)],

      subject: {
        reference: `Patient/${dto.patientId}`,
        display:
          patient.name?.find((name) => name.use === 'official')?.text ??
          patient.name?.[0]?.text,
      },

      serviceProvider: {
        reference: `Organization/${dto.hospitalId}`,
      },

      period: {
        start: startDateTime,
      },

      priority: {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/v3-ActPriority',
            code:
              dto.priority === 'emergency'
                ? 'EM'
                : dto.priority === 'urgent'
                  ? 'UR'
                  : 'R',
            display: dto.priority,
          },
        ],
        text: dto.priority,
      },
    };

    if (dto.appointmentId) {
      encounter.appointment = [
        { reference: `Appointment/${dto.appointmentId}` },
      ];
    }

    // ===================================================
    // Practitioner
    // ===================================================

    if (dto.practitionerId) {
      encounter.participant = [
        {
          individual: {
            reference: `Practitioner/${dto.practitionerId}`,

            display: dto.practitionerName,
          },
        },
      ];
    } else if (dto.practitionerName) {
      encounter.participant = [
        {
          individual: {
            display: dto.practitionerName,
          },
        },
      ];
    }

    // ===================================================
    // Reason
    // ===================================================

    if (dto.reason) {
      encounter.reasonCode = [
        {
          text: dto.reason,
        },
      ];
    }

    // ===================================================
    // Department
    // ===================================================

    if (dto.department) {
      encounter.extension = [
        {
          url: 'https://hospital-ehr.local/fhir/StructureDefinition/encounter-department',

          valueString: dto.department,
        },
        {
          url: 'https://hospital-ehr.local/fhir/StructureDefinition/encounter-arrival-mode',
          valueCode: dto.arrivalMode,
        },
        {
          url: 'https://hospital-ehr.local/fhir/StructureDefinition/financial-clearance-status',
          valueCode:
            dto.encounterType === 'emergency'
              ? 'emergency-override'
              : dto.financialClass === 'cash'
                ? 'cleared'
                : dto.financialClass === 'insurance'
                  ? 'pending-eligibility'
                  // Corporate/government clear once the sponsor is recorded by classification.
                  : 'pending-classification',
        },
        ...(dto.financialClass
          ? [
              {
                url: 'https://hospital-ehr.local/fhir/StructureDefinition/encounter-financial-class',
                valueCode: dto.financialClass,
              },
            ]
          : []),
        ...(dto.referralReference
          ? [
              {
                url: 'https://hospital-ehr.local/fhir/StructureDefinition/referral-reference',
                valueString: dto.referralReference,
              },
            ]
          : []),
      ];
    }

    // ===================================================
    // Save encounter
    // ===================================================

    const created = await medplum.createResource<Encounter>(encounter);

    return this.mapEncounter(created);
  }

  // =====================================================
  // GET PATIENT ENCOUNTERS
  // =====================================================

  async findByPatient(patientId: string, hospitalId?: string) {
    if (!patientId) {
      throw new BadRequestException('Patient ID is required');
    }

    if (!hospitalId) {
      throw new BadRequestException('Hospital ID is required');
    }

    const medplum = this.medplumService.getClient();

    const searchResult = await medplum.searchResources('Encounter', {
      subject: `Patient/${patientId}`,

      _count: '100',
    });

    // Important:
    // Medplum returns ResourceArray<WithId<Encounter>>
    // We convert it to a normal Encounter[] so Array.filter()
    // and Array.sort() work without the bundle typing issue.

    const encounters: Encounter[] = [...searchResult];

    let filtered: Encounter[] = encounters;

    // ===================================================
    // Filter by hospital
    // ===================================================

    if (hospitalId) {
      const hospitalReference = `Organization/${hospitalId}`;

      filtered = encounters.filter(
        (encounter) =>
          encounter.serviceProvider?.reference === hospitalReference,
      );
    }

    // ===================================================
    // Sort newest first
    // ===================================================

    filtered.sort((a, b) => {
      const aDate = a.period?.start ? new Date(a.period.start).getTime() : 0;

      const bDate = b.period?.start ? new Date(b.period.start).getTime() : 0;

      return bDate - aDate;
    });

    // ===================================================
    // Return list
    // ===================================================

    return {
      total: filtered.length,

      encounters: filtered.map((encounter) => this.mapEncounter(encounter)),
    };
  }

  // =====================================================
  // GET ENCOUNTER BY ID
  // =====================================================

  async findById(encounterId: string, hospitalId: string) {
    if (!encounterId) {
      throw new BadRequestException('Encounter ID is required');
    }

    if (!hospitalId) {
      throw new BadRequestException('Hospital ID is required');
    }

    const medplum = this.medplumService.getClient();

    let encounter: Encounter;

    try {
      encounter = await medplum.readResource('Encounter', encounterId);
    } catch {
      throw new NotFoundException('Encounter not found');
    }

    this.assertEncounterHospital(encounter, hospitalId);

    return this.mapEncounter(encounter);
  }

  // =====================================================
  // FINISH ENCOUNTER
  // =====================================================

  async finish(encounterId: string, dto: FinishEncounterDto) {
    if (!encounterId) {
      throw new BadRequestException('Encounter ID is required');
    }

    if (!dto.hospitalId) {
      throw new BadRequestException('Hospital ID is required');
    }

    const dispositions = [
      'home',
      'admit',
      'icu',
      'operating-room',
      'transfer',
      'referred',
      'left-against-advice',
      'left-without-being-seen',
      'deceased',
    ];
    const conditions = ['stable', 'improved', 'unchanged', 'deteriorated'];
    if (!dispositions.includes(dto.disposition))
      throw new BadRequestException('Invalid disposition');
    if (!conditions.includes(dto.dischargeCondition))
      throw new BadRequestException('Invalid discharge condition');
    if (!dto.confirmation)
      throw new BadRequestException('Disposition confirmation is required');
    dto.dischargeInstructions = dto.dischargeInstructions?.trim();
    dto.referralDestination = dto.referralDestination?.trim();
    if (
      ![
        'admit',
        'icu',
        'operating-room',
        'deceased',
        'left-without-being-seen',
      ].includes(dto.disposition) &&
      (!dto.dischargeInstructions || dto.dischargeInstructions.length < 10)
    ) {
      throw new BadRequestException(
        'Discharge instructions must contain at least 10 characters',
      );
    }
    if (
      ['transfer', 'referred'].includes(dto.disposition) &&
      !dto.referralDestination
    ) {
      throw new BadRequestException(
        'Referral or transfer destination is required',
      );
    }
    let followUpDate: string | undefined;
    if (dto.followUpDate) {
      const parsed = new Date(dto.followUpDate);
      if (Number.isNaN(parsed.getTime()) || parsed < new Date())
        throw new BadRequestException('Follow-up date must be in the future');
      followUpDate = parsed.toISOString();
    }

    const medplum = this.medplumService.getClient();

    let encounter: Encounter;

    try {
      encounter = await medplum.readResource('Encounter', encounterId);
    } catch {
      throw new NotFoundException('Encounter not found');
    }

    this.assertEncounterHospital(encounter, dto.hospitalId);

    if (encounter.status === 'finished') {
      return this.mapEncounter(encounter);
    }

    if (encounter.class?.code === 'IMP') {
      throw new ConflictException({
        message:
          'Inpatient encounters must be completed through the discharge workflow',
        code: 'INPATIENT_DISCHARGE_WORKFLOW_REQUIRED',
      });
    }

    const [diagnoses, notes, orders, reports, reviewTasks] = await Promise.all([
      medplum.searchResources('Condition', {
        encounter: `Encounter/${encounterId}`,
        _count: '100',
      }),
      medplum.searchResources('DocumentReference', {
        encounter: `Encounter/${encounterId}`,
        _count: '100',
      }),
      medplum.searchResources('ServiceRequest', {
        encounter: `Encounter/${encounterId}`,
        _count: '100',
      }),
      medplum.searchResources('DiagnosticReport', {
        encounter: `Encounter/${encounterId}`,
        _count: '100',
      }),
      medplum.searchResources('Task', {
        encounter: `Encounter/${encounterId}`,
        _count: '100',
      }),
    ]);
    const hasPrimaryDiagnosis = diagnoses.some((condition) =>
      condition.extension?.some(
        (extension) =>
          extension.url ===
            'https://hospital-ehr.local/fhir/StructureDefinition/diagnosis-rank' &&
          extension.valueCode === 'primary',
      ),
    );
    const lwbs =
      dto.disposition === 'left-without-being-seen' &&
      encounter.class?.code === 'EMER';
    if (!lwbs && !hasPrimaryDiagnosis) {
      throw new ConflictException({
        message: 'A primary encounter diagnosis is required before disposition',
        code: 'PRIMARY_DIAGNOSIS_REQUIRED',
      });
    }
    const hasSignedNote = notes.some((document) => {
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
    });
    if (!lwbs && !hasSignedNote) {
      throw new ConflictException({
        message: 'A signed clinical note is required before disposition',
        code: 'SIGNED_NOTE_REQUIRED',
      });
    }

    const requiresClinicalClosure = [
      'home',
      'referred',
      'left-against-advice',
    ].includes(dto.disposition);
    if (requiresClinicalClosure) {
      const unresolvedStatuses = new Set(['draft', 'active', 'on-hold']);
      const unresolvedOrders = orders.filter((order) =>
        unresolvedStatuses.has(order.status ?? ''),
      );
      if (unresolvedOrders.length > 0) {
        throw new ConflictException({
          message: 'Pending clinical orders must be resolved before discharge',
          code: 'PENDING_CLINICAL_ORDERS',
          orderIds: unresolvedOrders.map((order) => order.id).filter(Boolean),
        });
      }

      const finalReportStatuses = new Set([
        'final',
        'amended',
        'corrected',
        'appended',
      ]);
      const unreviewedReports = reports.filter((report) => {
        if (!report.id || !finalReportStatuses.has(report.status ?? ''))
          return false;
        const reportReference = `DiagnosticReport/${report.id}`;
        return !reviewTasks.some(
          (task) =>
            task.status === 'completed' &&
            task.code?.coding?.some(
              (coding) => coding.code === 'result-review',
            ) &&
            task.focus?.reference === reportReference,
        );
      });
      if (unreviewedReports.length > 0) {
        throw new ConflictException({
          message:
            'All final diagnostic results must be reviewed before discharge',
          code: 'UNREVIEWED_RESULTS',
          reportIds: unreviewedReports
            .map((report) => report.id)
            .filter(Boolean),
        });
      }
    }

    encounter.status = 'finished';

    const dischargeTime = new Date().toISOString();
    encounter.location = encounter.location?.map((location) =>
      location.status === 'active'
        ? {
            ...location,
            status: 'completed',
            period: { ...location.period, end: dischargeTime },
          }
        : location,
    );

    encounter.hospitalization = {
      ...encounter.hospitalization,
      dischargeDisposition: {
        coding: [
          {
            system:
              'https://hospital-ehr.local/CodeSystem/discharge-disposition',
            code: dto.disposition,
            display: dto.disposition,
          },
        ],
        text: dto.disposition,
      },
    };

    encounter.extension = [
      ...(encounter.extension ?? []),
      {
        url: 'https://hospital-ehr.local/fhir/StructureDefinition/discharge-condition',
        valueCode: dto.dischargeCondition,
      },
      ...(dto.dischargeInstructions
        ? [
            {
              url: 'https://hospital-ehr.local/fhir/StructureDefinition/discharge-instructions',
              valueString: dto.dischargeInstructions,
            },
          ]
        : []),
      ...(followUpDate
        ? [
            {
              url: 'https://hospital-ehr.local/fhir/StructureDefinition/follow-up-date',
              valueDateTime: followUpDate,
            },
          ]
        : []),
      ...(dto.referralDestination
        ? [
            {
              url: 'https://hospital-ehr.local/fhir/StructureDefinition/referral-destination',
              valueString: dto.referralDestination,
            },
          ]
        : []),
    ];

    encounter.period = {
      ...encounter.period,

      end: dischargeTime,
    };

    const updated = await medplum.updateResource<Encounter>(encounter);

    for (const appointmentReference of updated.appointment ?? []) {
      const appointmentId = appointmentReference.reference?.replace(
        'Appointment/',
        '',
      );
      if (!appointmentId) continue;
      try {
        const appointment = await medplum.readResource(
          'Appointment',
          appointmentId,
        );
        if (
          appointment.status === 'arrived' ||
          appointment.status === 'booked'
        ) {
          appointment.status = 'fulfilled';
          await medplum.updateResource(appointment);
        }
      } catch {
        // Encounter disposition remains authoritative if a legacy appointment is unavailable.
      }
    }

    return this.mapEncounter(updated);
  }

  async emergencyQuickArrival(dto: EmergencyQuickArrivalDto) {
    if (
      !dto.hospitalId ||
      !dto.hospitalCode?.trim() ||
      !dto.chiefComplaint?.trim()
    )
      throw new BadRequestException(
        'Hospital, hospital code and chief complaint are required',
      );
    if (
      !['walk-in', 'ambulance'].includes(dto.arrivalMode) ||
      !['routine', 'urgent', 'emergency'].includes(dto.priority)
    )
      throw new BadRequestException('Invalid emergency arrival details');
    const medplum = this.medplumService.getClient();
    try {
      await medplum.readResource('Organization', dto.hospitalId);
    } catch {
      throw new NotFoundException('Hospital not found');
    }
    const token = randomUUID().slice(0, 8).toUpperCase();
    const patient: Patient = {
      resourceType: 'Patient',
      active: true,
      identifier: [
        {
          use: 'temp',
          system: `https://hospital-ehr.local/mrn/${dto.hospitalCode.trim().toUpperCase()}`,
          value: `ED-TEMP-${token}`,
          assigner: { reference: `Organization/${dto.hospitalId}` },
        },
      ],
      name: [
        {
          use: 'temp',
          text:
            dto.temporaryName?.trim() ||
            `Unidentified Emergency Patient ${token}`,
          family: dto.temporaryName?.trim() || `Unknown-${token}`,
        },
      ],
      gender: dto.gender ?? 'unknown',
      birthDate: dto.approximateBirthDate,
      managingOrganization: { reference: `Organization/${dto.hospitalId}` },
      extension: [
        {
          url: 'https://hospital-ehr.local/fhir/StructureDefinition/registration-status',
          valueCode: 'emergency-incomplete',
        },
        {
          url: 'https://hospital-ehr.local/fhir/StructureDefinition/identity-verification-status',
          valueCode: 'unverified',
        },
      ],
    };
    const createdPatient = await medplum.createResource<Patient>(patient);
    const encounter = await this.create({
      patientId: createdPatient.id!,
      hospitalId: dto.hospitalId,
      encounterType: 'emergency',
      department: 'Emergency Department',
      reason: dto.chiefComplaint.trim(),
      priority: dto.priority,
      arrivalMode: dto.arrivalMode,
      practitionerId: dto.practitionerId,
      practitionerName: dto.practitionerName,
      registrationConfirmed: true,
    });
    return {
      emergencyRegistration: 'incomplete',
      identityVerification: 'unverified',
      insuranceRequired: false,
      patient: {
        id: createdPatient.id,
        temporaryMrn: createdPatient.identifier?.[0]?.value,
        name: createdPatient.name?.[0]?.text,
      },
      encounter,
    };
  }

  async assignEmergencyBed(encounterId: string, dto: AssignEmergencyBedDto) {
    if (!dto.hospitalId || !dto.bedName?.trim())
      throw new BadRequestException('Hospital and ED bed are required');
    const medplum = this.medplumService.getClient();
    let encounter: Encounter;
    try {
      encounter = await medplum.readResource('Encounter', encounterId);
    } catch {
      throw new NotFoundException('Emergency encounter not found');
    }
    if (
      encounter.serviceProvider?.reference !==
        `Organization/${dto.hospitalId}` ||
      encounter.class?.code !== 'EMER'
    )
      throw new NotFoundException('Emergency encounter not found');
    const now = new Date().toISOString();
    encounter.location = [
      ...(encounter.location ?? []).map((item) =>
        item.status === 'active'
          ? {
              ...item,
              status: 'completed' as const,
              period: { ...item.period, end: now },
            }
          : item,
      ),
      {
        location: dto.bedId
          ? { reference: `Location/${dto.bedId}`, display: dto.bedName.trim() }
          : { display: dto.bedName.trim() },
        status: 'active',
        period: { start: now },
      },
    ];
    const saved = await medplum.updateResource<Encounter>(encounter);
    return {
      encounterId: saved.id,
      bedId: dto.bedId,
      bedName: dto.bedName.trim(),
      assignedAt: now,
    };
  }

  async reassessEmergency(encounterId: string, dto: EmergencyReassessmentDto) {
    if (!dto.hospitalId || !dto.clinicianName?.trim() || !dto.note?.trim())
      throw new BadRequestException(
        'Hospital, clinician and reassessment note are required',
      );
    if (
      ![1, 2, 3, 4, 5].includes(dto.severity) ||
      !['improved', 'unchanged', 'deteriorated', 'critical'].includes(
        dto.clinicalStatus,
      )
    )
      throw new BadRequestException('Invalid emergency reassessment');
    const medplum = this.medplumService.getClient();
    let encounter: Encounter;
    try {
      encounter = await medplum.readResource('Encounter', encounterId);
    } catch {
      throw new NotFoundException('Emergency encounter not found');
    }
    if (
      encounter.serviceProvider?.reference !==
        `Organization/${dto.hospitalId}` ||
      encounter.class?.code !== 'EMER'
    )
      throw new NotFoundException('Emergency encounter not found');
    const effectiveDateTime = dto.reassessedAt
      ? new Date(dto.reassessedAt).toISOString()
      : new Date().toISOString();
    const observation: Observation = {
      resourceType: 'Observation',
      status: 'final',
      category: [
        {
          coding: [
            {
              system:
                'https://hospital-ehr.local/CodeSystem/observation-category',
              code: 'emergency-reassessment',
            },
          ],
        },
      ],
      code: {
        coding: [
          {
            system: 'http://loinc.org',
            code: '11283-9',
            display: 'Acuity assessment',
          },
        ],
        text: 'Emergency reassessment',
      },
      subject: encounter.subject!,
      encounter: { reference: `Encounter/${encounterId}` },
      effectiveDateTime,
      performer: [
        dto.clinicianId
          ? {
              reference: `Practitioner/${dto.clinicianId}`,
              display: dto.clinicianName.trim(),
            }
          : { display: dto.clinicianName.trim() },
      ],
      valueInteger: dto.severity,
      interpretation: [{ text: dto.clinicalStatus }],
      note: [{ text: dto.note.trim() }],
      extension: [
        {
          url: 'https://hospital-ehr.local/fhir/StructureDefinition/hospital',
          valueReference: { reference: `Organization/${dto.hospitalId}` },
        },
      ],
    };
    const created = await medplum.createResource<Observation>(observation);
    encounter.priority = {
      coding: [
        {
          system: 'http://terminology.hl7.org/CodeSystem/v3-ActPriority',
          code: dto.severity <= 2 ? 'EM' : dto.severity === 3 ? 'UR' : 'R',
        },
      ],
      text: `Emergency severity ${dto.severity}`,
    };
    await medplum.updateResource(encounter);
    return {
      id: created.id,
      encounterId,
      severity: dto.severity,
      clinicalStatus: dto.clinicalStatus,
      note: dto.note.trim(),
      clinicianName: dto.clinicianName.trim(),
      effectiveDateTime,
    };
  }

  // =====================================================
  // ENCOUNTER CLASS
  // =====================================================

  private getEncounterClass(encounterType: EncounterType) {
    switch (encounterType) {
      case 'emergency':
        return {
          system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode',

          code: 'EMER',

          display: 'Emergency',
        };

      case 'inpatient':
        return {
          system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode',

          code: 'IMP',

          display: 'Inpatient Encounter',
        };

      case 'day-case':
        return {
          system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode',
          code: 'SS',
          display: 'Short Stay',
        };

      case 'diagnostic':
      case 'laboratory-only':
      case 'radiology-only':
      case 'procedure':
        return {
          system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode',
          code: 'AMB',
          display: 'Diagnostic / Procedure Visit',
        };

      case 'outpatient':
      default:
        return {
          system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode',

          code: 'AMB',

          display: 'Ambulatory',
        };
    }
  }

  async listEmergency(hospitalId: string, status?: string) {
    if (!hospitalId) throw new BadRequestException('Hospital ID is required');
    const medplum = this.medplumService.getClient();
    const resources = await medplum.searchResources('Encounter', {
      _count: '500',
    });
    const allowedStatus =
      status && status !== 'all' ? status.split(',') : undefined;
    const encounters = resources
      .filter(
        (encounter) =>
          encounter.serviceProvider?.reference ===
            `Organization/${hospitalId}` &&
          encounter.class?.code === 'EMER' &&
          (!allowedStatus || allowedStatus.includes(encounter.status)),
      )
      .sort((a, b) =>
        (a.period?.start ?? '').localeCompare(b.period?.start ?? ''),
      );

    const mapped = await Promise.all(
      encounters.map(async (encounter) => {
        let patientName = encounter.subject?.display;
        const patientId = encounter.subject?.reference?.replace('Patient/', '');
        if (!patientName && patientId) {
          try {
            const patient = await medplum.readResource('Patient', patientId);
            patientName =
              patient.name?.find((name) => name.use === 'official')?.text ??
              patient.name?.[0]?.text;
          } catch {
            patientName = undefined;
          }
        }
        return { ...this.mapEncounter(encounter), patientName };
      }),
    );
    return { total: mapped.length, encounters: mapped };
  }

  private assertEncounterHospital(
    encounter: Encounter,
    hospitalId: string,
  ): void {
    if (encounter.serviceProvider?.reference !== `Organization/${hospitalId}`) {
      throw new NotFoundException('Encounter not found');
    }
  }

  // =====================================================
  // ENCOUNTER TYPE
  // =====================================================

  private getEncounterType(encounterType: EncounterType) {
    switch (encounterType) {
      case 'emergency':
        return {
          coding: [
            {
              system: 'https://hospital-ehr.local/CodeSystem/encounter-type',

              code: 'emergency',

              display: 'Emergency',
            },
          ],

          text: 'Emergency',
        };

      case 'inpatient':
        return {
          coding: [
            {
              system: 'https://hospital-ehr.local/CodeSystem/encounter-type',

              code: 'inpatient',

              display: 'Inpatient',
            },
          ],

          text: 'Inpatient',
        };

      case 'day-case':
        return {
          coding: [
            {
              system: 'https://hospital-ehr.local/CodeSystem/encounter-type',
              code: 'day-case',
              display: 'Day Case',
            },
          ],
          text: 'Day Case',
        };

      case 'diagnostic':
        return {
          coding: [
            {
              system: 'https://hospital-ehr.local/CodeSystem/encounter-type',
              code: 'diagnostic',
              display: 'Procedure / Diagnostic Visit',
            },
          ],
          text: 'Procedure / Diagnostic Visit',
        };

      case 'laboratory-only':
        return {
          coding: [
            {
              system: 'https://hospital-ehr.local/CodeSystem/encounter-type',
              code: 'laboratory-only',
              display: 'Laboratory-only Visit',
            },
          ],
          text: 'Laboratory-only Visit',
        };

      case 'radiology-only':
        return {
          coding: [
            {
              system: 'https://hospital-ehr.local/CodeSystem/encounter-type',
              code: 'radiology-only',
              display: 'Radiology-only Visit',
            },
          ],
          text: 'Radiology-only Visit',
        };

      case 'procedure':
        return {
          coding: [
            {
              system: 'https://hospital-ehr.local/CodeSystem/encounter-type',
              code: 'procedure',
              display: 'Procedure Visit',
            },
          ],
          text: 'Procedure Visit',
        };

      case 'outpatient':
      default:
        return {
          coding: [
            {
              system: 'https://hospital-ehr.local/CodeSystem/encounter-type',

              code: 'outpatient',

              display: 'Outpatient',
            },
          ],

          text: 'Outpatient',
        };
    }
  }

  // =====================================================
  // MAP FHIR ENCOUNTER
  // =====================================================

  private mapEncounter(encounter: Encounter) {
    const department = encounter.extension?.find(
      (extension) =>
        extension.url ===
        'https://hospital-ehr.local/fhir/StructureDefinition/encounter-department',
    )?.valueString;

    const arrivalMode = encounter.extension?.find(
      (extension) =>
        extension.url ===
        'https://hospital-ehr.local/fhir/StructureDefinition/encounter-arrival-mode',
    )?.valueCode;

    const referralReference = encounter.extension?.find(
      (extension) =>
        extension.url ===
        'https://hospital-ehr.local/fhir/StructureDefinition/referral-reference',
    )?.valueString;

    const extensionValue = (url: string) =>
      encounter.extension?.find((extension) => extension.url === url);

    const typeCode = encounter.type?.[0]?.coding?.[0]?.code;

    const typeDisplay =
      encounter.type?.[0]?.coding?.[0]?.display ?? encounter.type?.[0]?.text;

    const patientId = encounter.subject?.reference?.replace('Patient/', '');

    const hospitalId = encounter.serviceProvider?.reference?.replace(
      'Organization/',
      '',
    );

    const practitioner = encounter.participant?.[0]?.individual;

    return {
      id: encounter.id,

      resourceType: encounter.resourceType,

      status: encounter.status,

      encounterType: typeCode,

      encounterTypeDisplay: typeDisplay,

      classCode: encounter.class?.code,

      classDisplay: encounter.class?.display,

      patientId,

      hospitalId,

      department,

      visitNumber: encounter.identifier?.[0]?.value,

      priority:
        encounter.priority?.text ?? encounter.priority?.coding?.[0]?.display,

      arrivalMode,

      referralReference,

      appointmentId: encounter.appointment?.[0]?.reference?.replace(
        'Appointment/',
        '',
      ),

      financialClearanceStatus: extensionValue(
        'https://hospital-ehr.local/fhir/StructureDefinition/financial-clearance-status',
      )?.valueCode,

      financialClass: extensionValue(
        'https://hospital-ehr.local/fhir/StructureDefinition/encounter-financial-class',
      )?.valueCode,

      coverageId: extensionValue(
        'https://hospital-ehr.local/fhir/StructureDefinition/encounter-coverage',
      )?.valueReference?.reference?.replace('Coverage/', ''),

      emergencyBedId: encounter.location
        ?.find((item) => item.status === 'active')
        ?.location.reference?.replace('Location/', ''),

      emergencyBedName: encounter.location?.find(
        (item) => item.status === 'active',
      )?.location.display,

      disposition:
        encounter.hospitalization?.dischargeDisposition?.coding?.[0]?.code,

      dischargeCondition: extensionValue(
        'https://hospital-ehr.local/fhir/StructureDefinition/discharge-condition',
      )?.valueCode,

      dischargeInstructions: extensionValue(
        'https://hospital-ehr.local/fhir/StructureDefinition/discharge-instructions',
      )?.valueString,

      followUpDate: extensionValue(
        'https://hospital-ehr.local/fhir/StructureDefinition/follow-up-date',
      )?.valueDateTime,

      referralDestination: extensionValue(
        'https://hospital-ehr.local/fhir/StructureDefinition/referral-destination',
      )?.valueString,

      practitionerId: practitioner?.reference?.replace('Practitioner/', ''),

      practitionerName: practitioner?.display,

      reason: encounter.reasonCode?.[0]?.text,

      startDateTime: encounter.period?.start,

      endDateTime: encounter.period?.end,
    };
  }
}
