import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type {
  AllergyIntolerance,
  Encounter,
  MedicationRequest,
  Patient,
} from '@medplum/fhirtypes';

import {
  MedplumService,
} from '../medplum/medplum.service';

import {
  CreateMedicationRequestDto,
} from './dto/create-medication-request.dto';

@Injectable()
export class MedicationsService {
  constructor(
    private readonly medplumService:
      MedplumService,
  ) {}

  // =====================================================
  // CREATE MEDICATION REQUEST
  // =====================================================

  async create(
    dto: CreateMedicationRequestDto,
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

    if (!dto.hospitalId) {
      throw new BadRequestException(
        'Hospital ID is required',
      );
    }

    if (!dto.encounterId) {
      throw new BadRequestException(
        'Encounter ID is required',
      );
    }

    if (!dto.medicationName?.trim()) {
      throw new BadRequestException(
        'Medication name is required',
      );
    }

    if (!dto.medicationCode?.trim()) {
      throw new BadRequestException(
        'Medication code is required',
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

    if (
      patient.managingOrganization
        ?.reference !==
      `Organization/${dto.hospitalId}`
    ) {
      throw new BadRequestException(
        'Patient does not belong to the selected hospital',
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

    if (
      encounter.subject?.reference !==
      `Patient/${dto.patientId}`
    ) {
      throw new BadRequestException(
        'Encounter does not belong to this patient',
      );
    }

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
    // DRUG ALLERGY SAFETY CHECK
    // ===================================================

    const allergyWarnings =
      await this.findMedicationAllergyWarnings(
        dto.patientId,
        dto.medicationName,
        dto.medicationCode,
      );

    if (
      allergyWarnings.length > 0
    ) {
      throw new ConflictException({
        message:
          'Medication allergy alert',

        allergyAlert:
          true,

        medication:
          dto.medicationName,

        warnings:
          allergyWarnings,
      });
    }

    // ===================================================
    // DATE VALIDATION
    // ===================================================

    const authoredOn =
      new Date().toISOString();

    let startDate:
      string | undefined;

    let endDate:
      string | undefined;

    if (dto.startDate) {
      startDate =
        this.parseDate(
          dto.startDate,
          'start date',
        );
    }

    if (dto.endDate) {
      endDate =
        this.parseDate(
          dto.endDate,
          'end date',
        );
    }

    if (
      startDate &&
      endDate &&
      new Date(endDate).getTime() <
        new Date(startDate).getTime()
    ) {
      throw new BadRequestException(
        'Medication end date cannot be before start date',
      );
    }

    // ===================================================
    // BUILD DOSAGE INSTRUCTION
    // ===================================================

    const dosageInstruction:
      NonNullable<
        MedicationRequest[
          'dosageInstruction'
        ]
      > = [];

    const dosage:
      NonNullable<
        MedicationRequest[
          'dosageInstruction'
        ]
      >[number] = {};

    if (
      dto.instructions?.trim()
    ) {
      dosage.text =
        dto.instructions.trim();
    }

    if (
      dto.asNeeded !== undefined
    ) {
      dosage.asNeededBoolean =
        dto.asNeeded;
    }

    if (
      dto.route?.trim()
    ) {
      dosage.route = {
        text:
          dto.route.trim(),
      };
    }

    if (
      dto.dose !== undefined
    ) {
      dosage.doseAndRate = [
        {
          doseQuantity: {
            value:
              dto.dose,

            unit:
              dto.doseUnit ||
              undefined,

            system:
              dto.doseUnit
                ? 'http://unitsofmeasure.org'
                : undefined,

            code:
              dto.doseUnit ||
              undefined,
          },
        },
      ];
    }

    if (
      dto.frequency?.trim() ||
      dto.durationDays !==
        undefined
    ) {
      dosage.timing = {};

      if (
        dto.frequency?.trim()
      ) {
        dosage.timing.code = {
          text:
            dto.frequency.trim(),
        };
      }

      if (
        dto.durationDays !==
        undefined
      ) {
        dosage.timing.repeat = {
          boundsDuration: {
            value:
              dto.durationDays,

            unit:
              'days',

            system:
              'http://unitsofmeasure.org',

            code:
              'd',
          },
        };
      }
    }

    if (
      Object.keys(dosage).length >
      0
    ) {
      dosageInstruction.push(
        dosage,
      );
    }

    // ===================================================
    // DISPENSE REQUEST
    // ===================================================

    const dispenseRequest:
      MedicationRequest[
        'dispenseRequest'
      ] = {};

    if (
      dto.quantity !== undefined
    ) {
      dispenseRequest.quantity = {
        value:
          dto.quantity,

        unit:
          dto.quantityUnit ||
          undefined,

        system:
          dto.quantityUnit
            ? 'http://unitsofmeasure.org'
            : undefined,

        code:
          dto.quantityUnit ||
          undefined,
      };
    }

    if (
      startDate ||
      endDate
    ) {
      dispenseRequest.validityPeriod = {
        start:
          startDate,

        end:
          endDate,
      };
    }

    // ===================================================
    // BUILD FHIR MEDICATION REQUEST
    // ===================================================

    const medicationRequest:
      MedicationRequest = {
        resourceType:
          'MedicationRequest',

        status:
          'active',

        intent:
          'order',

        priority:
          dto.priority ??
          'routine',

        medicationCodeableConcept: {
          coding: [
            {
              system:
                'https://hospital-ehr.local/CodeSystem/medication',

              code:
                dto.medicationCode.trim(),

              display:
                dto.medicationName.trim(),
            },
          ],

          text:
            dto.medicationName.trim(),
        },

        subject: {
          reference:
            `Patient/${dto.patientId}`,
        },

        encounter: {
          reference:
            `Encounter/${dto.encounterId}`,
        },

        authoredOn,

        requester:
          dto.practitionerId
            ? {
                reference:
                  `Practitioner/${dto.practitionerId}`,
              }
            : {
                reference:
                  `Organization/${dto.hospitalId}`,
              },

        dosageInstruction:
          dosageInstruction.length >
          0
            ? dosageInstruction
            : undefined,

        dispenseRequest:
          Object.keys(
            dispenseRequest,
          ).length > 0
            ? dispenseRequest
            : undefined,

        extension: [
          {
            url:
              'https://hospital-ehr.local/fhir/StructureDefinition/medication-hospital',

            valueReference: {
              reference:
                `Organization/${dto.hospitalId}`,
            },
          },
        ],
      };

    // ===================================================
    // SAVE
    // ===================================================

    const created =
      await medplum.createResource<MedicationRequest>(
        medicationRequest,
      );

    return this.mapMedicationRequest(
      created,
    );
  }

  // =====================================================
  // GET ENCOUNTER MEDICATIONS
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

    const result =
      await medplum.searchResources(
        'MedicationRequest',
        {
          encounter:
            `Encounter/${encounterId}`,

          _count:
            '200',
        },
      );

    const medications:
      MedicationRequest[] = [
        ...result,
      ];

    medications.sort(
      (
        a,
        b,
      ) => {
        const aDate =
          a.authoredOn
            ? new Date(
                a.authoredOn,
              ).getTime()
            : 0;

        const bDate =
          b.authoredOn
            ? new Date(
                b.authoredOn,
              ).getTime()
            : 0;

        return bDate - aDate;
      },
    );

    return {
      total:
        medications.length,

      medications:
        medications.map(
          (
            medication,
          ) =>
            this.mapMedicationRequest(
              medication,
            ),
        ),
    };
  }

  // =====================================================
  // GET PATIENT MEDICATIONS
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

    const result =
      await medplum.searchResources(
        'MedicationRequest',
        {
          subject:
            `Patient/${patientId}`,

          _count:
            '300',
        },
      );

    const medications:
      MedicationRequest[] = [
        ...result,
      ];

    return {
      total:
        medications.length,

      medications:
        medications.map(
          (
            medication,
          ) =>
            this.mapMedicationRequest(
              medication,
            ),
        ),
    };
  }

  // =====================================================
  // GET MEDICATION BY ID
  // =====================================================

  async findById(
    medicationRequestId:
      string,
  ) {
    const medplum =
      this.medplumService.getClient();

    let request:
      MedicationRequest;

    try {
      request =
        await medplum.readResource(
          'MedicationRequest',
          medicationRequestId,
        );
    } catch {
      throw new NotFoundException(
        'Medication request not found',
      );
    }

    return this.mapMedicationRequest(
      request,
    );
  }

  // =====================================================
  // UPDATE STATUS
  // =====================================================

  async updateStatus(
    medicationRequestId:
      string,

    status:
      string,
  ) {
    const allowedStatuses = [
      'active',
      'on-hold',
      'cancelled',
      'completed',
      'stopped',
      'draft',
      'unknown',
    ];

    if (
      !allowedStatuses.includes(
        status,
      )
    ) {
      throw new BadRequestException(
        'Invalid medication status',
      );
    }

    const medplum =
      this.medplumService.getClient();

    let request:
      MedicationRequest;

    try {
      request =
        await medplum.readResource(
          'MedicationRequest',
          medicationRequestId,
        );
    } catch {
      throw new NotFoundException(
        'Medication request not found',
      );
    }

    request.status =
      status as
        MedicationRequest['status'];

    const updated =
      await medplum.updateResource<MedicationRequest>(
        request,
      );

    return this.mapMedicationRequest(
      updated,
    );
  }

  // =====================================================
  // ALLERGY SAFETY CHECK
  // =====================================================

  private async findMedicationAllergyWarnings(
    patientId:
      string,

    medicationName:
      string,

    medicationCode:
      string,
  ) {
    const medplum =
      this.medplumService.getClient();

    const result =
      await medplum.searchResources(
        'AllergyIntolerance',
        {
          patient:
            `Patient/${patientId}`,

          _count:
            '200',
        },
      );

    const allergies:
      AllergyIntolerance[] = [
        ...result,
      ];

    const medicationNameNormalized =
      this.normalize(
        medicationName,
      );

    const medicationCodeNormalized =
      this.normalize(
        medicationCode,
      );

    return allergies
      .filter(
        (
          allergy,
        ) => {
          const clinicalStatus =
            allergy.clinicalStatus
              ?.coding?.[0]
              ?.code;

          const verificationStatus =
            allergy.verificationStatus
              ?.coding?.[0]
              ?.code;

          if (
            clinicalStatus !==
            'active'
          ) {
            return false;
          }

          if (
            verificationStatus ===
              'refuted' ||
            verificationStatus ===
              'entered-in-error'
          ) {
            return false;
          }

          const category =
            allergy.category?.[0];

          if (
            category &&
            category !==
              'medication'
          ) {
            return false;
          }

          const allergyCode =
            this.normalize(
              allergy.code
                ?.coding?.[0]
                ?.code,
            );

          const allergyDisplay =
            this.normalize(
              allergy.code?.text ??
              allergy.code
                ?.coding?.[0]
                ?.display,
            );

          if (
            !allergyCode &&
            !allergyDisplay
          ) {
            return false;
          }

          const codeMatch =
            Boolean(
              allergyCode &&
              medicationCodeNormalized &&
              (
                allergyCode ===
                  medicationCodeNormalized ||
                medicationCodeNormalized.includes(
                  allergyCode,
                ) ||
                allergyCode.includes(
                  medicationCodeNormalized,
                )
              ),
            );

          const displayMatch =
            Boolean(
              allergyDisplay &&
              medicationNameNormalized &&
              (
                allergyDisplay ===
                  medicationNameNormalized ||
                medicationNameNormalized.includes(
                  allergyDisplay,
                ) ||
                allergyDisplay.includes(
                  medicationNameNormalized,
                )
              ),
            );

          return (
            codeMatch ||
            displayMatch
          );
        },
      )
      .map(
        (
          allergy,
        ) => ({
          allergyId:
            allergy.id,

          allergen:
            allergy.code?.text ??
            allergy.code
              ?.coding?.[0]
              ?.display ??
            'Unknown allergen',

          criticality:
            allergy.criticality,

          reaction:
            allergy.reaction?.[0]
              ?.manifestation?.[0]
              ?.text,

          severity:
            allergy.reaction?.[0]
              ?.severity,

          verificationStatus:
            allergy.verificationStatus
              ?.coding?.[0]
              ?.code,
        }),
      );
  }

  // =====================================================
  // MAP MEDICATION REQUEST
  // =====================================================

  private mapMedicationRequest(
    request:
      MedicationRequest,
  ) {
    const medication =
      request.medicationCodeableConcept;

    const dosage =
      request.dosageInstruction?.[0];

    const doseQuantity =
      dosage
        ?.doseAndRate?.[0]
        ?.doseQuantity;

    const hospitalId =
      request.extension
        ?.find(
          (
            extension,
          ) =>
            extension.url ===
            'https://hospital-ehr.local/fhir/StructureDefinition/medication-hospital',
        )
        ?.valueReference
        ?.reference
        ?.replace(
          'Organization/',
          '',
        );

    return {
      id:
        request.id,

      resourceType:
        request.resourceType,

      status:
        request.status,

      intent:
        request.intent,

      priority:
        request.priority,

      medicationCode:
        medication
          ?.coding?.[0]
          ?.code,

      medicationName:
        medication?.text ??
        medication
          ?.coding?.[0]
          ?.display,

      patientId:
        request.subject
          ?.reference
          ?.replace(
            'Patient/',
            '',
          ),

      encounterId:
        request.encounter
          ?.reference
          ?.replace(
            'Encounter/',
            '',
          ),

      hospitalId,

      requester:
        request.requester
          ?.reference,

      authoredOn:
        request.authoredOn,

      instructions:
        dosage?.text,

      route:
        dosage?.route
          ?.text,

      dose:
        doseQuantity
          ?.value,

      doseUnit:
        doseQuantity
          ?.unit,

      frequency:
        dosage?.timing
          ?.code?.text,

      asNeeded:
        dosage
          ?.asNeededBoolean,

      durationDays:
        dosage
          ?.timing
          ?.repeat
          ?.boundsDuration
          ?.value,

      quantity:
        request
          .dispenseRequest
          ?.quantity
          ?.value,

      quantityUnit:
        request
          .dispenseRequest
          ?.quantity
          ?.unit,

      startDate:
        request
          .dispenseRequest
          ?.validityPeriod
          ?.start,

      endDate:
        request
          .dispenseRequest
          ?.validityPeriod
          ?.end,
    };
  }

  // =====================================================
  // HELPERS
  // =====================================================

  private normalize(
    value?:
      string,
  ) {
    if (!value) {
      return '';
    }

    return value
      .trim()
      .toLowerCase()
      .replace(
        /[^a-z0-9]+/g,
        '',
      );
  }

  private parseDate(
    value:
      string,

    label:
      string,
  ) {
    const date =
      new Date(
        value,
      );

    if (
      Number.isNaN(
        date.getTime(),
      )
    ) {
      throw new BadRequestException(
        `Invalid medication ${label}`,
      );
    }

    return date.toISOString();
  }
}