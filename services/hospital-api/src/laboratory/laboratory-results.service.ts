import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type {
  Encounter,
  Observation,
  Patient,
  ServiceRequest,
  Specimen,
  Task,
} from '@medplum/fhirtypes';

import { MedplumService } from '../medplum/medplum.service';
import {
  CreateLabResultDto,
  LabResultStatus,
} from './dto/create-lab-result.dto';
import { CreateLabResultsBatchDto } from './dto/create-lab-results-batch.dto';
import { UpdateLabResultDto } from './dto/update-lab-result.dto';
import {
  AcknowledgeCriticalResultDto,
  ValidateLabResultDto,
} from './dto/lab-validation.dto';

const LAB_CATEGORY_SYSTEM =
  'http://terminology.hl7.org/CodeSystem/observation-category';

const LAB_CATEGORY_CODE = 'laboratory';

const LOCAL_LAB_CODE_SYSTEM =
  'http://hospital-ehr.local/fhir/CodeSystem/laboratory-tests';

const INTERPRETATION_SYSTEM =
  'http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation';

const HOSPITAL_EXTENSION_URL =
  'http://hospital-ehr.local/fhir/StructureDefinition/hospital';
const BASE = 'http://hospital-ehr.local/fhir/StructureDefinition';
const TECHNICAL_VALIDATION = `${BASE}/technical-validation`;
const CLINICAL_VALIDATION = `${BASE}/clinical-validation`;
const CRITICAL_ACKNOWLEDGEMENT = `${BASE}/critical-acknowledgement`;

type InterpretationCode = 'N' | 'L' | 'H' | 'LL' | 'HH';

@Injectable()
export class LaboratoryResultsService {
  constructor(private readonly medplumService: MedplumService) {}

  async createResult(dto: CreateLabResultDto) {
    await this.validateResultContext(dto);

    const medplum = this.medplumService.getClient();

    const interpretation = this.calculateInterpretation(
      dto.value,
      dto.referenceLow,
      dto.referenceHigh,
      dto.criticalLow,
      dto.criticalHigh,
    );

    const observation: Observation = {
      resourceType: 'Observation',
      status: dto.status ?? 'preliminary',

      category: [
        {
          coding: [
            {
              system: LAB_CATEGORY_SYSTEM,
              code: LAB_CATEGORY_CODE,
              display: 'Laboratory',
            },
          ],
          text: 'Laboratory',
        },
      ],

      code: {
        coding: [
          {
            system: LOCAL_LAB_CODE_SYSTEM,
            code: dto.testCode.trim(),
            display: dto.testName.trim(),
          },
        ],
        text: dto.testName.trim(),
      },

      subject: {
        reference: `Patient/${dto.patientId}`,
      },

      encounter: {
        reference: `Encounter/${dto.encounterId}`,
      },

      basedOn: [
        {
          reference: `ServiceRequest/${dto.orderId}`,
        },
      ],

      specimen: {
        reference: `Specimen/${dto.specimenId}`,
      },

      effectiveDateTime: dto.performedAt ?? new Date().toISOString(),

      issued: new Date().toISOString(),

      performer:
        dto.performerId || dto.performerName
          ? [
              dto.performerId
                ? {
                    reference: `Practitioner/${dto.performerId}`,
                    display: dto.performerName,
                  }
                : {
                    display: dto.performerName,
                  },
            ]
          : undefined,

      valueQuantity: {
        value: dto.value,
        unit: dto.unit.trim(),
      },

      referenceRange:
        dto.referenceLow !== undefined || dto.referenceHigh !== undefined
          ? [
              {
                low:
                  dto.referenceLow !== undefined
                    ? {
                        value: dto.referenceLow,
                        unit: dto.unit.trim(),
                      }
                    : undefined,
                high:
                  dto.referenceHigh !== undefined
                    ? {
                        value: dto.referenceHigh,
                        unit: dto.unit.trim(),
                      }
                    : undefined,
              },
            ]
          : undefined,

      interpretation: [
        {
          coding: [
            {
              system: INTERPRETATION_SYSTEM,
              code: interpretation,
              display: this.interpretationDisplay(interpretation),
            },
          ],
          text: this.interpretationDisplay(interpretation),
        },
      ],

      note: dto.note?.trim()
        ? [
            {
              text: dto.note.trim(),
            },
          ]
        : undefined,

      extension: [
        {
          url: HOSPITAL_EXTENSION_URL,
          valueReference: {
            reference: `Organization/${dto.hospitalId}`,
          },
        },
        ...(dto.criticalLow !== undefined
          ? [
              {
                url: 'http://hospital-ehr.local/fhir/StructureDefinition/critical-low',
                valueDecimal: dto.criticalLow,
              },
            ]
          : []),
        ...(dto.criticalHigh !== undefined
          ? [
              {
                url: 'http://hospital-ehr.local/fhir/StructureDefinition/critical-high',
                valueDecimal: dto.criticalHigh,
              },
            ]
          : []),
      ],
    };

    const created = await medplum.createResource(observation);

    return this.mapResult(created);
  }

  async createResultsBatch(dto: CreateLabResultsBatchDto) {
    if (!Array.isArray(dto.results) || dto.results.length === 0) {
      throw new BadRequestException(
        'At least one laboratory result is required',
      );
    }

    if (dto.results.length > 100) {
      throw new BadRequestException(
        'A maximum of 100 results can be submitted in one batch',
      );
    }

    const results: Awaited<
      ReturnType<LaboratoryResultsService['createResult']>
    >[] = [];

    for (const item of dto.results) {
      results.push(await this.createResult(item));
    }

    return {
      total: results.length,
      results,
    };
  }

  async findByOrder(orderId: string, hospitalId?: string) {
    if (!orderId?.trim()) {
      throw new BadRequestException('Laboratory order ID is required');
    }

    const medplum = this.medplumService.getClient();

    const resources = await medplum.searchResources('Observation', {
      'based-on': `ServiceRequest/${orderId}`,
      category: LAB_CATEGORY_CODE,
      _count: '500',
    });

    return this.resultCollection(
      resources.filter(
        (resource) =>
          !hospitalId || this.mapResult(resource).hospitalId === hospitalId,
      ),
    );
  }

  async findByEncounter(encounterId: string, hospitalId?: string) {
    if (!encounterId?.trim()) {
      throw new BadRequestException('Encounter ID is required');
    }

    const medplum = this.medplumService.getClient();

    const resources = await medplum.searchResources('Observation', {
      encounter: `Encounter/${encounterId}`,
      category: LAB_CATEGORY_CODE,
      _count: '1000',
    });

    return this.resultCollection(
      resources.filter(
        (resource) =>
          !hospitalId || this.mapResult(resource).hospitalId === hospitalId,
      ),
    );
  }

  async findByPatient(patientId: string, hospitalId?: string) {
    if (!patientId?.trim()) {
      throw new BadRequestException('Patient ID is required');
    }

    const medplum = this.medplumService.getClient();

    try {
      await medplum.readResource('Patient', patientId);
    } catch {
      throw new NotFoundException('Patient not found');
    }

    const resources = await medplum.searchResources('Observation', {
      subject: `Patient/${patientId}`,
      category: LAB_CATEGORY_CODE,
      _count: '1000',
    });

    return this.resultCollection(
      resources.filter(
        (resource) =>
          !hospitalId || this.mapResult(resource).hospitalId === hospitalId,
      ),
    );
  }

  async findResult(resultId: string) {
    const result = await this.readResult(resultId);

    return this.mapResult(result);
  }

  async updateResult(resultId: string, dto: UpdateLabResultDto) {
    const medplum = this.medplumService.getClient();
    const result = await this.readResult(resultId);

    if (result.status === 'entered-in-error' || result.status === 'cancelled') {
      throw new BadRequestException(
        'Cancelled or entered-in-error results cannot be modified',
      );
    }

    const currentValue = result.valueQuantity?.value;

    const value = dto.value ?? currentValue;

    if (value === undefined) {
      throw new BadRequestException('Laboratory result value is required');
    }

    const currentUnit = result.valueQuantity?.unit ?? '';

    const unit = dto.unit?.trim() || currentUnit;

    if (!unit) {
      throw new BadRequestException('Laboratory result unit is required');
    }

    const currentLow = result.referenceRange?.[0]?.low?.value;

    const currentHigh = result.referenceRange?.[0]?.high?.value;

    const referenceLow = dto.referenceLow ?? currentLow;

    const referenceHigh = dto.referenceHigh ?? currentHigh;

    const currentCriticalLow = this.getDecimalExtension(
      result,
      'http://hospital-ehr.local/fhir/StructureDefinition/critical-low',
    );

    const currentCriticalHigh = this.getDecimalExtension(
      result,
      'http://hospital-ehr.local/fhir/StructureDefinition/critical-high',
    );

    const criticalLow = dto.criticalLow ?? currentCriticalLow;

    const criticalHigh = dto.criticalHigh ?? currentCriticalHigh;

    const interpretation = this.calculateInterpretation(
      value,
      referenceLow,
      referenceHigh,
      criticalLow,
      criticalHigh,
    );

    const status = dto.status ?? result.status;

    this.validateStatus(status);

    const updated: Observation = {
      ...result,

      status,

      valueQuantity: {
        ...result.valueQuantity,
        value,
        unit,
      },

      referenceRange:
        referenceLow !== undefined || referenceHigh !== undefined
          ? [
              {
                low:
                  referenceLow !== undefined
                    ? {
                        value: referenceLow,
                        unit,
                      }
                    : undefined,
                high:
                  referenceHigh !== undefined
                    ? {
                        value: referenceHigh,
                        unit,
                      }
                    : undefined,
              },
            ]
          : undefined,

      interpretation: [
        {
          coding: [
            {
              system: INTERPRETATION_SYSTEM,
              code: interpretation,
              display: this.interpretationDisplay(interpretation),
            },
          ],
          text: this.interpretationDisplay(interpretation),
        },
      ],

      effectiveDateTime: dto.performedAt ?? result.effectiveDateTime,

      issued: new Date().toISOString(),

      performer:
        dto.performerId || dto.performerName
          ? [
              dto.performerId
                ? {
                    reference: `Practitioner/${dto.performerId}`,
                    display: dto.performerName,
                  }
                : {
                    display: dto.performerName,
                  },
            ]
          : result.performer,

      note: dto.note?.trim()
        ? [
            ...(result.note ?? []),
            {
              text: dto.note.trim(),
            },
          ]
        : result.note,

      extension: [
        ...(result.extension ?? []).filter(
          (extension) =>
            extension.url !==
              'http://hospital-ehr.local/fhir/StructureDefinition/critical-low' &&
            extension.url !==
              'http://hospital-ehr.local/fhir/StructureDefinition/critical-high',
        ),
        ...(criticalLow !== undefined
          ? [
              {
                url: 'http://hospital-ehr.local/fhir/StructureDefinition/critical-low',
                valueDecimal: criticalLow,
              },
            ]
          : []),
        ...(criticalHigh !== undefined
          ? [
              {
                url: 'http://hospital-ehr.local/fhir/StructureDefinition/critical-high',
                valueDecimal: criticalHigh,
              },
            ]
          : []),
      ],
    };

    const saved = await medplum.updateResource(updated);

    return this.mapResult(saved);
  }

  async validateTechnical(resultId: string, dto: ValidateLabResultDto) {
    const result = await this.readResult(resultId);
    this.assertHospital(result, dto.hospitalId);
    this.requireValidator(dto);
    if (
      !['registered', 'preliminary', 'amended', 'corrected'].includes(
        result.status,
      )
    ) {
      throw new ConflictException(
        `Result status ${result.status} cannot be technically validated`,
      );
    }
    if (this.extension(result, TECHNICAL_VALIDATION))
      throw new ConflictException('Technical validation is already recorded');
    result.extension = [
      ...(result.extension ?? []),
      {
        url: TECHNICAL_VALIDATION,
        extension: [
          {
            url: 'validator',
            valueReference: dto.validatorId
              ? {
                  reference: `Practitioner/${dto.validatorId}`,
                  display: dto.validatorName.trim(),
                }
              : { display: dto.validatorName.trim() },
          },
          { url: 'validatedAt', valueDateTime: new Date().toISOString() },
          ...(dto.comment?.trim()
            ? [{ url: 'comment', valueString: dto.comment.trim() }]
            : []),
        ],
      },
    ];
    result.status = 'preliminary';
    return this.mapResult(
      await this.medplumService.getClient().updateResource(result),
    );
  }

  async validateClinical(resultId: string, dto: ValidateLabResultDto) {
    const result = await this.readResult(resultId);
    this.assertHospital(result, dto.hospitalId);
    this.requireValidator(dto);
    if (!this.extension(result, TECHNICAL_VALIDATION))
      throw new ConflictException(
        'Technical validation is required before clinical validation',
      );
    if (this.extension(result, CLINICAL_VALIDATION))
      throw new ConflictException('Clinical validation is already recorded');
    result.extension = [
      ...(result.extension ?? []),
      {
        url: CLINICAL_VALIDATION,
        extension: [
          {
            url: 'validator',
            valueReference: dto.validatorId
              ? {
                  reference: `Practitioner/${dto.validatorId}`,
                  display: dto.validatorName.trim(),
                }
              : { display: dto.validatorName.trim() },
          },
          { url: 'validatedAt', valueDateTime: new Date().toISOString() },
          ...(dto.comment?.trim()
            ? [{ url: 'comment', valueString: dto.comment.trim() }]
            : []),
        ],
      },
    ];
    result.status = 'final';
    result.issued = new Date().toISOString();
    const saved = await this.medplumService.getClient().updateResource(result);
    if (this.isCritical(saved))
      await this.createCriticalAlert(saved, dto.hospitalId);
    return this.mapResult(saved);
  }

  async acknowledgeCritical(
    resultId: string,
    dto: AcknowledgeCriticalResultDto,
  ) {
    const result = await this.readResult(resultId);
    this.assertHospital(result, dto.hospitalId);
    if (!this.isCritical(result))
      throw new BadRequestException('Result is not critical');
    if (!dto.notifiedPersonName?.trim() || !dto.acknowledgedByName?.trim())
      throw new BadRequestException(
        'Notified person and acknowledger are required',
      );
    if (
      !['doctor', 'nurse'].includes(dto.notifiedRole) ||
      !['phone', 'in-person', 'system'].includes(dto.notificationMethod)
    )
      throw new BadRequestException('Invalid critical notification details');
    if (!dto.readBackConfirmed)
      throw new BadRequestException('Read-back confirmation is required');
    if (this.extension(result, CRITICAL_ACKNOWLEDGEMENT))
      throw new ConflictException(
        'Critical result acknowledgement is already recorded',
      );
    const timestamp = new Date().toISOString();
    result.extension = [
      ...(result.extension ?? []),
      {
        url: CRITICAL_ACKNOWLEDGEMENT,
        extension: [
          {
            url: 'notifiedPerson',
            valueReference: dto.notifiedPersonId
              ? {
                  reference: `Practitioner/${dto.notifiedPersonId}`,
                  display: dto.notifiedPersonName.trim(),
                }
              : { display: dto.notifiedPersonName.trim() },
          },
          { url: 'notifiedRole', valueCode: dto.notifiedRole },
          { url: 'method', valueCode: dto.notificationMethod },
          { url: 'readBackConfirmed', valueBoolean: true },
          {
            url: 'acknowledgedBy',
            valueReference: dto.acknowledgedById
              ? {
                  reference: `Practitioner/${dto.acknowledgedById}`,
                  display: dto.acknowledgedByName.trim(),
                }
              : { display: dto.acknowledgedByName.trim() },
          },
          { url: 'timestamp', valueDateTime: timestamp },
          ...(dto.comment?.trim()
            ? [{ url: 'comment', valueString: dto.comment.trim() }]
            : []),
        ],
      },
    ];
    await this.medplumService.getClient().updateResource(result);
    const tasks = await this.medplumService
      .getClient()
      .searchResources('Task', {
        focus: `Observation/${resultId}`,
        _count: '20',
      });
    for (const task of tasks.filter(
      (item) =>
        item.code?.coding?.some(
          (coding) => coding.code === 'critical-lab-result',
        ) && item.status !== 'completed',
    )) {
      task.status = 'completed';
      task.executionPeriod = { ...task.executionPeriod, end: timestamp };
      await this.medplumService.getClient().updateResource(task);
    }
    return {
      resultId,
      status: 'acknowledged',
      readBackConfirmed: true,
      notifiedPersonName: dto.notifiedPersonName,
      notifiedRole: dto.notifiedRole,
      acknowledgedByName: dto.acknowledgedByName,
      timestamp,
    };
  }

  private async validateResultContext(dto: CreateLabResultDto) {
    this.validateCreateDto(dto);

    const medplum = this.medplumService.getClient();

    let patient: Patient;
    let encounter: Encounter;
    let order: ServiceRequest;
    let specimen: Specimen;

    try {
      patient = await medplum.readResource('Patient', dto.patientId);
    } catch {
      throw new NotFoundException('Patient not found');
    }

    try {
      encounter = await medplum.readResource('Encounter', dto.encounterId);
    } catch {
      throw new NotFoundException('Encounter not found');
    }

    try {
      order = await medplum.readResource('ServiceRequest', dto.orderId);
    } catch {
      throw new NotFoundException('Laboratory order not found');
    }

    try {
      specimen = await medplum.readResource('Specimen', dto.specimenId);
    } catch {
      throw new NotFoundException('Specimen not found');
    }

    if (encounter.subject?.reference !== `Patient/${dto.patientId}`) {
      throw new BadRequestException(
        'Encounter does not belong to this patient',
      );
    }

    if (order.subject?.reference !== `Patient/${dto.patientId}`) {
      throw new BadRequestException(
        'Laboratory order does not belong to this patient',
      );
    }

    if (
      order.encounter?.reference &&
      order.encounter.reference !== `Encounter/${dto.encounterId}`
    ) {
      throw new BadRequestException(
        'Laboratory order does not belong to this encounter',
      );
    }

    const specimenPatientId = this.extractReferenceId(
      specimen.subject?.reference,
      'Patient',
    );

    if (specimenPatientId !== dto.patientId) {
      throw new BadRequestException('Specimen does not belong to this patient');
    }

    const specimenOrderIds = (specimen.request ?? [])
      .map((request) =>
        this.extractReferenceId(request.reference, 'ServiceRequest'),
      )
      .filter(Boolean);

    if (!specimenOrderIds.includes(dto.orderId)) {
      throw new BadRequestException(
        'Specimen does not belong to this laboratory order',
      );
    }

    const encounterHospitalId = this.extractReferenceId(
      encounter.serviceProvider?.reference,
      'Organization',
    );

    if (encounterHospitalId && encounterHospitalId !== dto.hospitalId) {
      throw new BadRequestException(
        'Encounter does not belong to this hospital',
      );
    }

    const patientHospitalId = this.extractReferenceId(
      patient.managingOrganization?.reference,
      'Organization',
    );

    if (patientHospitalId && patientHospitalId !== dto.hospitalId) {
      throw new BadRequestException('Patient does not belong to this hospital');
    }

    if (
      specimen.status === 'unsatisfactory' ||
      specimen.status === 'unavailable' ||
      specimen.status === 'entered-in-error'
    ) {
      throw new BadRequestException(
        'Laboratory results cannot be entered for this specimen status',
      );
    }
  }

  private validateCreateDto(dto: CreateLabResultDto) {
    const required = [
      ['orderId', dto.orderId],
      ['specimenId', dto.specimenId],
      ['patientId', dto.patientId],
      ['encounterId', dto.encounterId],
      ['hospitalId', dto.hospitalId],
      ['testCode', dto.testCode],
      ['testName', dto.testName],
      ['unit', dto.unit],
    ];

    for (const [name, value] of required) {
      if (typeof value !== 'string' || !value.trim()) {
        throw new BadRequestException(`${name} is required`);
      }
    }

    if (typeof dto.value !== 'number' || !Number.isFinite(dto.value)) {
      throw new BadRequestException(
        'Laboratory result value must be a finite number',
      );
    }

    this.validateRanges(
      dto.referenceLow,
      dto.referenceHigh,
      dto.criticalLow,
      dto.criticalHigh,
    );

    if (dto.status) {
      this.validateStatus(dto.status);
    }
  }

  private validateRanges(
    referenceLow?: number,
    referenceHigh?: number,
    criticalLow?: number,
    criticalHigh?: number,
  ) {
    const values = [referenceLow, referenceHigh, criticalLow, criticalHigh];

    if (
      values.some((value) => value !== undefined && !Number.isFinite(value))
    ) {
      throw new BadRequestException(
        'Reference and critical limits must be finite numbers',
      );
    }

    if (
      referenceLow !== undefined &&
      referenceHigh !== undefined &&
      referenceLow > referenceHigh
    ) {
      throw new BadRequestException(
        'Reference low cannot be greater than reference high',
      );
    }

    if (
      criticalLow !== undefined &&
      referenceLow !== undefined &&
      criticalLow > referenceLow
    ) {
      throw new BadRequestException(
        'Critical low cannot be greater than reference low',
      );
    }

    if (
      criticalHigh !== undefined &&
      referenceHigh !== undefined &&
      criticalHigh < referenceHigh
    ) {
      throw new BadRequestException(
        'Critical high cannot be less than reference high',
      );
    }
  }

  private validateStatus(status: string) {
    const allowed: LabResultStatus[] = [
      'registered',
      'preliminary',
      'final',
      'amended',
      'corrected',
      'cancelled',
      'entered-in-error',
      'unknown',
    ];

    if (!allowed.includes(status as LabResultStatus)) {
      throw new BadRequestException('Invalid laboratory result status');
    }
  }

  private calculateInterpretation(
    value: number,
    referenceLow?: number,
    referenceHigh?: number,
    criticalLow?: number,
    criticalHigh?: number,
  ): InterpretationCode {
    if (criticalLow !== undefined && value < criticalLow) {
      return 'LL';
    }

    if (criticalHigh !== undefined && value > criticalHigh) {
      return 'HH';
    }

    if (referenceLow !== undefined && value < referenceLow) {
      return 'L';
    }

    if (referenceHigh !== undefined && value > referenceHigh) {
      return 'H';
    }

    return 'N';
  }

  private interpretationDisplay(code: InterpretationCode) {
    const display: Record<InterpretationCode, string> = {
      N: 'Normal',
      L: 'Low',
      H: 'High',
      LL: 'Critical Low',
      HH: 'Critical High',
    };

    return display[code];
  }

  private resultCollection(resources: Observation[]) {
    const results = resources
      .filter((resource) => this.isLaboratoryResult(resource))
      .map((resource) => this.mapResult(resource))
      .sort(
        (a, b) => this.dateValue(b.performedAt) - this.dateValue(a.performedAt),
      );

    return {
      total: results.length,
      criticalCount: results.filter(
        (result) =>
          result.interpretation === 'LL' || result.interpretation === 'HH',
      ).length,
      abnormalCount: results.filter((result) => result.interpretation !== 'N')
        .length,
      results,
    };
  }

  private async readResult(resultId: string): Promise<Observation> {
    if (!resultId?.trim()) {
      throw new BadRequestException('Laboratory result ID is required');
    }

    const medplum = this.medplumService.getClient();

    try {
      const result = await medplum.readResource('Observation', resultId);

      if (!this.isLaboratoryResult(result)) {
        throw new NotFoundException('Laboratory result not found');
      }

      return result;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      throw new NotFoundException('Laboratory result not found');
    }
  }

  private isLaboratoryResult(resource: Observation) {
    return (
      resource.category?.some((category) =>
        category.coding?.some((coding) => coding.code === LAB_CATEGORY_CODE),
      ) ?? false
    );
  }

  private mapResult(resource: Observation) {
    const hospitalId = resource.extension
      ?.find((extension) => extension.url === HOSPITAL_EXTENSION_URL)
      ?.valueReference?.reference?.replace('Organization/', '');

    const criticalLow = this.getDecimalExtension(
      resource,
      'http://hospital-ehr.local/fhir/StructureDefinition/critical-low',
    );

    const criticalHigh = this.getDecimalExtension(
      resource,
      'http://hospital-ehr.local/fhir/StructureDefinition/critical-high',
    );

    return {
      id: resource.id,
      resourceType: resource.resourceType,
      status: resource.status,

      testCode: resource.code?.coding?.[0]?.code,

      testName:
        resource.code?.text ??
        resource.code?.coding?.[0]?.display ??
        'Laboratory Test',

      value: resource.valueQuantity?.value,

      unit: resource.valueQuantity?.unit,

      referenceLow: resource.referenceRange?.[0]?.low?.value,

      referenceHigh: resource.referenceRange?.[0]?.high?.value,

      criticalLow,
      criticalHigh,

      interpretation: resource.interpretation?.[0]?.coding?.[0]?.code ?? 'N',

      interpretationDisplay:
        resource.interpretation?.[0]?.text ??
        resource.interpretation?.[0]?.coding?.[0]?.display ??
        'Normal',

      patientId: this.extractReferenceId(
        resource.subject?.reference,
        'Patient',
      ),

      encounterId: this.extractReferenceId(
        resource.encounter?.reference,
        'Encounter',
      ),

      orderId: this.extractReferenceId(
        resource.basedOn?.[0]?.reference,
        'ServiceRequest',
      ),

      specimenId: this.extractReferenceId(
        resource.specimen?.reference,
        'Specimen',
      ),

      hospitalId,

      performedAt: resource.effectiveDateTime,

      issuedAt: resource.issued,

      performerId: this.extractReferenceId(
        resource.performer?.[0]?.reference,
        'Practitioner',
      ),

      performerName: resource.performer?.[0]?.display,

      notes: resource.note?.map((note) => note.text).filter(Boolean) ?? [],

      technicalValidated: Boolean(
        this.extension(resource, TECHNICAL_VALIDATION),
      ),
      clinicalValidated: Boolean(this.extension(resource, CLINICAL_VALIDATION)),
      criticalAcknowledged: Boolean(
        this.extension(resource, CRITICAL_ACKNOWLEDGEMENT),
      ),
    };
  }

  private requireValidator(dto: ValidateLabResultDto) {
    if (!dto.hospitalId?.trim() || !dto.validatorName?.trim())
      throw new BadRequestException('Hospital and validator are required');
  }

  private assertHospital(result: Observation, hospitalId: string) {
    const scoped = result.extension?.find(
      (item) => item.url === HOSPITAL_EXTENSION_URL,
    )?.valueReference?.reference;
    if (!hospitalId || scoped !== `Organization/${hospitalId}`)
      throw new NotFoundException('Laboratory result not found');
  }

  private extension(result: Observation, url: string) {
    return result.extension?.find((item) => item.url === url);
  }

  private isCritical(result: Observation) {
    const code = result.interpretation?.[0]?.coding?.[0]?.code;
    return code === 'LL' || code === 'HH';
  }

  private async createCriticalAlert(result: Observation, hospitalId: string) {
    const existing = await this.medplumService
      .getClient()
      .searchResources('Task', {
        focus: `Observation/${result.id}`,
        _count: '20',
      });
    if (
      existing.some(
        (item) =>
          item.code?.coding?.some(
            (coding) => coding.code === 'critical-lab-result',
          ) && ['ready', 'in-progress'].includes(item.status),
      )
    )
      return;
    const task: Task = {
      resourceType: 'Task',
      status: 'ready',
      intent: 'order',
      priority: 'stat',
      code: {
        coding: [
          {
            system: 'http://hospital-ehr.local/fhir/CodeSystem/workflow-task',
            code: 'critical-lab-result',
            display: 'Critical laboratory result notification',
          },
        ],
      },
      focus: {
        reference: `Observation/${result.id}`,
        display: result.code?.text,
      },
      for: result.subject,
      encounter: result.encounter,
      authoredOn: new Date().toISOString(),
      owner: { reference: `Organization/${hospitalId}` },
      description:
        'Notify the responsible doctor or nurse and record read-back confirmation.',
    };
    await this.medplumService.getClient().createResource<Task>(task);
  }

  private getDecimalExtension(resource: Observation, url: string) {
    return resource.extension?.find((extension) => extension.url === url)
      ?.valueDecimal;
  }

  private extractReferenceId(
    reference: string | undefined,
    resourceType: string,
  ) {
    if (!reference) {
      return undefined;
    }

    const prefix = `${resourceType}/`;

    if (!reference.startsWith(prefix)) {
      return undefined;
    }

    return reference.slice(prefix.length);
  }

  private dateValue(value?: string) {
    if (!value) {
      return 0;
    }

    const timestamp = new Date(value).getTime();

    return Number.isNaN(timestamp) ? 0 : timestamp;
  }
}
