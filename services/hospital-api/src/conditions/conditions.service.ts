import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type { Condition, Encounter, Patient } from '@medplum/fhirtypes';

import { MedplumService } from '../medplum/medplum.service';

import {
  CreateConditionDto,
  DiagnosisCodeSystem,
} from './dto/create-condition.dto';

@Injectable()
export class ConditionsService {
  constructor(private readonly medplumService: MedplumService) {}

  // =====================================================
  // CREATE CONDITION
  // =====================================================

  async create(dto: CreateConditionDto) {
    const medplum = this.medplumService.getClient();

    // ===================================================
    // BASIC VALIDATION
    // ===================================================

    if (!dto.patientId) {
      throw new BadRequestException('Patient ID is required');
    }

    if (!dto.hospitalId) {
      throw new BadRequestException('Hospital ID is required');
    }

    if (!dto.category) {
      throw new BadRequestException('Condition category is required');
    }

    const codeSystem = dto.codeSystem ?? 'ICD-10';
    const diagnosisCode = (dto.diagnosisCode ?? dto.icd10Code)
      ?.trim()
      .toUpperCase();

    if (!['ICD-10', 'ICD-11'].includes(codeSystem)) {
      throw new BadRequestException(
        'Diagnosis code system must be ICD-10 or ICD-11',
      );
    }

    if (!diagnosisCode) {
      throw new BadRequestException('Diagnosis code is required');
    }

    if (!this.isValidDiagnosisCode(codeSystem, diagnosisCode)) {
      throw new BadRequestException(`Invalid ${codeSystem} code format`);
    }

    if (!dto.description) {
      throw new BadRequestException('Diagnosis description is required');
    }

    // ===================================================
    // VALID CATEGORY
    // ===================================================

    const validCategories = ['encounter-diagnosis', 'problem-list-item'];

    if (!validCategories.includes(dto.category)) {
      throw new BadRequestException('Invalid condition category');
    }

    // ===================================================
    // ENCOUNTER REQUIRED FOR ENCOUNTER DIAGNOSIS
    // ===================================================

    if (dto.category === 'encounter-diagnosis' && !dto.encounterId) {
      throw new BadRequestException(
        'Encounter ID is required for encounter diagnosis',
      );
    }

    // ===================================================
    // VERIFY PATIENT
    // ===================================================

    let patient: Patient;

    try {
      patient = await medplum.readResource('Patient', dto.patientId);
    } catch {
      throw new NotFoundException('Patient not found');
    }

    // ===================================================
    // VERIFY PATIENT -> HOSPITAL
    // ===================================================

    if (
      patient.managingOrganization?.reference !==
      `Organization/${dto.hospitalId}`
    ) {
      throw new BadRequestException(
        'Patient does not belong to the selected hospital',
      );
    }

    // ===================================================
    // VERIFY ENCOUNTER
    // ===================================================

    let encounter: Encounter | undefined;

    if (dto.encounterId) {
      try {
        encounter = await medplum.readResource('Encounter', dto.encounterId);
      } catch {
        throw new NotFoundException('Encounter not found');
      }

      if (encounter.subject?.reference !== `Patient/${dto.patientId}`) {
        throw new BadRequestException(
          'Encounter does not belong to this patient',
        );
      }

      if (
        encounter.serviceProvider?.reference !==
        `Organization/${dto.hospitalId}`
      ) {
        throw new BadRequestException(
          'Encounter does not belong to the selected hospital',
        );
      }
    }

    // ===================================================
    // PRIMARY DIAGNOSIS VALIDATION
    // ===================================================

    if (
      dto.category === 'encounter-diagnosis' &&
      dto.diagnosisRank === 'primary' &&
      dto.encounterId
    ) {
      const existing = await medplum.searchResources('Condition', {
        encounter: `Encounter/${dto.encounterId}`,
        _count: '100',
      });

      const hasPrimary = [...existing].some((condition) =>
        condition.extension?.some(
          (extension) =>
            extension.url ===
              'https://hospital-ehr.local/fhir/StructureDefinition/diagnosis-rank' &&
            extension.valueCode === 'primary',
        ),
      );

      if (hasPrimary) {
        throw new BadRequestException(
          'This encounter already has a primary diagnosis',
        );
      }
    }

    // ===================================================
    // CLINICAL STATUS
    // ===================================================

    const clinicalStatus = dto.clinicalStatus ?? 'active';

    // ===================================================
    // VERIFICATION STATUS
    // ===================================================

    const verificationStatus = dto.verificationStatus ?? 'confirmed';

    // ===================================================
    // BUILD CONDITION
    // ===================================================

    const condition: Condition = {
      resourceType: 'Condition',

      subject: {
        reference: `Patient/${dto.patientId}`,
      },

      clinicalStatus: {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/condition-clinical',
            code: clinicalStatus,
            display: this.getClinicalStatusDisplay(clinicalStatus),
          },
        ],
      },

      verificationStatus: {
        coding: [
          {
            system:
              'http://terminology.hl7.org/CodeSystem/condition-ver-status',
            code: verificationStatus,
            display: this.getVerificationStatusDisplay(verificationStatus),
          },
        ],
      },

      category: [
        {
          coding: [
            {
              system:
                'http://terminology.hl7.org/CodeSystem/condition-category',
              code: dto.category,
              display:
                dto.category === 'encounter-diagnosis'
                  ? 'Encounter Diagnosis'
                  : 'Problem List Item',
            },
          ],
        },
      ],

      code: {
        coding: [
          {
            system: this.codeSystemUri(codeSystem),
            code: diagnosisCode,
            display: dto.description,
          },
        ],

        text: dto.description,
      },

      recordedDate: new Date().toISOString(),
    };

    // ===================================================
    // ENCOUNTER REFERENCE
    // ===================================================

    if (dto.encounterId) {
      condition.encounter = {
        reference: `Encounter/${dto.encounterId}`,
      };
    }

    // ===================================================
    // ONSET
    // ===================================================

    if (dto.onsetDateTime) {
      const parsed = new Date(dto.onsetDateTime);

      if (Number.isNaN(parsed.getTime())) {
        throw new BadRequestException('Invalid onset date');
      }

      condition.onsetDateTime = parsed.toISOString();
    }

    // ===================================================
    // SEVERITY
    // ===================================================

    if (dto.severity) {
      condition.severity = {
        text: dto.severity,
      };
    }

    // ===================================================
    // NOTES
    // ===================================================

    if (dto.note) {
      condition.note = [
        {
          text: dto.note,
        },
      ];
    }

    // ===================================================
    // EXTENSIONS
    // ===================================================

    condition.extension = [];

    if (dto.diagnosisRank) {
      condition.extension.push({
        url: 'https://hospital-ehr.local/fhir/StructureDefinition/diagnosis-rank',

        valueCode: dto.diagnosisRank,
      });
    }

    condition.extension.push({
      url: 'https://hospital-ehr.local/fhir/StructureDefinition/condition-hospital',

      valueReference: {
        reference: `Organization/${dto.hospitalId}`,
      },
    });

    // ===================================================
    // SAVE CONDITION
    // ===================================================

    const created = await medplum.createResource<Condition>(condition);

    return this.mapCondition(created);
  }

  // =====================================================
  // GET CONDITIONS BY ENCOUNTER
  // =====================================================

  async findByEncounter(encounterId: string, hospitalId: string) {
    if (!encounterId) {
      throw new BadRequestException('Encounter ID is required');
    }

    if (!hospitalId) throw new BadRequestException('Hospital ID is required');

    const medplum = this.medplumService.getClient();

    const result = await medplum.searchResources('Condition', {
      encounter: `Encounter/${encounterId}`,

      _count: '100',
    });

    const conditions: Condition[] = [...result].filter(
      (condition) => this.conditionHospitalId(condition) === hospitalId,
    );

    conditions.sort((a, b) => {
      const aDate = a.recordedDate ? new Date(a.recordedDate).getTime() : 0;

      const bDate = b.recordedDate ? new Date(b.recordedDate).getTime() : 0;

      return bDate - aDate;
    });

    return {
      total: conditions.length,

      conditions: conditions.map((condition) => this.mapCondition(condition)),
    };
  }

  // =====================================================
  // GET PATIENT PROBLEM LIST
  // =====================================================

  async findPatientProblems(patientId: string, hospitalId: string) {
    if (!patientId) {
      throw new BadRequestException('Patient ID is required');
    }

    if (!hospitalId) throw new BadRequestException('Hospital ID is required');

    const medplum = this.medplumService.getClient();

    const result = await medplum.searchResources('Condition', {
      subject: `Patient/${patientId}`,

      category: 'problem-list-item',

      _count: '200',
    });

    const conditions: Condition[] = [...result].filter(
      (condition) => this.conditionHospitalId(condition) === hospitalId,
    );

    return {
      total: conditions.length,

      conditions: conditions.map((condition) => this.mapCondition(condition)),
    };
  }

  // =====================================================
  // GET CONDITION BY ID
  // =====================================================

  async findById(conditionId: string, hospitalId: string) {
    if (!conditionId) {
      throw new BadRequestException('Condition ID is required');
    }

    if (!hospitalId) throw new BadRequestException('Hospital ID is required');

    const medplum = this.medplumService.getClient();

    let condition: Condition;

    try {
      condition = await medplum.readResource('Condition', conditionId);
    } catch {
      throw new NotFoundException('Condition not found');
    }

    this.assertConditionHospital(condition, hospitalId);

    return this.mapCondition(condition);
  }

  // =====================================================
  // UPDATE CLINICAL STATUS
  // =====================================================

  async updateStatus(
    conditionId: string,
    clinicalStatus: string,
    hospitalId: string,
  ) {
    if (!hospitalId) throw new BadRequestException('Hospital ID is required');
    const allowedStatuses = [
      'active',
      'recurrence',
      'relapse',
      'inactive',
      'remission',
      'resolved',
    ];

    if (!allowedStatuses.includes(clinicalStatus)) {
      throw new BadRequestException('Invalid clinical status');
    }

    const medplum = this.medplumService.getClient();

    let condition: Condition;

    try {
      condition = await medplum.readResource('Condition', conditionId);
    } catch {
      throw new NotFoundException('Condition not found');
    }

    this.assertConditionHospital(condition, hospitalId);

    condition.clinicalStatus = {
      coding: [
        {
          system: 'http://terminology.hl7.org/CodeSystem/condition-clinical',

          code: clinicalStatus,

          display: this.getClinicalStatusDisplay(clinicalStatus),
        },
      ],
    };

    if (clinicalStatus === 'resolved') {
      condition.abatementDateTime = new Date().toISOString();
    } else {
      condition.abatementDateTime = undefined;
    }

    const updated = await medplum.updateResource<Condition>(condition);

    return this.mapCondition(updated);
  }

  // =====================================================
  // MAP CONDITION
  // =====================================================

  private mapCondition(condition: Condition) {
    const category = condition.category?.[0]?.coding?.[0]?.code;

    const clinicalStatus = condition.clinicalStatus?.coding?.[0]?.code;

    const verificationStatus = condition.verificationStatus?.coding?.[0]?.code;

    const diagnosisCoding =
      condition.code?.coding?.find(
        (coding) =>
          coding.system === 'http://hl7.org/fhir/sid/icd-10' ||
          coding.system === 'http://id.who.int/icd/release/11/mms',
      ) ?? condition.code?.coding?.[0];
    const diagnosisCode = diagnosisCoding?.code;
    const codeSystem =
      diagnosisCoding?.system === 'http://id.who.int/icd/release/11/mms'
        ? 'ICD-11'
        : 'ICD-10';
    const icd10Code = codeSystem === 'ICD-10' ? diagnosisCode : undefined;

    const description =
      condition.code?.text ?? condition.code?.coding?.[0]?.display;

    const diagnosisRank = condition.extension?.find(
      (extension) =>
        extension.url ===
        'https://hospital-ehr.local/fhir/StructureDefinition/diagnosis-rank',
    )?.valueCode;

    const hospitalId = condition.extension
      ?.find(
        (extension) =>
          extension.url ===
          'https://hospital-ehr.local/fhir/StructureDefinition/condition-hospital',
      )
      ?.valueReference?.reference?.replace('Organization/', '');

    const patientId = condition.subject?.reference?.replace('Patient/', '');

    const encounterId = condition.encounter?.reference?.replace(
      'Encounter/',
      '',
    );

    return {
      id: condition.id,

      resourceType: condition.resourceType,

      patientId,

      encounterId,

      hospitalId,

      category,

      diagnosisRank,

      codeSystem,

      diagnosisCode,

      icd10Code,

      description,

      clinicalStatus,

      verificationStatus,

      severity: condition.severity?.text,

      onsetDateTime: condition.onsetDateTime,

      recordedDate: condition.recordedDate,

      abatementDateTime: condition.abatementDateTime,

      note: condition.note?.[0]?.text,
    };
  }

  // =====================================================
  // STATUS DISPLAY HELPERS
  // =====================================================

  private conditionHospitalId(condition: Condition): string | undefined {
    return condition.extension
      ?.find(
        (extension) =>
          extension.url ===
          'https://hospital-ehr.local/fhir/StructureDefinition/condition-hospital',
      )
      ?.valueReference?.reference?.replace('Organization/', '');
  }

  private assertConditionHospital(
    condition: Condition,
    hospitalId: string,
  ): void {
    if (this.conditionHospitalId(condition) !== hospitalId) {
      throw new NotFoundException('Condition not found');
    }
  }

  private codeSystemUri(value: DiagnosisCodeSystem): string {
    return value === 'ICD-11'
      ? 'http://id.who.int/icd/release/11/mms'
      : 'http://hl7.org/fhir/sid/icd-10';
  }

  private isValidDiagnosisCode(
    system: DiagnosisCodeSystem,
    code: string,
  ): boolean {
    if (system === 'ICD-10') {
      return /^[A-TV-Z][0-9][0-9A-Z](?:\.[0-9A-Z]{1,4})?$/i.test(code);
    }

    // ICD-11 MMS stem and extension codes are alphanumeric and may contain
    // a decimal suffix. Semantic validation belongs to the WHO terminology API.
    return /^[0-9A-Z][0-9A-Z-]{2,11}(?:\.[0-9A-Z]{1,5})?$/i.test(code);
  }

  private getClinicalStatusDisplay(value: string) {
    switch (value) {
      case 'active':
        return 'Active';

      case 'recurrence':
        return 'Recurrence';

      case 'relapse':
        return 'Relapse';

      case 'inactive':
        return 'Inactive';

      case 'remission':
        return 'Remission';

      case 'resolved':
        return 'Resolved';

      default:
        return value;
    }
  }

  private getVerificationStatusDisplay(value: string) {
    switch (value) {
      case 'unconfirmed':
        return 'Unconfirmed';

      case 'provisional':
        return 'Provisional';

      case 'differential':
        return 'Differential';

      case 'confirmed':
        return 'Confirmed';

      case 'refuted':
        return 'Refuted';

      case 'entered-in-error':
        return 'Entered in Error';

      default:
        return value;
    }
  }
}
