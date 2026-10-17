import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type {
  DiagnosticReport,
  Encounter,
  Observation,
  Patient,
  ServiceRequest,
  Specimen,
} from '@medplum/fhirtypes';

import { MedplumService } from '../medplum/medplum.service';
import { CreateLabReportDto } from './dto/create-lab-report.dto';
import { FinalizeLabReportDto } from './dto/finalize-lab-report.dto';

const LAB_CATEGORY_SYSTEM = 'http://terminology.hl7.org/CodeSystem/v2-0074';

const LAB_CATEGORY_CODE = 'LAB';

const LOCAL_LAB_CODE_SYSTEM =
  'http://hospital-ehr.local/fhir/CodeSystem/laboratory-tests';

const HOSPITAL_EXTENSION_URL =
  'http://hospital-ehr.local/fhir/StructureDefinition/hospital';

const VERIFIED_BY_EXTENSION_URL =
  'http://hospital-ehr.local/fhir/StructureDefinition/verified-by';

const LAB_EXTENSION_BASE = 'http://hospital-ehr.local/fhir/StructureDefinition';
const TECHNICAL_VALIDATION_EXTENSION_URL = `${LAB_EXTENSION_BASE}/technical-validation`;
const CLINICAL_VALIDATION_EXTENSION_URL = `${LAB_EXTENSION_BASE}/clinical-validation`;
const CRITICAL_ACKNOWLEDGEMENT_EXTENSION_URL = `${LAB_EXTENSION_BASE}/critical-acknowledgement`;

@Injectable()
export class LaboratoryReportsService {
  constructor(private readonly medplumService: MedplumService) {}

  async createReport(dto: CreateLabReportDto) {
    this.validateCreateDto(dto);

    const medplum = this.medplumService.getClient();

    const patient = await this.readPatient(dto.patientId);
    const encounter = await this.readEncounter(dto.encounterId);
    const order = await this.readOrder(dto.orderId);

    this.validateContext(
      patient,
      encounter,
      order,
      dto.patientId,
      dto.encounterId,
      dto.hospitalId,
    );

    const existing = await medplum.searchResources('DiagnosticReport', {
      'based-on': `ServiceRequest/${dto.orderId}`,
      _count: '100',
    });

    const activeExisting = existing.find(
      (report) =>
        this.isLaboratoryReport(report) &&
        report.status !== 'cancelled' &&
        report.status !== 'entered-in-error',
    );

    if (activeExisting) {
      throw new BadRequestException(
        'A laboratory report already exists for this order',
      );
    }

    const observations = dto.resultIds?.length
      ? await this.readResults(dto.resultIds)
      : await this.findResultsForOrder(dto.orderId);

    if (!observations.length) {
      throw new BadRequestException(
        'Cannot create a laboratory report without result observations',
      );
    }

    this.validateResults(
      observations,
      dto.orderId,
      dto.patientId,
      dto.encounterId,
    );

    const specimens = dto.specimenIds?.length
      ? await this.readSpecimens(dto.specimenIds)
      : await this.findSpecimensForOrder(dto.orderId);

    this.validateSpecimens(specimens, dto.orderId, dto.patientId);

    const testCode = order.code?.coding?.[0]?.code ?? 'LAB';

    const testName =
      order.code?.text ??
      order.code?.coding?.[0]?.display ??
      'Laboratory Report';

    const report: DiagnosticReport = {
      resourceType: 'DiagnosticReport',

      status: 'preliminary',

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
            system: order.code?.coding?.[0]?.system ?? LOCAL_LAB_CODE_SYSTEM,
            code: testCode,
            display: testName,
          },
        ],
        text: testName,
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

      specimen: specimens
        .filter((specimen) => Boolean(specimen.id))
        .map((specimen) => ({
          reference: `Specimen/${specimen.id}`,
        })),

      result: observations
        .filter((observation) => Boolean(observation.id))
        .map((observation) => ({
          reference: `Observation/${observation.id}`,
        })),

      effectiveDateTime:
        this.latestEffectiveDate(observations) ?? new Date().toISOString(),

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
          : [
              {
                reference: `Organization/${dto.hospitalId}`,
              },
            ],

      conclusion: dto.conclusion?.trim() || undefined,

      extension: [
        {
          url: HOSPITAL_EXTENSION_URL,
          valueReference: {
            reference: `Organization/${dto.hospitalId}`,
          },
        },
      ],
    };

    const created = await medplum.createResource(report);

    return this.mapReport(created);
  }

  async findReport(reportId: string) {
    const report = await this.readReport(reportId);

    return this.mapReport(report);
  }

  async findByOrder(orderId: string, hospitalId?: string) {
    if (!orderId?.trim()) {
      throw new BadRequestException('Laboratory order ID is required');
    }

    const medplum = this.medplumService.getClient();

    const resources = await medplum.searchResources('DiagnosticReport', {
      'based-on': `ServiceRequest/${orderId}`,
      _count: '100',
    });

    return this.reportCollection(
      resources.filter(
        (resource) =>
          !hospitalId || this.mapReport(resource).hospitalId === hospitalId,
      ),
    );
  }

  async findByEncounter(encounterId: string, hospitalId?: string) {
    if (!encounterId?.trim()) {
      throw new BadRequestException('Encounter ID is required');
    }

    const medplum = this.medplumService.getClient();

    const resources = await medplum.searchResources('DiagnosticReport', {
      encounter: `Encounter/${encounterId}`,
      _count: '500',
    });

    return this.reportCollection(
      resources.filter(
        (resource) =>
          !hospitalId || this.mapReport(resource).hospitalId === hospitalId,
      ),
    );
  }

  async findByPatient(patientId: string, hospitalId?: string) {
    if (!patientId?.trim()) {
      throw new BadRequestException('Patient ID is required');
    }

    await this.readPatient(patientId);

    const medplum = this.medplumService.getClient();

    const resources = await medplum.searchResources('DiagnosticReport', {
      subject: `Patient/${patientId}`,
      _count: '500',
    });

    return this.reportCollection(
      resources.filter(
        (resource) =>
          !hospitalId || this.mapReport(resource).hospitalId === hospitalId,
      ),
    );
  }

  async finalizeReport(reportId: string, dto: FinalizeLabReportDto) {
    const medplum = this.medplumService.getClient();

    const report = await this.readReport(reportId);

    if (report.status === 'cancelled' || report.status === 'entered-in-error') {
      throw new BadRequestException(
        `Cannot finalize report with status ${report.status}`,
      );
    }

    if (
      report.status === 'final' ||
      report.status === 'amended' ||
      report.status === 'corrected'
    ) {
      return this.mapReport(report);
    }

    const observations = await this.readReportObservations(report);

    if (!observations.length) {
      throw new BadRequestException(
        'Laboratory report has no result observations',
      );
    }

    const invalidResults = observations.filter(
      (observation) =>
        observation.status === 'cancelled' ||
        observation.status === 'entered-in-error',
    );

    if (invalidResults.length) {
      throw new BadRequestException(
        'Cancelled or entered-in-error observations cannot be finalized',
      );
    }

    const missingTechnicalValidation = observations.filter(
      (observation) =>
        !observation.extension?.some(
          (extension) => extension.url === TECHNICAL_VALIDATION_EXTENSION_URL,
        ),
    );
    if (missingTechnicalValidation.length) {
      throw new ConflictException({
        code: 'LAB_TECHNICAL_VALIDATION_REQUIRED',
        message:
          'All laboratory results require technical validation before report finalization',
        resultIds: missingTechnicalValidation.map(
          (observation) => observation.id,
        ),
      });
    }

    const missingClinicalValidation = observations.filter(
      (observation) =>
        !observation.extension?.some(
          (extension) => extension.url === CLINICAL_VALIDATION_EXTENSION_URL,
        ),
    );
    if (missingClinicalValidation.length) {
      throw new ConflictException({
        code: 'LAB_CLINICAL_VALIDATION_REQUIRED',
        message:
          'All laboratory results require clinical validation before report finalization',
        resultIds: missingClinicalValidation.map(
          (observation) => observation.id,
        ),
      });
    }

    const unacknowledgedCriticalResults = observations.filter((observation) => {
      const interpretation = observation.interpretation?.[0]?.coding?.[0]?.code;
      const critical = interpretation === 'LL' || interpretation === 'HH';
      return (
        critical &&
        !observation.extension?.some(
          (extension) =>
            extension.url === CRITICAL_ACKNOWLEDGEMENT_EXTENSION_URL,
        )
      );
    });
    if (unacknowledgedCriticalResults.length) {
      throw new ConflictException({
        code: 'LAB_CRITICAL_ACKNOWLEDGEMENT_REQUIRED',
        message:
          'Critical results require notification and read-back acknowledgement before report finalization',
        resultIds: unacknowledgedCriticalResults.map(
          (observation) => observation.id,
        ),
      });
    }

    // NOTE:
    // These updates are sequential and are not transactionally atomic.
    // A FHIR transaction Bundle can replace this later.
    for (const observation of observations) {
      if (
        observation.status !== 'final' &&
        observation.status !== 'amended' &&
        observation.status !== 'corrected'
      ) {
        await medplum.updateResource<Observation>({
          ...observation,
          status: 'final',
        });
      }
    }

    const extension = this.withVerifierExtension(
      report.extension ?? [],
      dto.verifierId,
      dto.verifierName,
    );

    const updated = await medplum.updateResource<DiagnosticReport>({
      ...report,
      status: 'final',
      issued: new Date().toISOString(),
      conclusion: dto.conclusion?.trim() || report.conclusion,
      extension,
    });

    const orderId = this.extractReferenceId(
      updated.basedOn?.[0]?.reference,
      'ServiceRequest',
    );

    if (orderId) {
      try {
        const order = await medplum.readResource('ServiceRequest', orderId);

        if (
          order.status !== 'completed' &&
          order.status !== 'revoked' &&
          order.status !== 'entered-in-error'
        ) {
          await medplum.updateResource<ServiceRequest>({
            ...order,
            status: 'completed',
          });
        }
      } catch {
        // Do not roll back the finalized DiagnosticReport
        // if order status synchronization fails.
      }
    }

    return this.mapReport(updated);
  }

  async amendReport(reportId: string, dto: FinalizeLabReportDto) {
    const medplum = this.medplumService.getClient();

    const report = await this.readReport(reportId);

    if (
      report.status !== 'final' &&
      report.status !== 'amended' &&
      report.status !== 'corrected'
    ) {
      throw new BadRequestException(
        'Only a finalized laboratory report can be amended',
      );
    }

    if (!dto.conclusion?.trim()) {
      throw new BadRequestException('Amended report conclusion is required');
    }

    const extension = this.withVerifierExtension(
      report.extension ?? [],
      dto.verifierId,
      dto.verifierName,
    );

    const updated = await medplum.updateResource<DiagnosticReport>({
      ...report,
      status: 'amended',
      issued: new Date().toISOString(),
      conclusion: dto.conclusion.trim(),
      extension,
    });

    return this.mapReport(updated);
  }

  private async readReport(reportId: string): Promise<DiagnosticReport> {
    if (!reportId?.trim()) {
      throw new BadRequestException('Laboratory report ID is required');
    }

    const medplum = this.medplumService.getClient();

    try {
      const report = await medplum.readResource('DiagnosticReport', reportId);

      if (!this.isLaboratoryReport(report)) {
        throw new NotFoundException('Laboratory report not found');
      }

      return report;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      throw new NotFoundException('Laboratory report not found');
    }
  }

  private async readPatient(patientId: string): Promise<Patient> {
    const medplum = this.medplumService.getClient();

    try {
      return await medplum.readResource('Patient', patientId);
    } catch {
      throw new NotFoundException('Patient not found');
    }
  }

  private async readEncounter(encounterId: string): Promise<Encounter> {
    const medplum = this.medplumService.getClient();

    try {
      return await medplum.readResource('Encounter', encounterId);
    } catch {
      throw new NotFoundException('Encounter not found');
    }
  }

  private async readOrder(orderId: string): Promise<ServiceRequest> {
    const medplum = this.medplumService.getClient();

    try {
      return await medplum.readResource('ServiceRequest', orderId);
    } catch {
      throw new NotFoundException('Laboratory order not found');
    }
  }

  private async readResults(ids: string[]): Promise<Observation[]> {
    const medplum = this.medplumService.getClient();

    const results: Observation[] = [];

    for (const id of ids) {
      if (!id?.trim()) {
        continue;
      }

      try {
        results.push(await medplum.readResource('Observation', id));
      } catch {
        throw new NotFoundException(`Laboratory result not found: ${id}`);
      }
    }

    return results;
  }

  private async readSpecimens(ids: string[]): Promise<Specimen[]> {
    const medplum = this.medplumService.getClient();

    const specimens: Specimen[] = [];

    for (const id of ids) {
      if (!id?.trim()) {
        continue;
      }

      try {
        specimens.push(await medplum.readResource('Specimen', id));
      } catch {
        throw new NotFoundException(`Specimen not found: ${id}`);
      }
    }

    return specimens;
  }

  private async findResultsForOrder(orderId: string): Promise<Observation[]> {
    const medplum = this.medplumService.getClient();

    return medplum.searchResources('Observation', {
      'based-on': `ServiceRequest/${orderId}`,
      category: 'laboratory',
      _count: '500',
    });
  }

  private async findSpecimensForOrder(orderId: string): Promise<Specimen[]> {
    const medplum = this.medplumService.getClient();

    const order = await this.readOrder(orderId);

    const patientReference = order.subject?.reference;

    if (!patientReference || !patientReference.startsWith('Patient/')) {
      throw new BadRequestException(
        'Laboratory order does not contain a valid patient reference',
      );
    }

    // Specimen.request is a valid FHIR element, but "request"
    // is not a supported Specimen search parameter here.
    // Search by patient subject, then filter locally by order.
    const resources = await medplum.searchResources('Specimen', {
      subject: patientReference,
      _count: '500',
    });

    const orderReference = `ServiceRequest/${orderId}`;

    return resources.filter(
      (specimen) =>
        specimen.request?.some(
          (reference) => reference.reference === orderReference,
        ) ?? false,
    );
  }

  private async readReportObservations(
    report: DiagnosticReport,
  ): Promise<Observation[]> {
    const ids =
      report.result
        ?.map((reference) =>
          this.extractReferenceId(reference.reference, 'Observation'),
        )
        .filter((id): id is string => Boolean(id)) ?? [];

    return this.readResults(ids);
  }

  private validateCreateDto(dto: CreateLabReportDto) {
    if (!dto.orderId?.trim()) {
      throw new BadRequestException('Laboratory order ID is required');
    }

    if (!dto.patientId?.trim()) {
      throw new BadRequestException('Patient ID is required');
    }

    if (!dto.encounterId?.trim()) {
      throw new BadRequestException('Encounter ID is required');
    }

    if (!dto.hospitalId?.trim()) {
      throw new BadRequestException('Hospital ID is required');
    }
  }

  private validateContext(
    patient: Patient,
    encounter: Encounter,
    order: ServiceRequest,
    patientId: string,
    encounterId: string,
    hospitalId: string,
  ) {
    if (encounter.subject?.reference !== `Patient/${patientId}`) {
      throw new BadRequestException(
        'Encounter does not belong to this patient',
      );
    }

    if (order.subject?.reference !== `Patient/${patientId}`) {
      throw new BadRequestException(
        'Laboratory order does not belong to this patient',
      );
    }

    if (
      order.encounter?.reference &&
      order.encounter.reference !== `Encounter/${encounterId}`
    ) {
      throw new BadRequestException(
        'Laboratory order does not belong to this encounter',
      );
    }

    const encounterHospitalId = this.extractReferenceId(
      encounter.serviceProvider?.reference,
      'Organization',
    );

    if (encounterHospitalId && encounterHospitalId !== hospitalId) {
      throw new BadRequestException(
        'Encounter does not belong to this hospital',
      );
    }

    const patientHospitalId = this.extractReferenceId(
      patient.managingOrganization?.reference,
      'Organization',
    );

    if (patientHospitalId && patientHospitalId !== hospitalId) {
      throw new BadRequestException('Patient does not belong to this hospital');
    }
  }

  private validateResults(
    observations: Observation[],
    orderId: string,
    patientId: string,
    encounterId: string,
  ) {
    for (const observation of observations) {
      const isLaboratory =
        observation.category?.some((category) =>
          category.coding?.some((coding) => coding.code === 'laboratory'),
        ) ?? false;

      if (!isLaboratory) {
        throw new BadRequestException(
          `Observation ${observation.id ?? ''} is not a laboratory result`,
        );
      }

      const belongsToOrder =
        observation.basedOn?.some(
          (reference) => reference.reference === `ServiceRequest/${orderId}`,
        ) ?? false;

      if (!belongsToOrder) {
        throw new BadRequestException(
          `Result ${observation.id ?? ''} does not belong to this laboratory order`,
        );
      }

      if (observation.subject?.reference !== `Patient/${patientId}`) {
        throw new BadRequestException(
          `Result ${observation.id ?? ''} does not belong to this patient`,
        );
      }

      if (
        observation.encounter?.reference &&
        observation.encounter.reference !== `Encounter/${encounterId}`
      ) {
        throw new BadRequestException(
          `Result ${observation.id ?? ''} does not belong to this encounter`,
        );
      }
    }
  }

  private validateSpecimens(
    specimens: Specimen[],
    orderId: string,
    patientId: string,
  ) {
    for (const specimen of specimens) {
      const belongsToOrder =
        specimen.request?.some(
          (reference) => reference.reference === `ServiceRequest/${orderId}`,
        ) ?? false;

      if (!belongsToOrder) {
        throw new BadRequestException(
          `Specimen ${specimen.id ?? ''} does not belong to this laboratory order`,
        );
      }

      if (specimen.subject?.reference !== `Patient/${patientId}`) {
        throw new BadRequestException(
          `Specimen ${specimen.id ?? ''} does not belong to this patient`,
        );
      }
    }
  }

  private isLaboratoryReport(report: DiagnosticReport) {
    return (
      report.category?.some((category) =>
        category.coding?.some(
          (coding) =>
            coding.code === LAB_CATEGORY_CODE || coding.code === 'laboratory',
        ),
      ) ?? false
    );
  }

  private reportCollection(resources: DiagnosticReport[]) {
    const reports = resources
      .filter((resource) => this.isLaboratoryReport(resource))
      .map((resource) => this.mapReport(resource))
      .sort((a, b) => this.dateValue(b.issuedAt) - this.dateValue(a.issuedAt));

    return {
      total: reports.length,
      reports,
    };
  }

  private mapReport(report: DiagnosticReport) {
    const hospitalId = report.extension
      ?.find((extension) => extension.url === HOSPITAL_EXTENSION_URL)
      ?.valueReference?.reference?.replace('Organization/', '');

    const verifier = report.extension?.find(
      (extension) => extension.url === VERIFIED_BY_EXTENSION_URL,
    )?.valueReference;

    return {
      id: report.id,
      resourceType: report.resourceType,
      status: report.status,

      testCode: report.code?.coding?.[0]?.code,

      testName:
        report.code?.text ??
        report.code?.coding?.[0]?.display ??
        'Laboratory Report',

      patientId: this.extractReferenceId(report.subject?.reference, 'Patient'),

      encounterId: this.extractReferenceId(
        report.encounter?.reference,
        'Encounter',
      ),

      orderId: this.extractReferenceId(
        report.basedOn?.[0]?.reference,
        'ServiceRequest',
      ),

      hospitalId,

      specimenIds:
        report.specimen
          ?.map((reference) =>
            this.extractReferenceId(reference.reference, 'Specimen'),
          )
          .filter(Boolean) ?? [],

      resultIds:
        report.result
          ?.map((reference) =>
            this.extractReferenceId(reference.reference, 'Observation'),
          )
          .filter(Boolean) ?? [],

      performerId: this.extractReferenceId(
        report.performer?.[0]?.reference,
        'Practitioner',
      ),

      performerName: report.performer?.[0]?.display,

      verifierId: this.extractReferenceId(verifier?.reference, 'Practitioner'),

      verifierName: verifier?.display,

      effectiveAt: report.effectiveDateTime,

      issuedAt: report.issued,

      conclusion: report.conclusion,
    };
  }

  private withVerifierExtension(
    current: NonNullable<DiagnosticReport['extension']>,
    verifierId?: string,
    verifierName?: string,
  ) {
    const extension = current.filter(
      (item) => item.url !== VERIFIED_BY_EXTENSION_URL,
    );

    if (verifierId || verifierName) {
      extension.push({
        url: VERIFIED_BY_EXTENSION_URL,
        valueReference: verifierId
          ? {
              reference: `Practitioner/${verifierId}`,
              display: verifierName,
            }
          : {
              display: verifierName,
            },
      });
    }

    return extension;
  }

  private latestEffectiveDate(observations: Observation[]) {
    const values = observations
      .map((observation) => observation.effectiveDateTime ?? observation.issued)
      .filter((value): value is string => Boolean(value))
      .sort((a, b) => this.dateValue(b) - this.dateValue(a));

    return values[0];
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
