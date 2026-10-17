import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type {
  Encounter,
  Patient,
  ServiceRequest,
  Specimen,
} from '@medplum/fhirtypes';

import { CreateSpecimenDto } from './dto/create-specimen.dto';
import { UpdateSpecimenStatusDto } from './dto/update-specimen-status.dto';
import { MedplumService } from '../medplum/medplum.service';
import { CreateLabOrderDto } from './dto/create-lab-order.dto';

const LAB_CATEGORY_SYSTEM =
  'http://terminology.hl7.org/CodeSystem/observation-category';

const LAB_CATEGORY_CODE = 'laboratory';

const LOCAL_LAB_CODE_SYSTEM =
  'http://hospital-ehr.local/fhir/CodeSystem/laboratory-tests';

const HOSPITAL_EXTENSION_URL =
  'http://hospital-ehr.local/fhir/StructureDefinition/hospital';

@Injectable()
export class LaboratoryService {
  constructor(private readonly medplumService: MedplumService) {}

  async createOrder(dto: CreateLabOrderDto) {
    this.validateCreateDto(dto);

    const medplum = this.medplumService.getClient();

    let patient: Patient;

    try {
      patient = await medplum.readResource('Patient', dto.patientId);
    } catch {
      throw new NotFoundException('Patient not found');
    }

    let encounter: Encounter;

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

    this.assertFinancialClearance(encounter);

    const serviceRequest: ServiceRequest = {
      resourceType: 'ServiceRequest',

      status: 'active',

      intent: 'order',

      priority: dto.priority ?? 'routine',

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

      authoredOn: new Date().toISOString(),

      requester: dto.practitionerId
        ? {
            reference: `Practitioner/${dto.practitionerId}`,
            display: dto.practitionerName,
          }
        : {
            reference: `Organization/${dto.hospitalId}`,
          },

      note: dto.clinicalNote?.trim()
        ? [
            {
              text: dto.clinicalNote.trim(),
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
      ],
    };

    const created = await medplum.createResource(serviceRequest);

    return this.mapOrder(created);
  }

  async findByEncounter(encounterId: string, hospitalId?: string) {
    if (!encounterId) {
      throw new BadRequestException('Encounter ID is required');
    }

    const medplum = this.medplumService.getClient();

    const resources = await medplum.searchResources('ServiceRequest', {
      encounter: `Encounter/${encounterId}`,
      _count: '500',
    });

    const orders = resources
      .filter(
        (resource) =>
          this.isLaboratoryOrder(resource) &&
          (!hospitalId || this.mapOrder(resource).hospitalId === hospitalId),
      )
      .map((resource) => this.mapOrder(resource))
      .sort(
        (a, b) => this.dateValue(b.authoredOn) - this.dateValue(a.authoredOn),
      );

    return {
      total: orders.length,
      orders,
    };
  }

  async findByPatient(patientId: string, hospitalId?: string) {
    if (!patientId) {
      throw new BadRequestException('Patient ID is required');
    }

    const medplum = this.medplumService.getClient();

    try {
      await medplum.readResource('Patient', patientId);
    } catch {
      throw new NotFoundException('Patient not found');
    }

    const resources = await medplum.searchResources('ServiceRequest', {
      subject: `Patient/${patientId}`,
      _count: '500',
    });

    const orders = resources
      .filter(
        (resource) =>
          this.isLaboratoryOrder(resource) &&
          (!hospitalId || this.mapOrder(resource).hospitalId === hospitalId),
      )
      .map((resource) => this.mapOrder(resource))
      .sort(
        (a, b) => this.dateValue(b.authoredOn) - this.dateValue(a.authoredOn),
      );

    return {
      total: orders.length,
      orders,
    };
  }

  async findOrder(orderId: string) {
    const order = await this.readOrder(orderId);

    if (!this.isLaboratoryOrder(order)) {
      throw new NotFoundException('Laboratory order not found');
    }

    return this.mapOrder(order);
  }

  async updateOrderStatus(
    orderId: string,
    status:
      | 'draft'
      | 'active'
      | 'on-hold'
      | 'revoked'
      | 'completed'
      | 'entered-in-error',
    hospitalId: string,
  ) {
    if (!hospitalId?.trim()) {
      throw new BadRequestException('Hospital ID is required');
    }

    const allowedStatuses = [
      'draft',
      'active',
      'on-hold',
      'revoked',
      'completed',
      'entered-in-error',
    ];

    if (!allowedStatuses.includes(status)) {
      throw new BadRequestException('Invalid laboratory order status');
    }

    const medplum = this.medplumService.getClient();

    const order = await this.readOrder(orderId);

    if (
      !this.isLaboratoryOrder(order) ||
      this.mapOrder(order).hospitalId !== hospitalId.trim()
    ) {
      throw new NotFoundException('Laboratory order not found');
    }

    const updated = await medplum.updateResource({
      ...order,
      status,
    });

    return this.mapOrder(updated);
  }

  private async readOrder(orderId: string): Promise<ServiceRequest> {
    if (!orderId) {
      throw new BadRequestException('Laboratory order ID is required');
    }

    const medplum = this.medplumService.getClient();

    try {
      return await medplum.readResource('ServiceRequest', orderId);
    } catch {
      throw new NotFoundException('Laboratory order not found');
    }
  }

  private validateCreateDto(dto: CreateLabOrderDto) {
    if (!dto.patientId?.trim()) {
      throw new BadRequestException('Patient ID is required');
    }

    if (!dto.encounterId?.trim()) {
      throw new BadRequestException('Encounter ID is required');
    }

    if (!dto.hospitalId?.trim()) {
      throw new BadRequestException('Hospital ID is required');
    }

    if (!dto.testCode?.trim()) {
      throw new BadRequestException('Laboratory test code is required');
    }

    if (!dto.testName?.trim()) {
      throw new BadRequestException('Laboratory test name is required');
    }
  }

  private isLaboratoryOrder(resource: ServiceRequest) {
    return (
      resource.category?.some((category) =>
        category.coding?.some((coding) => coding.code === LAB_CATEGORY_CODE),
      ) ?? false
    );
  }

  private mapOrder(resource: ServiceRequest) {
    const hospitalId = resource.extension
      ?.find((extension) => extension.url === HOSPITAL_EXTENSION_URL)
      ?.valueReference?.reference?.replace('Organization/', '');

    return {
      id: resource.id,

      resourceType: resource.resourceType,

      status: resource.status,

      intent: resource.intent,

      priority: resource.priority ?? 'routine',

      testCode: resource.code?.coding?.[0]?.code,

      testName:
        resource.code?.text ??
        resource.code?.coding?.[0]?.display ??
        'Laboratory Test',

      patientId: this.extractReferenceId(
        resource.subject?.reference,
        'Patient',
      ),

      encounterId: this.extractReferenceId(
        resource.encounter?.reference,
        'Encounter',
      ),

      hospitalId,

      practitionerId: this.extractReferenceId(
        resource.requester?.reference,
        'Practitioner',
      ),

      practitionerName: resource.requester?.display,

      authoredOn: resource.authoredOn,

      clinicalNote: resource.note?.[0]?.text,
    };
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

  async createSpecimen(dto: CreateSpecimenDto) {
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

    if (!dto.specimenTypeCode?.trim()) {
      throw new BadRequestException('Specimen type code is required');
    }

    if (!dto.specimenTypeName?.trim()) {
      throw new BadRequestException('Specimen type name is required');
    }

    const medplum = this.medplumService.getClient();

    let order: ServiceRequest;

    try {
      order = await medplum.readResource('ServiceRequest', dto.orderId);
    } catch {
      throw new NotFoundException('Laboratory order not found');
    }

    if (!this.isLaboratoryOrder(order)) {
      throw new BadRequestException('ServiceRequest is not a laboratory order');
    }

    const orderPatientId = this.extractReferenceId(
      order.subject?.reference,
      'Patient',
    );

    if (orderPatientId !== dto.patientId) {
      throw new BadRequestException(
        'Laboratory order does not belong to this patient',
      );
    }

    const orderEncounterId = this.extractReferenceId(
      order.encounter?.reference,
      'Encounter',
    );

    if (orderEncounterId && orderEncounterId !== dto.encounterId) {
      throw new BadRequestException(
        'Laboratory order does not belong to this encounter',
      );
    }

    const accessionNumber =
      dto.accessionNumber?.trim() || this.generateAccessionNumber();

    const specimen: Specimen = {
      resourceType: 'Specimen',

      status: 'available',

      identifier: [
        {
          system: 'http://hospital-ehr.local/fhir/NamingSystem/lab-accession',
          value: accessionNumber,
        },
        {
          system:
            'http://hospital-ehr.local/fhir/NamingSystem/specimen-barcode',
          value: `BAR-${accessionNumber}`,
        },
      ],

      type: {
        coding: [
          {
            system: 'http://snomed.info/sct',
            code: dto.specimenTypeCode.trim(),
            display: dto.specimenTypeName.trim(),
          },
        ],
        text: dto.specimenTypeName.trim(),
      },

      subject: {
        reference: `Patient/${dto.patientId}`,
      },

      request: [
        {
          reference: `ServiceRequest/${dto.orderId}`,
        },
      ],

      receivedTime: undefined,

      collection: {
        collectedDateTime: dto.collectedAt ?? new Date().toISOString(),

        collector: dto.collectorId
          ? {
              reference: `Practitioner/${dto.collectorId}`,
              display: dto.collectorName,
            }
          : dto.collectorName
            ? {
                display: dto.collectorName,
              }
            : undefined,
      },

      note: dto.note?.trim()
        ? [
            {
              text: dto.note.trim(),
            },
          ]
        : undefined,

      extension: [
        {
          url: 'http://hospital-ehr.local/fhir/StructureDefinition/hospital',
          valueReference: {
            reference: `Organization/${dto.hospitalId}`,
          },
        },

        {
          url: 'http://hospital-ehr.local/fhir/StructureDefinition/encounter',
          valueReference: {
            reference: `Encounter/${dto.encounterId}`,
          },
        },
        {
          url: 'http://hospital-ehr.local/fhir/StructureDefinition/specimen-workflow-status',
          valueCode: 'collected',
        },
        {
          url: 'http://hospital-ehr.local/fhir/StructureDefinition/specimen-acceptance-status',
          valueCode: 'pending',
        },
      ],
    };

    const created = await medplum.createResource(specimen);

    return this.mapSpecimen(created);
  }

  async findSpecimensByOrder(orderId: string, hospitalId?: string) {
    if (!orderId?.trim()) {
      throw new BadRequestException('Laboratory order ID is required');
    }

    const medplum = this.medplumService.getClient();

    const resources = await medplum.searchResources('Specimen', {
      _count: '1000',
    });

    const orderReference = `ServiceRequest/${orderId}`;

    const specimens = resources
      .filter(
        (resource) =>
          resource.request?.some(
            (requestReference) => requestReference.reference === orderReference,
          ) ?? false,
      )
      .filter(
        (resource) =>
          !hospitalId || this.mapSpecimen(resource).hospitalId === hospitalId,
      )
      .map((resource) => this.mapSpecimen(resource))
      .sort(
        (a, b) => this.dateValue(b.collectedAt) - this.dateValue(a.collectedAt),
      );

    return {
      total: specimens.length,
      specimens,
    };
  }

  async findSpecimen(specimenId: string) {
    const specimen = await this.readSpecimen(specimenId);

    return this.mapSpecimen(specimen);
  }

  async updateSpecimenStatus(specimenId: string, dto: UpdateSpecimenStatusDto) {
    const allowedStatuses = [
      'available',
      'unavailable',
      'unsatisfactory',
      'entered-in-error',
    ];

    if (!dto.status || !allowedStatuses.includes(dto.status)) {
      throw new BadRequestException('Invalid specimen status');
    }

    const medplum = this.medplumService.getClient();

    const specimen = await this.readSpecimen(specimenId);

    if (dto.acceptanceStatus === 'rejected' && !dto.rejectionReason?.trim()) {
      throw new BadRequestException(
        'Rejection reason is required for a rejected specimen',
      );
    }
    if (
      dto.acceptanceStatus === 'accepted' &&
      !dto.receivedAt &&
      !specimen.receivedTime
    ) {
      throw new BadRequestException(
        'Specimen received time is required before acceptance',
      );
    }
    const workflowUrls = new Set([
      'http://hospital-ehr.local/fhir/StructureDefinition/specimen-workflow-status',
      'http://hospital-ehr.local/fhir/StructureDefinition/specimen-acceptance-status',
      'http://hospital-ehr.local/fhir/StructureDefinition/specimen-rejection-reason',
      'http://hospital-ehr.local/fhir/StructureDefinition/recollection-required',
      'http://hospital-ehr.local/fhir/StructureDefinition/specimen-receiver',
    ]);

    const updated: Specimen = {
      ...specimen,

      status: dto.status,

      receivedTime: dto.receivedAt ?? specimen.receivedTime,

      note: dto.note?.trim()
        ? [
            ...(specimen.note ?? []),
            {
              text: dto.note.trim(),
            },
          ]
        : specimen.note,

      extension: [
        ...(specimen.extension ?? []).filter(
          (item) => !workflowUrls.has(item.url),
        ),
        {
          url: 'http://hospital-ehr.local/fhir/StructureDefinition/specimen-workflow-status',
          valueCode:
            dto.acceptanceStatus === 'accepted'
              ? 'accepted'
              : dto.acceptanceStatus === 'rejected'
                ? 'rejected-recollection'
                : dto.receivedAt
                  ? 'received'
                  : 'collected',
        },
        {
          url: 'http://hospital-ehr.local/fhir/StructureDefinition/specimen-acceptance-status',
          valueCode: dto.acceptanceStatus ?? 'pending',
        },
        ...(dto.rejectionReason
          ? [
              {
                url: 'http://hospital-ehr.local/fhir/StructureDefinition/specimen-rejection-reason',
                valueString: dto.rejectionReason.trim(),
              },
            ]
          : []),
        {
          url: 'http://hospital-ehr.local/fhir/StructureDefinition/recollection-required',
          valueBoolean:
            dto.acceptanceStatus === 'rejected'
              ? (dto.recollectionRequired ?? true)
              : false,
        },
        ...(dto.receiverId || dto.receiverName
          ? [
              {
                url: 'http://hospital-ehr.local/fhir/StructureDefinition/specimen-receiver',
                valueReference: dto.receiverId
                  ? {
                      reference: `Practitioner/${dto.receiverId}`,
                      display: dto.receiverName,
                    }
                  : { display: dto.receiverName },
              },
            ]
          : []),
      ],
    };

    const saved = await medplum.updateResource(updated);

    return this.mapSpecimen(saved);
  }

  private async readSpecimen(specimenId: string): Promise<Specimen> {
    if (!specimenId?.trim()) {
      throw new BadRequestException('Specimen ID is required');
    }

    const medplum = this.medplumService.getClient();

    try {
      return await medplum.readResource('Specimen', specimenId);
    } catch {
      throw new NotFoundException('Specimen not found');
    }
  }

  private mapSpecimen(specimen: Specimen) {
    const hospitalId = specimen.extension
      ?.find(
        (extension) =>
          extension.url ===
          'http://hospital-ehr.local/fhir/StructureDefinition/hospital',
      )
      ?.valueReference?.reference?.replace('Organization/', '');

    const encounterId = specimen.extension
      ?.find(
        (extension) =>
          extension.url ===
          'http://hospital-ehr.local/fhir/StructureDefinition/encounter',
      )
      ?.valueReference?.reference?.replace('Encounter/', '');

    return {
      id: specimen.id,

      resourceType: specimen.resourceType,

      status: specimen.status,

      accessionNumber: specimen.identifier?.[0]?.value,

      barcode: specimen.identifier?.find(
        (identifier) =>
          identifier.system ===
          'http://hospital-ehr.local/fhir/NamingSystem/specimen-barcode',
      )?.value,

      workflowStatus: specimen.extension?.find(
        (extension) =>
          extension.url ===
          'http://hospital-ehr.local/fhir/StructureDefinition/specimen-workflow-status',
      )?.valueCode,

      acceptanceStatus: specimen.extension?.find(
        (extension) =>
          extension.url ===
          'http://hospital-ehr.local/fhir/StructureDefinition/specimen-acceptance-status',
      )?.valueCode,

      rejectionReason: specimen.extension?.find(
        (extension) =>
          extension.url ===
          'http://hospital-ehr.local/fhir/StructureDefinition/specimen-rejection-reason',
      )?.valueString,

      recollectionRequired: specimen.extension?.find(
        (extension) =>
          extension.url ===
          'http://hospital-ehr.local/fhir/StructureDefinition/recollection-required',
      )?.valueBoolean,

      specimenTypeCode: specimen.type?.coding?.[0]?.code,

      specimenTypeName:
        specimen.type?.text ?? specimen.type?.coding?.[0]?.display,

      patientId: this.extractReferenceId(
        specimen.subject?.reference,
        'Patient',
      ),

      orderId: this.extractReferenceId(
        specimen.request?.[0]?.reference,
        'ServiceRequest',
      ),

      encounterId,

      hospitalId,

      collectedAt: specimen.collection?.collectedDateTime,

      collectorId: this.extractReferenceId(
        specimen.collection?.collector?.reference,
        'Practitioner',
      ),

      collectorName: specimen.collection?.collector?.display,

      receivedAt: specimen.receivedTime,

      notes: specimen.note?.map((note) => note.text).filter(Boolean) ?? [],
    };
  }

  private assertFinancialClearance(encounter: Encounter) {
    const status = encounter.extension?.find(
      (item) =>
        item.url ===
        'https://hospital-ehr.local/fhir/StructureDefinition/financial-clearance-status',
    )?.valueCode;
    if (status && !['cleared', 'emergency-override'].includes(status)) {
      throw new ConflictException({
        message:
          'Financial clearance is required before non-emergency services',
        code: 'FINANCIAL_CLEARANCE_REQUIRED',
        status,
      });
    }
  }

  private generateAccessionNumber() {
    const now = new Date();

    const date =
      `${now.getFullYear()}` +
      `${String(now.getMonth() + 1).padStart(2, '0')}` +
      `${String(now.getDate()).padStart(2, '0')}`;

    const random = Math.floor(100000 + Math.random() * 900000);

    return `LAB-${date}-${random}`;
  }
}
