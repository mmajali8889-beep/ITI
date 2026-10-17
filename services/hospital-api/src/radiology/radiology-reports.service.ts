import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import type {
  DiagnosticReport,
  Encounter,
  Extension,
  Patient,
  ServiceRequest,
} from '@medplum/fhirtypes';

import { MedplumService } from '../medplum/medplum.service';
import { CreateRadiologyReportDto } from './dto/create-radiology-report.dto';
import { FinalizeRadiologyReportDto } from './dto/finalize-radiology-report.dto';
import { UpdateRadiologyReportDto } from './dto/update-radiology-report.dto';
import { RadiologyService } from './radiology.service';

const RADIOLOGY_CATEGORY_SYSTEM =
  'http://terminology.hl7.org/CodeSystem/v2-0074';
const RADIOLOGY_CATEGORY_CODE = 'RAD';

const RADIOLOGY_ORDER_CATEGORY_CODE = '363679005';

const LOCAL_RADIOLOGY_CODE_SYSTEM =
  'http://hospital-ehr.local/fhir/CodeSystem/radiology-procedures';

const HOSPITAL_EXTENSION_URL =
  'http://hospital-ehr.local/fhir/StructureDefinition/hospital';
const MODALITY_EXTENSION_URL =
  'http://hospital-ehr.local/fhir/StructureDefinition/radiology-modality';
const TECHNIQUE_EXTENSION_URL =
  'http://hospital-ehr.local/fhir/StructureDefinition/radiology-technique';
const COMPARISON_EXTENSION_URL =
  'http://hospital-ehr.local/fhir/StructureDefinition/radiology-comparison';
const FINDINGS_EXTENSION_URL =
  'http://hospital-ehr.local/fhir/StructureDefinition/radiology-findings';
const RECOMMENDATIONS_EXTENSION_URL =
  'http://hospital-ehr.local/fhir/StructureDefinition/radiology-recommendations';
const VERIFIED_BY_EXTENSION_URL =
  'http://hospital-ehr.local/fhir/StructureDefinition/verified-by';
const VERIFIED_AT_EXTENSION_URL =
  'http://hospital-ehr.local/fhir/StructureDefinition/verified-at';

@Injectable()
export class RadiologyReportsService {
  private readonly logger = new Logger(
    RadiologyReportsService.name,
  );

  constructor(
    private readonly medplumService: MedplumService,
    private readonly radiologyService: RadiologyService,
  ) {}

  async createReport(dto: CreateRadiologyReportDto) {
    this.validateCreateDto(dto);

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

    const existing = await this.findReportResourcesForOrder(dto.orderId);
    const activeExisting = existing.find(
      (report) =>
        this.isRadiologyReport(report) &&
        report.status !== 'cancelled' &&
        report.status !== 'entered-in-error',
    );

    if (activeExisting) {
      throw new BadRequestException(
        'A radiology report already exists for this order',
      );
    }

    const examCode =
      order.code?.coding?.[0]?.code ?? 'RAD';
    const examName =
      order.code?.text ??
      order.code?.coding?.[0]?.display ??
      'Radiology Report';

    const modality = this.orderModality(order);

    const report: DiagnosticReport = {
      resourceType: 'DiagnosticReport',
      status: 'preliminary',

      category: [
        {
          coding: [
            {
              system: RADIOLOGY_CATEGORY_SYSTEM,
              code: RADIOLOGY_CATEGORY_CODE,
              display: 'Radiology',
            },
          ],
          text: 'Radiology',
        },
      ],

      code: {
        coding: [
          {
            system:
              order.code?.coding?.[0]?.system ??
              LOCAL_RADIOLOGY_CODE_SYSTEM,
            code: examCode,
            display: examName,
          },
        ],
        text: examName,
      },

      subject: {
        reference: `Patient/${dto.patientId}`,
        display: this.patientDisplay(patient),
      },

      encounter: {
        reference: `Encounter/${dto.encounterId}`,
      },

      basedOn: [
        {
          reference: `ServiceRequest/${dto.orderId}`,
        },
      ],

      effectiveDateTime: new Date().toISOString(),
      issued: new Date().toISOString(),

      performer:
        dto.radiologistId || dto.radiologistName
          ? [
              dto.radiologistId
                ? {
                    reference:
                      `Practitioner/${dto.radiologistId}`,
                    display:
                      dto.radiologistName?.trim() || undefined,
                  }
                : {
                    display: dto.radiologistName?.trim(),
                  },
            ]
          : [
              {
                reference: `Organization/${dto.hospitalId}`,
              },
            ],

      conclusion:
        dto.impression?.trim() || undefined,

      extension: this.buildReportExtensions({
        hospitalId: dto.hospitalId,
        modality,
        technique: dto.technique,
        comparison: dto.comparison,
        findings: dto.findings,
        recommendations: dto.recommendations,
      }),
    };

    const medplum = this.medplumService.getClient();
    const created = await medplum.createResource(report);

    await this.syncWorkflowBestEffort(
      dto.orderId,
      'reporting',
    );
    await this.syncWorkflowBestEffort(dto.orderId, 'preliminary');

    return this.mapReport(created);
  }

  async findReport(reportId: string) {
    return this.mapReport(
      await this.readReport(reportId),
    );
  }

  async findByOrder(orderId: string) {
    if (!orderId?.trim()) {
      throw new BadRequestException(
        'Radiology order ID is required',
      );
    }

    await this.readOrder(orderId);

    return this.reportCollection(
      await this.findReportResourcesForOrder(orderId),
    );
  }

  async findByEncounter(encounterId: string) {
    if (!encounterId?.trim()) {
      throw new BadRequestException(
        'Encounter ID is required',
      );
    }

    const encounter = await this.readEncounter(encounterId);
    const patientId = this.extractReferenceId(
      encounter.subject?.reference,
      'Patient',
    );

    if (!patientId) {
      return { total: 0, reports: [] };
    }

    const medplum = this.medplumService.getClient();
    const resources = await medplum.searchResources(
      'DiagnosticReport',
      {
        subject: `Patient/${patientId}`,
        _count: '500',
      },
    );

    const encounterReference = `Encounter/${encounterId}`;

    return this.reportCollection(
      resources.filter(
        (report) =>
          report.encounter?.reference === encounterReference,
      ),
    );
  }

  async findByPatient(patientId: string) {
    if (!patientId?.trim()) {
      throw new BadRequestException(
        'Patient ID is required',
      );
    }

    await this.readPatient(patientId);

    const medplum = this.medplumService.getClient();
    const resources = await medplum.searchResources(
      'DiagnosticReport',
      {
        subject: `Patient/${patientId}`,
        _count: '500',
      },
    );

    return this.reportCollection(resources);
  }

  async updateReport(
    reportId: string,
    dto: UpdateRadiologyReportDto,
  ) {
    const report = await this.readReport(reportId);

    if (
      report.status === 'final' ||
      report.status === 'amended' ||
      report.status === 'corrected'
    ) {
      throw new BadRequestException(
        'Finalized radiology reports must be amended rather than edited',
      );
    }

    if (
      report.status === 'cancelled' ||
      report.status === 'entered-in-error'
    ) {
      throw new BadRequestException(
        `Cannot edit report with status ${report.status}`,
      );
    }

    const hospitalId = this.extensionReferenceId(
      report.extension,
      HOSPITAL_EXTENSION_URL,
      'Organization',
    );

    const modality = this.extensionValueString(
      report.extension,
      MODALITY_EXTENSION_URL,
    );

    const extension = this.buildReportExtensions({
      hospitalId,
      modality,
      technique:
        dto.technique !== undefined
          ? dto.technique
          : this.extensionValueString(
              report.extension,
              TECHNIQUE_EXTENSION_URL,
            ),
      comparison:
        dto.comparison !== undefined
          ? dto.comparison
          : this.extensionValueString(
              report.extension,
              COMPARISON_EXTENSION_URL,
            ),
      findings:
        dto.findings !== undefined
          ? dto.findings
          : this.extensionValueString(
              report.extension,
              FINDINGS_EXTENSION_URL,
            ),
      recommendations:
        dto.recommendations !== undefined
          ? dto.recommendations
          : this.extensionValueString(
              report.extension,
              RECOMMENDATIONS_EXTENSION_URL,
            ),
    });

    const medplum = this.medplumService.getClient();
    const updated = await medplum.updateResource<DiagnosticReport>({
      ...report,
      status: 'preliminary',
      issued: new Date().toISOString(),
      conclusion:
        dto.impression !== undefined
          ? this.clean(dto.impression)
          : report.conclusion,
      performer:
        dto.radiologistId || dto.radiologistName
          ? [
              dto.radiologistId
                ? {
                    reference:
                      `Practitioner/${dto.radiologistId}`,
                    display:
                      dto.radiologistName?.trim() || undefined,
                  }
                : {
                    display: dto.radiologistName?.trim(),
                  },
            ]
          : report.performer,
      extension: this.mergePreservedExtensions(
        report.extension,
        extension,
      ),
    });

    const orderId = this.extractReferenceId(
      updated.basedOn?.[0]?.reference,
      'ServiceRequest',
    );

    await this.syncWorkflowBestEffort(
      orderId,
      'reporting',
    );

    return this.mapReport(updated);
  }

  async finalizeReport(
    reportId: string,
    dto: FinalizeRadiologyReportDto,
  ) {
    const report = await this.readReport(reportId);

    if (!dto.verificationConfirmed) throw new BadRequestException('Radiology sign-off confirmation is required');
    if (!dto.verifierName?.trim()) throw new BadRequestException('Verifier name is required for radiology sign-off');

    if (
      report.status === 'cancelled' ||
      report.status === 'entered-in-error'
    ) {
      throw new BadRequestException(
        `Cannot finalize report with status ${report.status}`,
      );
    }

    if (
      report.status === 'final' ||
      report.status === 'amended' ||
      report.status === 'corrected'
    ) {
      const existingOrderId = this.extractReferenceId(
        report.basedOn?.[0]?.reference,
        'ServiceRequest',
      );

      if (existingOrderId) {
        await this.radiologyService.updateWorkflowStatus(
          existingOrderId,
          'final',
        );
      }

      return this.mapReport(report);
    }

    const impression =
      this.clean(dto.impression) ?? report.conclusion;
    const findings = this.extensionValueString(
      report.extension,
      FINDINGS_EXTENSION_URL,
    );

    if (!findings) {
      throw new BadRequestException(
        'Radiology findings are required before finalization',
      );
    }

    if (!impression) {
      throw new BadRequestException(
        'Radiology impression is required before finalization',
      );
    }

    const now = new Date().toISOString();
    const extension = this.withVerifierExtensions(
      report.extension ?? [],
      dto.verifierId,
      dto.verifierName,
      now,
    );

    const medplum = this.medplumService.getClient();
    const updated = await medplum.updateResource<DiagnosticReport>({
      ...report,
      status: 'final',
      issued: now,
      conclusion: impression,
      extension,
    });

    const orderId = this.extractReferenceId(
      updated.basedOn?.[0]?.reference,
      'ServiceRequest',
    );

    if (orderId) {
      await this.radiologyService.updateWorkflowStatus(
        orderId,
        'final',
      );
    }

    return this.mapReport(updated);
  }

  async amendReport(
    reportId: string,
    dto: UpdateRadiologyReportDto,
  ) {
    const report = await this.readReport(reportId);

    if (
      report.status !== 'final' &&
      report.status !== 'amended' &&
      report.status !== 'corrected'
    ) {
      throw new BadRequestException(
        'Only a finalized radiology report can be amended',
      );
    }

    const findings =
      dto.findings !== undefined
        ? this.clean(dto.findings)
        : this.extensionValueString(
            report.extension,
            FINDINGS_EXTENSION_URL,
          );
    const impression =
      dto.impression !== undefined
        ? this.clean(dto.impression)
        : report.conclusion;

    if (!findings || !impression) {
      throw new BadRequestException(
        'Amended report requires findings and impression',
      );
    }

    const updatedEditable = await this.updateFinalReportExtensions(
      report,
      dto,
    );

    const medplum = this.medplumService.getClient();
    const updated = await medplum.updateResource<DiagnosticReport>({
      ...updatedEditable,
      status: 'amended',
      issued: new Date().toISOString(),
      conclusion: impression,
    });

    return this.mapReport(updated);
  }

  private async updateFinalReportExtensions(
    report: DiagnosticReport,
    dto: UpdateRadiologyReportDto,
  ) {
    const hospitalId = this.extensionReferenceId(
      report.extension,
      HOSPITAL_EXTENSION_URL,
      'Organization',
    );
    const modality = this.extensionValueString(
      report.extension,
      MODALITY_EXTENSION_URL,
    );

    const rebuilt = this.buildReportExtensions({
      hospitalId,
      modality,
      technique:
        dto.technique !== undefined
          ? dto.technique
          : this.extensionValueString(
              report.extension,
              TECHNIQUE_EXTENSION_URL,
            ),
      comparison:
        dto.comparison !== undefined
          ? dto.comparison
          : this.extensionValueString(
              report.extension,
              COMPARISON_EXTENSION_URL,
            ),
      findings:
        dto.findings !== undefined
          ? dto.findings
          : this.extensionValueString(
              report.extension,
              FINDINGS_EXTENSION_URL,
            ),
      recommendations:
        dto.recommendations !== undefined
          ? dto.recommendations
          : this.extensionValueString(
              report.extension,
              RECOMMENDATIONS_EXTENSION_URL,
            ),
    });

    return {
      ...report,
      performer:
        dto.radiologistId || dto.radiologistName
          ? [
              dto.radiologistId
                ? {
                    reference:
                      `Practitioner/${dto.radiologistId}`,
                    display:
                      dto.radiologistName?.trim() || undefined,
                  }
                : {
                    display: dto.radiologistName?.trim(),
                  },
            ]
          : report.performer,
      extension: this.mergePreservedExtensions(
        report.extension,
        rebuilt,
      ),
    } as DiagnosticReport;
  }

  private async findReportResourcesForOrder(
    orderId: string,
  ): Promise<DiagnosticReport[]> {
    const order = await this.readOrder(orderId);
    const patientId = this.extractReferenceId(
      order.subject?.reference,
      'Patient',
    );

    if (!patientId) {
      return [];
    }

    const medplum = this.medplumService.getClient();
    const resources = await medplum.searchResources(
      'DiagnosticReport',
      {
        subject: `Patient/${patientId}`,
        _count: '500',
      },
    );

    const orderReference = `ServiceRequest/${orderId}`;

    return resources.filter(
      (report) =>
        report.basedOn?.some(
          (reference) =>
            reference.reference === orderReference,
        ) ?? false,
    );
  }

  private async readReport(
    reportId: string,
  ): Promise<DiagnosticReport> {
    if (!reportId?.trim()) {
      throw new BadRequestException(
        'Radiology report ID is required',
      );
    }

    const medplum = this.medplumService.getClient();

    try {
      const report = await medplum.readResource(
        'DiagnosticReport',
        reportId,
      );

      if (!this.isRadiologyReport(report)) {
        throw new NotFoundException(
          'Radiology report not found',
        );
      }

      return report;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      throw new NotFoundException(
        'Radiology report not found',
      );
    }
  }

  private async readPatient(
    patientId: string,
  ): Promise<Patient> {
    const medplum = this.medplumService.getClient();

    try {
      return await medplum.readResource(
        'Patient',
        patientId,
      );
    } catch {
      throw new NotFoundException('Patient not found');
    }
  }

  private async readEncounter(
    encounterId: string,
  ): Promise<Encounter> {
    const medplum = this.medplumService.getClient();

    try {
      return await medplum.readResource(
        'Encounter',
        encounterId,
      );
    } catch {
      throw new NotFoundException('Encounter not found');
    }
  }

  private async readOrder(
    orderId: string,
  ): Promise<ServiceRequest> {
    if (!orderId?.trim()) {
      throw new BadRequestException(
        'Radiology order ID is required',
      );
    }

    const medplum = this.medplumService.getClient();

    try {
      const order = await medplum.readResource(
        'ServiceRequest',
        orderId,
      );

      if (!this.isRadiologyOrder(order)) {
        throw new NotFoundException(
          'Radiology order not found',
        );
      }

      return order;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      throw new NotFoundException(
        'Radiology order not found',
      );
    }
  }

  private validateCreateDto(
    dto: CreateRadiologyReportDto,
  ) {
    if (!dto.orderId?.trim()) {
      throw new BadRequestException(
        'Radiology order ID is required',
      );
    }

    if (!dto.patientId?.trim()) {
      throw new BadRequestException(
        'Patient ID is required',
      );
    }

    if (!dto.encounterId?.trim()) {
      throw new BadRequestException(
        'Encounter ID is required',
      );
    }

    if (!dto.hospitalId?.trim()) {
      throw new BadRequestException(
        'Hospital ID is required',
      );
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
    if (
      encounter.subject?.reference !==
      `Patient/${patientId}`
    ) {
      throw new BadRequestException(
        'Encounter does not belong to this patient',
      );
    }

    if (
      order.subject?.reference !==
      `Patient/${patientId}`
    ) {
      throw new BadRequestException(
        'Radiology order does not belong to this patient',
      );
    }

    if (
      order.encounter?.reference &&
      order.encounter.reference !==
        `Encounter/${encounterId}`
    ) {
      throw new BadRequestException(
        'Radiology order does not belong to this encounter',
      );
    }

    const encounterHospitalId = this.extractReferenceId(
      encounter.serviceProvider?.reference,
      'Organization',
    );

    if (
      encounterHospitalId &&
      encounterHospitalId !== hospitalId
    ) {
      throw new BadRequestException(
        'Encounter does not belong to this hospital',
      );
    }

    const patientHospitalId = this.extractReferenceId(
      patient.managingOrganization?.reference,
      'Organization',
    );

    if (
      patientHospitalId &&
      patientHospitalId !== hospitalId
    ) {
      throw new BadRequestException(
        'Patient does not belong to this hospital',
      );
    }
  }

  private isRadiologyOrder(
    order: ServiceRequest,
  ) {
    return (
      order.category?.some(
        (category) =>
          category.coding?.some(
            (coding) =>
              coding.code === RADIOLOGY_ORDER_CATEGORY_CODE ||
              coding.display === 'Imaging',
          ),
      ) ?? false
    );
  }

  private isRadiologyReport(
    report: DiagnosticReport,
  ) {
    return (
      report.category?.some(
        (category) =>
          category.coding?.some(
            (coding) =>
              coding.code === RADIOLOGY_CATEGORY_CODE ||
              coding.display === 'Radiology',
          ),
      ) ?? false
    );
  }

  private reportCollection(
    resources: DiagnosticReport[],
  ) {
    const reports = resources
      .filter((report) => this.isRadiologyReport(report))
      .map((report) => this.mapReport(report))
      .sort(
        (a, b) =>
          this.dateValue(b.issuedAt) -
          this.dateValue(a.issuedAt),
      );

    return {
      total: reports.length,
      reports,
    };
  }

  private mapReport(
    report: DiagnosticReport,
  ) {
    const verifier = report.extension?.find(
      (extension) =>
        extension.url === VERIFIED_BY_EXTENSION_URL,
    )?.valueReference;

    return {
      id: report.id,
      resourceType: report.resourceType,
      status: report.status,

      examCode: report.code?.coding?.[0]?.code,
      examName:
        report.code?.text ??
        report.code?.coding?.[0]?.display ??
        'Radiology Report',

      patientId: this.extractReferenceId(
        report.subject?.reference,
        'Patient',
      ),
      encounterId: this.extractReferenceId(
        report.encounter?.reference,
        'Encounter',
      ),
      orderId: this.extractReferenceId(
        report.basedOn?.[0]?.reference,
        'ServiceRequest',
      ),
      hospitalId: this.extensionReferenceId(
        report.extension,
        HOSPITAL_EXTENSION_URL,
        'Organization',
      ),

      modality: this.extensionValueString(
        report.extension,
        MODALITY_EXTENSION_URL,
      ),
      technique: this.extensionValueString(
        report.extension,
        TECHNIQUE_EXTENSION_URL,
      ),
      comparison: this.extensionValueString(
        report.extension,
        COMPARISON_EXTENSION_URL,
      ),
      findings: this.extensionValueString(
        report.extension,
        FINDINGS_EXTENSION_URL,
      ),
      impression: report.conclusion,
      recommendations: this.extensionValueString(
        report.extension,
        RECOMMENDATIONS_EXTENSION_URL,
      ),

      radiologistId: this.extractReferenceId(
        report.performer?.[0]?.reference,
        'Practitioner',
      ),
      radiologistName: report.performer?.[0]?.display,

      verifierId: this.extractReferenceId(
        verifier?.reference,
        'Practitioner',
      ),
      verifierName: verifier?.display,
      verifiedAt: this.extensionValueString(
        report.extension,
        VERIFIED_AT_EXTENSION_URL,
      ),

      effectiveAt: report.effectiveDateTime,
      issuedAt: report.issued,
    };
  }

  private buildReportExtensions(input: {
    hospitalId?: string;
    modality?: string;
    technique?: string;
    comparison?: string;
    findings?: string;
    recommendations?: string;
  }): Extension[] {
    const extension: Extension[] = [];

    if (input.hospitalId?.trim()) {
      extension.push({
        url: HOSPITAL_EXTENSION_URL,
        valueReference: {
          reference: `Organization/${input.hospitalId.trim()}`,
        },
      });
    }

    if (input.modality?.trim()) {
      extension.push({
        url: MODALITY_EXTENSION_URL,
        valueString: input.modality.trim(),
      });
    }

    this.pushStringExtension(
      extension,
      TECHNIQUE_EXTENSION_URL,
      input.technique,
    );
    this.pushStringExtension(
      extension,
      COMPARISON_EXTENSION_URL,
      input.comparison,
    );
    this.pushStringExtension(
      extension,
      FINDINGS_EXTENSION_URL,
      input.findings,
    );
    this.pushStringExtension(
      extension,
      RECOMMENDATIONS_EXTENSION_URL,
      input.recommendations,
    );

    return extension;
  }

  private mergePreservedExtensions(
    current: Extension[] | undefined,
    rebuilt: Extension[],
  ) {
    const managedUrls = new Set([
      HOSPITAL_EXTENSION_URL,
      MODALITY_EXTENSION_URL,
      TECHNIQUE_EXTENSION_URL,
      COMPARISON_EXTENSION_URL,
      FINDINGS_EXTENSION_URL,
      RECOMMENDATIONS_EXTENSION_URL,
    ]);

    const preserved = (current ?? []).filter(
      (extension) => !managedUrls.has(extension.url),
    );

    return [...preserved, ...rebuilt];
  }

  private withVerifierExtensions(
    current: Extension[],
    verifierId: string | undefined,
    verifierName: string | undefined,
    verifiedAt: string,
  ) {
    const extension = current.filter(
      (item) =>
        item.url !== VERIFIED_BY_EXTENSION_URL &&
        item.url !== VERIFIED_AT_EXTENSION_URL,
    );

    if (verifierId || verifierName) {
      extension.push({
        url: VERIFIED_BY_EXTENSION_URL,
        valueReference: verifierId
          ? {
              reference: `Practitioner/${verifierId}`,
              display: verifierName?.trim() || undefined,
            }
          : {
              display: verifierName?.trim(),
            },
      });
    }

    extension.push({
      url: VERIFIED_AT_EXTENSION_URL,
      valueString: verifiedAt,
    });

    return extension;
  }

  private pushStringExtension(
    extension: Extension[],
    url: string,
    value?: string,
  ) {
    const cleanValue = this.clean(value);

    if (cleanValue) {
      extension.push({
        url,
        valueString: cleanValue,
      });
    }
  }

  private extensionValueString(
    extension: Extension[] | undefined,
    url: string,
  ) {
    const item = extension?.find(
      (candidate) => candidate.url === url,
    );

    return item?.valueString ?? item?.valueCode;
  }

  private extensionReferenceId(
    extension: Extension[] | undefined,
    url: string,
    resourceType: string,
  ) {
    const reference = extension?.find(
      (candidate) => candidate.url === url,
    )?.valueReference?.reference;

    return this.extractReferenceId(
      reference,
      resourceType,
    );
  }

  private orderModality(
    order: ServiceRequest,
  ) {
    const item = order.extension?.find(
      (extension) =>
        extension.url === MODALITY_EXTENSION_URL,
    );

    return item?.valueCode ?? item?.valueString;
  }

  private patientDisplay(patient: Patient) {
    const name = patient.name?.[0];

    if (!name) {
      return undefined;
    }

    if (name.text?.trim()) {
      return name.text.trim();
    }

    const generatedName = [
      name.given?.join(' '),
      name.family,
    ]
      .filter(Boolean)
      .join(' ')
      .trim();

    return generatedName || undefined;
  }

  private async syncWorkflowBestEffort(
    orderId: string | undefined,
    workflowStatus: 'reporting' | 'preliminary',
  ) {
    if (!orderId) {
      return;
    }

    try {
      await this.radiologyService.updateWorkflowStatus(
        orderId,
        workflowStatus,
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : String(error);

      this.logger.warn(
        `Radiology report saved, but order ${orderId} could not advance to ${workflowStatus}: ${message}`,
      );
    }
  }

  private clean(value?: string) {
    const cleanValue = value?.trim();
    return cleanValue || undefined;
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
