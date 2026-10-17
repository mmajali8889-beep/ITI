import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type {
  Encounter,
  Observation,
  Patient,
  Task,
} from '@medplum/fhirtypes';

import {
  MedplumService,
} from '../medplum/medplum.service';

import {
  CreateVitalsDto,
} from './dto/create-vitals.dto';

@Injectable()
export class VitalsService {
  constructor(
    private readonly medplumService:
      MedplumService,
  ) {}

  // =====================================================
  // CREATE VITAL SIGNS
  // =====================================================

  async create(
    dto: CreateVitalsDto,
  ) {
    const medplum =
      this.medplumService.getClient();

    // ===================================================
    // VALIDATION
    // ===================================================

    if (!dto.patientId) {
      throw new BadRequestException(
        'Patient ID is required',
      );
    }

    if (!dto.encounterId) {
      throw new BadRequestException(
        'Encounter ID is required',
      );
    }

    if (!dto.hospitalId) {
      throw new BadRequestException(
        'Hospital ID is required',
      );
    }

    // ===================================================
    // VERIFY PATIENT
    // ===================================================

    let patient: Patient;

    try {
      patient =
        await medplum.readResource(
          'Patient',
          dto.patientId,
        );
    } catch {
      throw new NotFoundException(
        'Patient not found',
      );
    }

    // ===================================================
    // VERIFY ENCOUNTER
    // ===================================================

    let encounter: Encounter;

    try {
      encounter =
        await medplum.readResource(
          'Encounter',
          dto.encounterId,
        );
    } catch {
      throw new NotFoundException(
        'Encounter not found',
      );
    }

    // ===================================================
    // VERIFY ENCOUNTER -> PATIENT
    // ===================================================

    if (
      encounter.subject
        ?.reference !==
      `Patient/${dto.patientId}`
    ) {
      throw new BadRequestException(
        'Encounter does not belong to this patient',
      );
    }

    // ===================================================
    // VERIFY ENCOUNTER -> HOSPITAL
    // ===================================================

    if (
      encounter.serviceProvider
        ?.reference !==
      `Organization/${dto.hospitalId}`
    ) {
      throw new BadRequestException(
        'Encounter does not belong to the selected hospital',
      );
    }

    // ===================================================
    // EFFECTIVE DATE/TIME
    // ===================================================

    let effectiveDateTime:
      string;

    try {
      effectiveDateTime =
        dto.effectiveDateTime
          ? new Date(
              dto.effectiveDateTime,
            ).toISOString()
          : new Date().toISOString();
    } catch {
      throw new BadRequestException(
        'Invalid effective date/time',
      );
    }

    // ===================================================
    // VALIDATE VITAL VALUES
    // ===================================================

    this.validateVitals(
      dto,
    );

    if (![1, 2, 3, 4, 5].includes(dto.triageLevel)) {
      throw new BadRequestException('Triage level must be between 1 and 5');
    }
    dto.chiefComplaint = dto.chiefComplaint?.trim();
    dto.triageNotes = dto.triageNotes?.trim();
    if (!dto.chiefComplaint || dto.chiefComplaint.length < 3 || dto.chiefComplaint.length > 500) {
      throw new BadRequestException('Chief complaint must contain 3 to 500 characters');
    }
    if (!dto.triageConfirmed) {
      throw new BadRequestException('Triage confirmation is required');
    }
    if (!['reviewed-no-known', 'reviewed-known', 'unable'].includes(dto.allergyCheck)) {
      throw new BadRequestException('Allergy check is required');
    }
    if (!['reviewed', 'unavailable'].includes(dto.medicationHistory)) {
      throw new BadRequestException('Medication history review is required');
    }
    const allowedRiskFlags = ['fall', 'sepsis', 'suicide', 'violence', 'infection', 'deterioration', 'other'];
    if (dto.riskFlags?.some((flag) => !allowedRiskFlags.includes(flag))) {
      throw new BadRequestException('Invalid risk assessment flag');
    }
    dto.currentMedications = dto.currentMedications?.trim();
    dto.riskAssessmentNotes = dto.riskAssessmentNotes?.trim();

    // ===================================================
    // BUILD OBSERVATIONS
    // ===================================================

    const observations:
      Observation[] = [];

    // ===================================================
    // BLOOD PRESSURE
    // LOINC 85354-9
    // ===================================================

    if (
      dto.systolic !==
        undefined ||
      dto.diastolic !==
        undefined
    ) {
      if (
        dto.systolic ===
          undefined ||
        dto.diastolic ===
          undefined
      ) {
        throw new BadRequestException(
          'Both systolic and diastolic blood pressure values are required',
        );
      }

      observations.push({
        resourceType:
          'Observation',

        status:
          'final',

        category: [
          {
            coding: [
              {
                system:
                  'http://terminology.hl7.org/CodeSystem/observation-category',

                code:
                  'vital-signs',

                display:
                  'Vital Signs',
              },
            ],

            text:
              'Vital Signs',
          },
        ],

        code: {
          coding: [
            {
              system:
                'http://loinc.org',

              code:
                '85354-9',

              display:
                'Blood pressure panel',
            },
          ],

          text:
            'Blood Pressure',
        },

        subject: {
          reference:
            `Patient/${dto.patientId}`,
        },

        encounter: {
          reference:
            `Encounter/${dto.encounterId}`,
        },

        effectiveDateTime,

        performer: [
          {
            reference:
              `Organization/${dto.hospitalId}`,
          },
        ],

        component: [
          {
            code: {
              coding: [
                {
                  system:
                    'http://loinc.org',

                  code:
                    '8480-6',

                  display:
                    'Systolic blood pressure',
                },
              ],

              text:
                'Systolic Blood Pressure',
            },

            valueQuantity: {
              value:
                dto.systolic,

              unit:
                'mmHg',

              system:
                'http://unitsofmeasure.org',

              code:
                'mm[Hg]',
            },
          },

          {
            code: {
              coding: [
                {
                  system:
                    'http://loinc.org',

                  code:
                    '8462-4',

                  display:
                    'Diastolic blood pressure',
                },
              ],

              text:
                'Diastolic Blood Pressure',
            },

            valueQuantity: {
              value:
                dto.diastolic,

              unit:
                'mmHg',

              system:
                'http://unitsofmeasure.org',

              code:
                'mm[Hg]',
            },
          },
        ],
      });
    }

    // ===================================================
    // HEART RATE
    // LOINC 8867-4
    // ===================================================

    if (
      dto.pulse !==
      undefined
    ) {
      observations.push(
        this.createQuantityObservation(
          {
            patientId:
              dto.patientId,

            encounterId:
              dto.encounterId,

            hospitalId:
              dto.hospitalId,

            effectiveDateTime,

            code:
              '8867-4',

            display:
              'Heart rate',

            text:
              'Pulse',

            value:
              dto.pulse,

            unit:
              'beats/min',

            ucumCode:
              '/min',
          },
        ),
      );
    }

    // ===================================================
    // TEMPERATURE
    // LOINC 8310-5
    // ===================================================

    if (
      dto.temperature !==
      undefined
    ) {
      observations.push(
        this.createQuantityObservation(
          {
            patientId:
              dto.patientId,

            encounterId:
              dto.encounterId,

            hospitalId:
              dto.hospitalId,

            effectiveDateTime,

            code:
              '8310-5',

            display:
              'Body temperature',

            text:
              'Temperature',

            value:
              dto.temperature,

            unit:
              '°C',

            ucumCode:
              'Cel',
          },
        ),
      );
    }

    // ===================================================
    // RESPIRATORY RATE
    // LOINC 9279-1
    // ===================================================

    if (
      dto.respiratoryRate !==
      undefined
    ) {
      observations.push(
        this.createQuantityObservation(
          {
            patientId:
              dto.patientId,

            encounterId:
              dto.encounterId,

            hospitalId:
              dto.hospitalId,

            effectiveDateTime,

            code:
              '9279-1',

            display:
              'Respiratory rate',

            text:
              'Respiratory Rate',

            value:
              dto.respiratoryRate,

            unit:
              'breaths/min',

            ucumCode:
              '/min',
          },
        ),
      );
    }

    // ===================================================
    // OXYGEN SATURATION
    // LOINC 59408-5
    // ===================================================

    if (
      dto.spo2 !==
      undefined
    ) {
      observations.push(
        this.createQuantityObservation(
          {
            patientId:
              dto.patientId,

            encounterId:
              dto.encounterId,

            hospitalId:
              dto.hospitalId,

            effectiveDateTime,

            code:
              '59408-5',

            display:
              'Oxygen saturation in arterial blood by pulse oximetry',

            text:
              'SpO2',

            value:
              dto.spo2,

            unit:
              '%',

            ucumCode:
              '%',
          },
        ),
      );
    }

    // ===================================================
    // BODY WEIGHT
    // LOINC 29463-7
    // ===================================================

    if (
      dto.weight !==
      undefined
    ) {
      observations.push(
        this.createQuantityObservation(
          {
            patientId:
              dto.patientId,

            encounterId:
              dto.encounterId,

            hospitalId:
              dto.hospitalId,

            effectiveDateTime,

            code:
              '29463-7',

            display:
              'Body weight',

            text:
              'Weight',

            value:
              dto.weight,

            unit:
              'kg',

            ucumCode:
              'kg',
          },
        ),
      );
    }

    // ===================================================
    // BODY HEIGHT
    // LOINC 8302-2
    // ===================================================

    if (
      dto.height !==
      undefined
    ) {
      observations.push(
        this.createQuantityObservation(
          {
            patientId:
              dto.patientId,

            encounterId:
              dto.encounterId,

            hospitalId:
              dto.hospitalId,

            effectiveDateTime,

            code:
              '8302-2',

            display:
              'Body height',

            text:
              'Height',

            value:
              dto.height,

            unit:
              'cm',

            ucumCode:
              'cm',
          },
        ),
      );
    }

    // ===================================================
    // BMI
    // LOINC 39156-5
    // ===================================================

    if (
      dto.weight !==
        undefined &&
      dto.height !==
        undefined &&
      dto.height > 0
    ) {
      const heightMeters =
        dto.height / 100;

      const bmi =
        dto.weight /
        (
          heightMeters *
          heightMeters
        );

      const roundedBmi =
        Number(
          bmi.toFixed(
            1,
          ),
        );

      observations.push(
        this.createQuantityObservation(
          {
            patientId:
              dto.patientId,

            encounterId:
              dto.encounterId,

            hospitalId:
              dto.hospitalId,

            effectiveDateTime,

            code:
              '39156-5',

            display:
              'Body mass index',

            text:
              'BMI',

            value:
              roundedBmi,

            unit:
              'kg/m²',

            ucumCode:
              'kg/m2',
          },
        ),
      );
    }

    // ===================================================
    // PAIN SCORE
    // LOINC 72514-3
    // ===================================================

    if (
      dto.painScore !==
      undefined
    ) {
      observations.push({
        resourceType:
          'Observation',

        status:
          'final',

        category: [
          {
            coding: [
              {
                system:
                  'http://terminology.hl7.org/CodeSystem/observation-category',

                code:
                  'vital-signs',

                display:
                  'Vital Signs',
              },
            ],

            text:
              'Vital Signs',
          },
        ],

        code: {
          coding: [
            {
              system:
                'http://loinc.org',

              code:
                '72514-3',

              display:
                'Pain severity - 0-10 verbal numeric rating',
            },
          ],

          text:
            'Pain Score',
        },

        subject: {
          reference:
            `Patient/${dto.patientId}`,
        },

        encounter: {
          reference:
            `Encounter/${dto.encounterId}`,
        },

        effectiveDateTime,

        performer: [
          {
            reference:
              `Organization/${dto.hospitalId}`,
          },
        ],

        valueInteger:
          dto.painScore,
      });
    }

    // ===================================================
    // AT LEAST ONE VITAL REQUIRED
    // ===================================================

    if (
      observations.length ===
      0
    ) {
      throw new BadRequestException(
        'At least one vital sign is required',
      );
    }

    // ===================================================
    // SAVE OBSERVATIONS
    //
    // Important:
    // Explicit Observation[] prevents TypeScript from
    // inferring never[] for an empty array.
    // ===================================================

    const created:
      Observation[] = [];

    for (
      const observation
      of observations
    ) {
      const result =
        await medplum.createResource<Observation>(
          observation,
        );

      created.push(
        result,
      );
    }

    const alerts = this.detectCriticalAlerts(dto);
    const triageExtensionUrls = new Set([
      'https://hospital-ehr.local/fhir/StructureDefinition/triage-level',
      'https://hospital-ehr.local/fhir/StructureDefinition/chief-complaint',
      'https://hospital-ehr.local/fhir/StructureDefinition/consciousness',
      'https://hospital-ehr.local/fhir/StructureDefinition/mobility',
      'https://hospital-ehr.local/fhir/StructureDefinition/isolation-required',
      'https://hospital-ehr.local/fhir/StructureDefinition/triage-notes',
      'https://hospital-ehr.local/fhir/StructureDefinition/triage-alerts',
      'https://hospital-ehr.local/fhir/StructureDefinition/triage-completed-at',
      'https://hospital-ehr.local/fhir/StructureDefinition/allergy-check',
      'https://hospital-ehr.local/fhir/StructureDefinition/medication-history-review',
      'https://hospital-ehr.local/fhir/StructureDefinition/current-medications',
      'https://hospital-ehr.local/fhir/StructureDefinition/triage-risk-flags',
      'https://hospital-ehr.local/fhir/StructureDefinition/risk-assessment-notes',
    ]);
    encounter.status = 'triaged';
    encounter.priority = {
      coding: [{
        system: 'http://terminology.hl7.org/CodeSystem/v3-ActPriority',
        code: dto.triageLevel <= 2 ? 'EM' : dto.triageLevel === 3 ? 'UR' : 'R',
      }],
      text: `Triage level ${dto.triageLevel}`,
    };
    encounter.extension = [
      ...(encounter.extension ?? []).filter((item) => !triageExtensionUrls.has(item.url)),
      { url: 'https://hospital-ehr.local/fhir/StructureDefinition/triage-level', valueInteger: dto.triageLevel },
      { url: 'https://hospital-ehr.local/fhir/StructureDefinition/chief-complaint', valueString: dto.chiefComplaint },
      { url: 'https://hospital-ehr.local/fhir/StructureDefinition/isolation-required', valueBoolean: dto.isolationRequired ?? false },
      { url: 'https://hospital-ehr.local/fhir/StructureDefinition/triage-completed-at', valueDateTime: effectiveDateTime },
      { url: 'https://hospital-ehr.local/fhir/StructureDefinition/allergy-check', valueCode: dto.allergyCheck },
      { url: 'https://hospital-ehr.local/fhir/StructureDefinition/medication-history-review', valueCode: dto.medicationHistory },
      ...(dto.currentMedications ? [{ url: 'https://hospital-ehr.local/fhir/StructureDefinition/current-medications', valueString: dto.currentMedications }] : []),
      ...(dto.riskFlags?.length ? [{ url: 'https://hospital-ehr.local/fhir/StructureDefinition/triage-risk-flags', valueString: dto.riskFlags.join('|') }] : []),
      ...(dto.riskAssessmentNotes ? [{ url: 'https://hospital-ehr.local/fhir/StructureDefinition/risk-assessment-notes', valueString: dto.riskAssessmentNotes }] : []),
      ...(dto.consciousness ? [{ url: 'https://hospital-ehr.local/fhir/StructureDefinition/consciousness', valueCode: dto.consciousness }] : []),
      ...(dto.mobility ? [{ url: 'https://hospital-ehr.local/fhir/StructureDefinition/mobility', valueCode: dto.mobility }] : []),
      ...(dto.triageNotes ? [{ url: 'https://hospital-ehr.local/fhir/StructureDefinition/triage-notes', valueString: dto.triageNotes }] : []),
      ...(alerts.length ? [{ url: 'https://hospital-ehr.local/fhir/StructureDefinition/triage-alerts', valueString: alerts.join(' | ') }] : []),
    ];
    await medplum.updateResource<Encounter>(encounter);

    const existingQueueTasks = (await medplum.searchResources('Task', {
      encounter: `Encounter/${dto.encounterId}`,
      status: 'ready,in-progress',
      _count: '20',
    })) ?? [];
    let queueTask = existingQueueTasks.find((item) => item.code?.coding?.some((coding) => coding.code === 'doctor-queue'));
    if (!queueTask) {
      const task: Task = {
        resourceType: 'Task',
        status: 'ready',
        intent: 'order',
        priority: dto.triageLevel <= 2 ? 'stat' : dto.triageLevel === 3 ? 'urgent' : 'routine',
        code: { coding: [{ system: 'https://hospital-ehr.local/CodeSystem/workflow-task', code: 'doctor-queue', display: 'Doctor Queue' }], text: 'Doctor assessment queue' },
        for: { reference: `Patient/${dto.patientId}`, display: patient.name?.[0]?.text },
        encounter: { reference: `Encounter/${dto.encounterId}` },
        authoredOn: effectiveDateTime,
        owner: dto.assignedPractitionerId
          ? { reference: `Practitioner/${dto.assignedPractitionerId}`, display: dto.assignedPractitionerName }
          : { reference: `Organization/${dto.hospitalId}` },
        requester: dto.triageNurseId
          ? { reference: `Practitioner/${dto.triageNurseId}`, display: dto.triageNurseName }
          : { reference: `Organization/${dto.hospitalId}` },
        input: [
          { type: { text: 'Triage level' }, valueInteger: dto.triageLevel },
          { type: { text: 'Chief complaint' }, valueString: dto.chiefComplaint },
          ...(dto.riskFlags?.length ? [{ type: { text: 'Risk flags' }, valueString: dto.riskFlags.join('|') }] : []),
        ],
      };
      queueTask = await medplum.createResource<Task>(task);
    }

    // ===================================================
    // RESPONSE
    // ===================================================

    return {
      count:
        created.length,

      effectiveDateTime,

      vitals:
        this.mapVitals(
          created,
        ),

      triage: {
        level: dto.triageLevel,
        critical: alerts.length > 0 || dto.triageLevel === 1,
        alerts,
        allergyCheck: dto.allergyCheck,
        medicationHistory: dto.medicationHistory,
        riskFlags: dto.riskFlags ?? [],
        doctorQueueTaskId: queueTask.id,
        doctorQueueStatus: queueTask.status,
      },
    };
  }

  private detectCriticalAlerts(dto: CreateVitalsDto): string[] {
    const alerts: string[] = [];
    if (dto.systolic !== undefined && (dto.systolic < 80 || dto.systolic >= 180)) alerts.push('Critical systolic blood pressure');
    if (dto.diastolic !== undefined && (dto.diastolic < 50 || dto.diastolic >= 120)) alerts.push('Critical diastolic blood pressure');
    if (dto.pulse !== undefined && (dto.pulse < 40 || dto.pulse > 130)) alerts.push('Critical heart rate');
    if (dto.temperature !== undefined && (dto.temperature < 35 || dto.temperature >= 40)) alerts.push('Critical temperature');
    if (dto.respiratoryRate !== undefined && (dto.respiratoryRate < 8 || dto.respiratoryRate > 30)) alerts.push('Critical respiratory rate');
    if (dto.spo2 !== undefined && dto.spo2 < 90) alerts.push('Critical oxygen saturation');
    if (dto.consciousness && dto.consciousness !== 'alert') alerts.push('Altered level of consciousness');
    return alerts;
  }

  // =====================================================
  // GET VITALS BY ENCOUNTER
  // =====================================================

  async findByEncounter(
  
    encounterId: string,
  ) {
    if (!encounterId) {
      throw new BadRequestException(
        'Encounter ID is required',
      );
    }

    const medplum =
      this.medplumService.getClient();

    const searchResult =
      await medplum.searchResources(
        'Observation',
        {
          encounter:
            `Encounter/${encounterId}`,

          category:
            'vital-signs',

          _count:
            '200',
        },
      );

    // Convert Medplum ResourceArray to normal array.

    const observations:
      Observation[] = [
        ...searchResult,
      ];

    observations.sort(
      (
        a,
        b,
      ) => {
        const aTime =
          this.getObservationTime(
            a,
          );

        const bTime =
          this.getObservationTime(
            b,
          );

        return bTime - aTime;
      },
    );

    return {
      total:
        observations.length,

      vitals:
        this.mapVitals(
          observations,
        ),
    };
  }
    // =====================================================
  // GET VITALS BY PATIENT
  //
  // Returns vital signs from ALL encounters
  // for the selected patient.
  // =====================================================

  async findByPatient(
    patientId: string,
  ) {
    if (!patientId) {
      throw new BadRequestException(
        'Patient ID is required',
      );
    }

    const medplum =
      this.medplumService.getClient();

    // ===================================================
    // VERIFY PATIENT EXISTS
    // ===================================================

    try {
      await medplum.readResource(
        'Patient',
        patientId,
      );
    } catch {
      throw new NotFoundException(
        'Patient not found',
      );
    }

    // ===================================================
    // SEARCH ALL PATIENT VITAL SIGNS
    //
    // FHIR:
    // Observation.subject = Patient/{patientId}
    // category = vital-signs
    // ===================================================

    const searchResult =
      await medplum.searchResources(
        'Observation',
        {
          patient:
            `Patient/${patientId}`,

          category:
            'vital-signs',

          _count:
            '1000',
        },
      );

    // ===================================================
    // MEDPLUM ResourceArray -> Observation[]
    // ===================================================

    const observations:
      Observation[] = [
        ...searchResult,
      ];

    // ===================================================
    // SORT NEWEST -> OLDEST
    // ===================================================

    observations.sort(
      (
        a,
        b,
      ) => {
        const aTime =
          this.getObservationTime(
            a,
          );

        const bTime =
          this.getObservationTime(
            b,
          );

        return bTime - aTime;
      },
    );

    // ===================================================
    // MAP OBSERVATIONS
    //
    // Keep existing response format compatible with
    // Encounter Vitals.
    // ===================================================

    const vitals =
      this.mapVitals(
        observations,
      );

    // ===================================================
    // ADD ENCOUNTER ID
    //
    // Required by Patient Chart so the user can open
    // the encounter where the measurement was recorded.
    // ===================================================

    const mappedVitals =
      vitals.map(
        (
          vital,
          index,
        ) => {
          const observation =
            observations[index];

          const encounterId =
            observation.encounter
              ?.reference
              ?.replace(
                'Encounter/',
                '',
              );

          return {
            ...vital,

            encounterId,
          };
        },
      );

    // ===================================================
    // LATEST VITALS
    //
    // First observation of each type because the array
    // is already sorted newest -> oldest.
    // ===================================================

    const latest:
      Record<
        string,
        (typeof mappedVitals)[number]
      > = {};

    for (
      const vital
      of mappedVitals
    ) {
      if (
        vital.type &&
        !latest[vital.type]
      ) {
        latest[vital.type] =
          vital;
      }
    }

    // ===================================================
    // RESPONSE
    // ===================================================

    return {
      total:
        mappedVitals.length,

      patientId,

      latest,

      vitals:
        mappedVitals,
    };
  }

  // =====================================================
  // CREATE GENERIC QUANTITY OBSERVATION
  // =====================================================

  private createQuantityObservation(
    options: {
      patientId:
        string;

      encounterId:
        string;

      hospitalId:
        string;

      effectiveDateTime:
        string;

      code:
        string;

      display:
        string;

      text:
        string;

      value:
        number;

      unit:
        string;

      ucumCode:
        string;
    },
  ): Observation {
    return {
      resourceType:
        'Observation',

      status:
        'final',

      category: [
        {
          coding: [
            {
              system:
                'http://terminology.hl7.org/CodeSystem/observation-category',

              code:
                'vital-signs',

              display:
                'Vital Signs',
            },
          ],

          text:
            'Vital Signs',
        },
      ],

      code: {
        coding: [
          {
            system:
              'http://loinc.org',

            code:
              options.code,

            display:
              options.display,
          },
        ],

        text:
          options.text,
      },

      subject: {
        reference:
          `Patient/${options.patientId}`,
      },

      encounter: {
        reference:
          `Encounter/${options.encounterId}`,
      },

      effectiveDateTime:
        options.effectiveDateTime,

      performer: [
        {
          reference:
            `Organization/${options.hospitalId}`,
        },
      ],

      valueQuantity: {
        value:
          options.value,

        unit:
          options.unit,

        system:
          'http://unitsofmeasure.org',

        code:
          options.ucumCode,
      },
    };
  }

  // =====================================================
  // MAP OBSERVATIONS
  // =====================================================

  private mapVitals(
    observations:
      Observation[],
  ) {
    return observations.map(
      (
        observation,
      ) => {
        const code =
          observation.code
            ?.coding?.[0]
            ?.code;

        const text =
          observation.code
            ?.text ??
          observation.code
            ?.coding?.[0]
            ?.display ??
          code ??
          'Observation';

        const time =
          observation
            .effectiveDateTime ??
          observation.issued;

        // ===============================================
        // BLOOD PRESSURE
        // ===============================================

        if (
          code ===
          '85354-9'
        ) {
          const systolic =
            observation.component
              ?.find(
                (
                  component,
                ) =>
                  component.code
                    ?.coding
                    ?.some(
                      (
                        coding,
                      ) =>
                        coding.code ===
                        '8480-6',
                    ),
              )
              ?.valueQuantity
              ?.value;

          const diastolic =
            observation.component
              ?.find(
                (
                  component,
                ) =>
                  component.code
                    ?.coding
                    ?.some(
                      (
                        coding,
                      ) =>
                        coding.code ===
                        '8462-4',
                    ),
              )
              ?.valueQuantity
              ?.value;

          return {
            id:
              observation.id,

            type:
              'blood-pressure',

            code,

            label:
              'Blood Pressure',

            systolic,

            diastolic,

            value:
              systolic !==
                undefined &&
              diastolic !==
                undefined
                ? `${systolic}/${diastolic}`
                : undefined,

            unit:
              'mmHg',

            effectiveDateTime:
              time,
          };
        }

        // ===============================================
        // PAIN SCORE
        // ===============================================

        if (
          code ===
          '72514-3'
        ) {
          return {
            id:
              observation.id,

            type:
              'pain-score',

            code,

            label:
              'Pain Score',

            value:
              observation.valueInteger,

            unit:
              '/10',

            effectiveDateTime:
              time,
          };
        }

        // ===============================================
        // QUANTITY OBSERVATION
        // ===============================================

        return {
          id:
            observation.id,

          type:
            this.getVitalType(
              code,
            ),

          code,

          label:
            text,

          value:
            observation
              .valueQuantity
              ?.value,

          unit:
            observation
              .valueQuantity
              ?.unit,

          effectiveDateTime:
            time,
        };
      },
    );
  }

  // =====================================================
  // MAP LOINC -> INTERNAL VITAL TYPE
  // =====================================================

  private getVitalType(
    code?: string,
  ) {
    switch (code) {
      case '8867-4':
        return 'pulse';

      case '8310-5':
        return 'temperature';

      case '9279-1':
        return 'respiratory-rate';

      case '59408-5':
        return 'spo2';

      case '29463-7':
        return 'weight';

      case '8302-2':
        return 'height';

      case '39156-5':
        return 'bmi';

      default:
        return 'observation';
    }
  }

  // =====================================================
  // OBSERVATION TIME
  // =====================================================

  private getObservationTime(
    observation:
      Observation,
  ) {
    const value =
      observation
        .effectiveDateTime ??
      observation.issued;

    if (!value) {
      return 0;
    }

    const timestamp =
      new Date(
        value,
      ).getTime();

    if (
      Number.isNaN(
        timestamp,
      )
    ) {
      return 0;
    }

    return timestamp;
  }

  // =====================================================
  // VALIDATE VITAL RANGES
  // =====================================================

  private validateVitals(
    dto: CreateVitalsDto,
  ) {
    if (
      dto.systolic !==
        undefined &&
      (
        dto.systolic <=
          0 ||
        dto.systolic >
          350
      )
    ) {
      throw new BadRequestException(
        'Invalid systolic blood pressure',
      );
    }

    if (
      dto.diastolic !==
        undefined &&
      (
        dto.diastolic <=
          0 ||
        dto.diastolic >
          250
      )
    ) {
      throw new BadRequestException(
        'Invalid diastolic blood pressure',
      );
    }

    if (
      dto.pulse !==
        undefined &&
      (
        dto.pulse <= 0 ||
        dto.pulse >
          300
      )
    ) {
      throw new BadRequestException(
        'Invalid pulse value',
      );
    }

    if (
      dto.temperature !==
        undefined &&
      (
        dto.temperature <
          20 ||
        dto.temperature >
          50
      )
    ) {
      throw new BadRequestException(
        'Invalid body temperature',
      );
    }

    if (
      dto.respiratoryRate !==
        undefined &&
      (
        dto.respiratoryRate <=
          0 ||
        dto.respiratoryRate >
          100
      )
    ) {
      throw new BadRequestException(
        'Invalid respiratory rate',
      );
    }

    if (
      dto.spo2 !==
        undefined &&
      (
        dto.spo2 < 0 ||
        dto.spo2 > 100
      )
    ) {
      throw new BadRequestException(
        'SpO2 must be between 0 and 100',
      );
    }

    if (
      dto.weight !==
        undefined &&
      (
        dto.weight <= 0 ||
        dto.weight >
          1000
      )
    ) {
      throw new BadRequestException(
        'Invalid patient weight',
      );
    }

    if (
      dto.height !==
        undefined &&
      (
        dto.height <= 0 ||
        dto.height >
          300
      )
    ) {
      throw new BadRequestException(
        'Invalid patient height',
      );
    }

    if (
      dto.painScore !==
        undefined &&
      (
        dto.painScore <
          0 ||
        dto.painScore >
          10
      )
    ) {
      throw new BadRequestException(
        'Pain score must be between 0 and 10',
      );
    }
  }
}
