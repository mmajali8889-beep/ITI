import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Encounter, Patient, ServiceRequest } from '@medplum/fhirtypes';

import { MedplumService } from '../medplum/medplum.service';
import { CreateRadiologyOrderDto } from './dto/create-radiology-order.dto';
import type { RadiologyWorkflowStatus } from './dto/update-radiology-workflow.dto';
import type { RadiologyWorklistQueryDto } from './dto/radiology-worklist-query.dto';
import type { AssignRadiologistDto } from './dto/assign-radiologist.dto';
import { RadiologistsService } from './radiologists.service';
import { ImagingStudyService } from './imaging-study.service';

/**
 * Workflow steps that assert the images exist. Reaching any of them requires
 * a study from the PACS linked to the order (an ImagingStudy created by the
 * PACS sync). "acquired" is not gated: the modality may have captured images
 * that have not reached the PACS yet.
 */
const REQUIRES_PACS_IMAGES = new Set<RadiologyWorkflowStatus>([
  'images-available',
  'reporting',
  'preliminary',
  'final',
]);

const RADIOLOGY_CATEGORY_SYSTEM = 'http://snomed.info/sct';
const RADIOLOGY_CATEGORY_CODE = '363679005';

const LOCAL_RADIOLOGY_CODE_SYSTEM =
  'http://hospital-ehr.local/fhir/CodeSystem/radiology-procedures';

const MODALITY_EXTENSION_URL =
  'http://hospital-ehr.local/fhir/StructureDefinition/radiology-modality';

const HOSPITAL_EXTENSION_URL =
  'http://hospital-ehr.local/fhir/StructureDefinition/hospital';

const CLINICAL_QUESTION_EXTENSION_URL =
  'http://hospital-ehr.local/fhir/StructureDefinition/radiology-clinical-question';

export const ACCESSION_IDENTIFIER_SYSTEM =
  'http://hospital-ehr.local/fhir/NamingSystem/radiology-accession';

const WORKFLOW_EXTENSION_URL =
  'http://hospital-ehr.local/fhir/StructureDefinition/radiology-workflow-status';

const WORKFLOW_UPDATED_AT_EXTENSION_URL =
  'http://hospital-ehr.local/fhir/StructureDefinition/radiology-workflow-updated-at';

const ASSIGNED_AT_EXTENSION_URL =
  'http://hospital-ehr.local/fhir/StructureDefinition/radiology-assigned-at';

const ASSIGNED_BY_EXTENSION_URL =
  'http://hospital-ehr.local/fhir/StructureDefinition/radiology-assigned-by';

const ASSIGNED_BY_NAME_EXTENSION_URL =
  'http://hospital-ehr.local/fhir/StructureDefinition/radiology-assigned-by-name';

type OrderStatus =
  'draft' | 'active' | 'on-hold' | 'revoked' | 'completed' | 'entered-in-error';

const WORKFLOW_RANK: Record<RadiologyWorkflowStatus, number> = {
  ordered: 0,
  scheduled: 1,
  arrived: 2,
  'exam-started': 3,
  acquired: 4,
  'images-available': 4,
  reporting: 5,
  preliminary: 6,
  final: 7,
};

@Injectable()
export class RadiologyService {
  constructor(
    private readonly medplumService: MedplumService,
    private readonly radiologistsService: RadiologistsService,
    private readonly imagingStudyService: ImagingStudyService,
  ) {}

  /**
   * Refuses to treat an order as imaged until the PACS sync has linked a study
   * to it. Without this, "images available" and a final report could be
   * recorded for an exam with no images at all.
   */
  async assertImagesInPacs(
    orderId: string,
    order?: ServiceRequest,
  ): Promise<void> {
    const { studies } = await this.imagingStudyService.getByOrder(orderId);
    if (studies.length > 0) return;
    const accession = this.accessionNumber(
      order ?? (await this.readOrder(orderId)),
    );
    throw new ConflictException({
      code: 'IMAGES_NOT_IN_PACS',
      accessionNumber: accession,
      message: `No PACS images are linked to accession ${accession ?? orderId} yet. Send the images from the modality, then sync the PACS before marking images available or finalizing the report.`,
    });
  }

  async createOrder(dto: CreateRadiologyOrderDto) {
    this.validateCreateDto(dto);

    const patient = await this.readPatient(dto.patientId);
    const encounter = await this.readEncounter(dto.encounterId);

    this.validateEncounterPatient(encounter, dto.patientId);
    this.assertFinancialClearance(encounter);

    const accessionNumber = await this.generateAccessionNumber();
    const now = new Date().toISOString();

    const request: ServiceRequest = {
      resourceType: 'ServiceRequest',
      status: 'active',
      intent: 'order',
      priority: dto.priority ?? 'routine',

      identifier: [
        {
          system: ACCESSION_IDENTIFIER_SYSTEM,
          value: accessionNumber,
        },
      ],

      category: [
        {
          coding: [
            {
              system: RADIOLOGY_CATEGORY_SYSTEM,
              code: RADIOLOGY_CATEGORY_CODE,
              display: 'Imaging',
            },
          ],
          text: 'Radiology / Imaging',
        },
      ],

      code: {
        coding: [
          {
            system: LOCAL_RADIOLOGY_CODE_SYSTEM,
            code: dto.examCode.trim(),
            display: dto.examName.trim(),
          },
        ],
        text: dto.examName.trim(),
      },

      subject: {
        reference: `Patient/${dto.patientId}`,
        display: this.patientDisplay(patient),
      },

      encounter: {
        reference: `Encounter/${dto.encounterId}`,
      },

      authoredOn: now,

      requester:
        dto.requesterId || dto.requesterName
          ? dto.requesterId
            ? {
                reference: `Practitioner/${dto.requesterId}`,
                display: dto.requesterName?.trim() || undefined,
              }
            : {
                display: dto.requesterName?.trim(),
              }
          : undefined,

      reasonCode: dto.clinicalIndication?.trim()
        ? [{ text: dto.clinicalIndication.trim() }]
        : undefined,

      bodySite:
        dto.bodySiteName?.trim() || dto.bodySiteCode?.trim()
          ? [
              {
                coding: dto.bodySiteCode?.trim()
                  ? [
                      {
                        system: 'http://snomed.info/sct',
                        code: dto.bodySiteCode.trim(),
                        display: dto.bodySiteName?.trim() || undefined,
                      },
                    ]
                  : undefined,
                text: dto.bodySiteName?.trim() || undefined,
              },
            ]
          : undefined,

      note: dto.notes?.trim() ? [{ text: dto.notes.trim() }] : undefined,

      extension: [
        {
          url: HOSPITAL_EXTENSION_URL,
          valueReference: {
            reference: `Organization/${dto.hospitalId}`,
          },
        },
        {
          url: MODALITY_EXTENSION_URL,
          valueCode: dto.modality,
        },
        {
          url: WORKFLOW_EXTENSION_URL,
          valueCode: 'ordered',
        },
        {
          url: WORKFLOW_UPDATED_AT_EXTENSION_URL,
          valueDateTime: now,
        },
        ...(dto.clinicalQuestion?.trim()
          ? [
              {
                url: CLINICAL_QUESTION_EXTENSION_URL,
                valueString: dto.clinicalQuestion.trim(),
              },
            ]
          : []),
      ],
    };

    const medplum = this.medplumService.getClient();
    const created = await medplum.createResource(request);

    return this.mapOrder(created);
  }

  async getOrder(orderId: string) {
    const order = await this.readOrder(orderId);

    if (!this.isRadiologyOrder(order)) {
      throw new NotFoundException('Radiology order not found');
    }

    return this.mapOrder(order);
  }

  async getOrderByAccession(accessionNumber: string) {
    const order = await this.findOrderResourceByAccession(accessionNumber);

    if (!order) {
      throw new NotFoundException(
        `Radiology order with accession ${accessionNumber} was not found`,
      );
    }

    return this.mapOrder(order);
  }

  async getAllOrders(query: RadiologyWorklistQueryDto = {}) {
    const allowedStatuses: OrderStatus[] = [
      'draft',
      'active',
      'on-hold',
      'revoked',
      'completed',
      'entered-in-error',
    ];

    const allowedWorkflows = Object.keys(
      WORKFLOW_RANK,
    ) as RadiologyWorkflowStatus[];

    const allowedModalities = [
      'XR',
      'CT',
      'MR',
      'US',
      'MG',
      'NM',
      'PT',
      'DX',
      'OTHER',
    ];

    const allowedPriorities = ['routine', 'urgent', 'asap', 'stat'];

    const status = query.status?.trim() as OrderStatus | undefined;

    if (status && !allowedStatuses.includes(status)) {
      throw new BadRequestException('Invalid radiology order status filter');
    }

    const workflowStatus = query.workflowStatus?.trim() as
      RadiologyWorkflowStatus | undefined;

    if (workflowStatus && !allowedWorkflows.includes(workflowStatus)) {
      throw new BadRequestException('Invalid radiology workflow status filter');
    }

    const modality = query.modality?.trim().toUpperCase();

    if (modality && !allowedModalities.includes(modality)) {
      throw new BadRequestException('Invalid radiology modality filter');
    }

    const priority = query.priority?.trim().toLowerCase();

    if (priority && !allowedPriorities.includes(priority)) {
      throw new BadRequestException('Invalid radiology priority filter');
    }

    const limit = this.worklistLimit(query.limit);

    const resources = await this.medplumService
      .getClient()
      .searchResources('ServiceRequest', {
        _count: '1000',
      });

    const hospitalId = query.hospitalId?.trim();

    const patientId = query.patientId?.trim();

    const encounterId = query.encounterId?.trim();

    const accessionNeedle = query.accessionNumber?.trim().toLowerCase();

    const searchNeedle = query.q?.trim().toLowerCase();

    const radiologistId = query.radiologistId?.trim();

    const assignment = query.assignment?.trim().toLowerCase();

    if (
      assignment &&
      assignment !== 'assigned' &&
      assignment !== 'unassigned'
    ) {
      throw new BadRequestException(
        'assignment must be assigned or unassigned',
      );
    }

    const filtered = resources
      .filter((resource) => this.isRadiologyOrder(resource))
      .map((resource) => this.mapOrder(resource))
      .filter((order) => {
        if (hospitalId && order.hospitalId !== hospitalId) {
          return false;
        }

        if (patientId && order.patientId !== patientId) {
          return false;
        }

        if (encounterId && order.encounterId !== encounterId) {
          return false;
        }

        if (status && order.status !== status) {
          return false;
        }

        if (workflowStatus && order.workflowStatus !== workflowStatus) {
          return false;
        }

        if (modality && String(order.modality).toUpperCase() !== modality) {
          return false;
        }

        if (priority && String(order.priority).toLowerCase() !== priority) {
          return false;
        }

        if (radiologistId && order.radiologistId !== radiologistId) {
          return false;
        }

        if (assignment === 'assigned' && !order.radiologistId) {
          return false;
        }

        if (assignment === 'unassigned' && order.radiologistId) {
          return false;
        }

        if (
          accessionNeedle &&
          !String(order.accessionNumber ?? '')
            .toLowerCase()
            .includes(accessionNeedle)
        ) {
          return false;
        }

        if (searchNeedle) {
          const haystack = [
            order.accessionNumber,
            order.examCode,
            order.examName,
            order.modality,
            order.bodySiteName,
            order.patientId,
            order.patientName,
            order.encounterId,
            order.requesterName,
            order.radiologistName,
            order.clinicalIndication,
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();

          if (!haystack.includes(searchNeedle)) {
            return false;
          }
        }

        return true;
      })
      .sort(
        (a, b) => this.dateValue(b.authoredOn) - this.dateValue(a.authoredOn),
      );

    const summary = {
      total: filtered.length,
      active: filtered.filter((order) => order.status === 'active').length,
      urgent: filtered.filter(
        (order) =>
          order.priority === 'urgent' ||
          order.priority === 'asap' ||
          order.priority === 'stat',
      ).length,
      imagesAvailable: filtered.filter((order) =>
        ['acquired', 'images-available'].includes(order.workflowStatus ?? ''),
      ).length,
      reporting: filtered.filter(
        (order) => order.workflowStatus === 'reporting',
      ).length,
      final: filtered.filter((order) => order.workflowStatus === 'final')
        .length,
      assigned: filtered.filter((order) => Boolean(order.radiologistId)).length,
      unassigned: filtered.filter((order) => !order.radiologistId).length,
    };

    const orders = filtered.slice(0, limit);

    return {
      total: filtered.length,
      returned: orders.length,
      limit,
      summary,
      filters: {
        hospitalId: hospitalId || undefined,
        patientId: patientId || undefined,
        encounterId: encounterId || undefined,
        status: status || undefined,
        workflowStatus: workflowStatus || undefined,
        modality: modality || undefined,
        priority: priority || undefined,
        radiologistId: radiologistId || undefined,
        assignment: assignment || undefined,
        accessionNumber: query.accessionNumber?.trim() || undefined,
        q: query.q?.trim() || undefined,
      },
      orders,
    };
  }

  async getEncounterOrders(encounterId: string) {
    if (!encounterId?.trim()) {
      throw new BadRequestException('Encounter ID is required');
    }

    await this.readEncounter(encounterId);

    const resources = await this.medplumService
      .getClient()
      .searchResources('ServiceRequest', {
        encounter: `Encounter/${encounterId}`,
        _count: '500',
      });

    const orders = resources
      .filter((resource) => this.isRadiologyOrder(resource))
      .map((resource) => this.mapOrder(resource))
      .sort(
        (a, b) => this.dateValue(b.authoredOn) - this.dateValue(a.authoredOn),
      );

    return {
      total: orders.length,
      orders,
    };
  }

  async getPatientOrders(patientId: string) {
    if (!patientId?.trim()) {
      throw new BadRequestException('Patient ID is required');
    }

    await this.readPatient(patientId);

    const resources = await this.medplumService
      .getClient()
      .searchResources('ServiceRequest', {
        subject: `Patient/${patientId}`,
        _count: '500',
      });

    const orders = resources
      .filter((resource) => this.isRadiologyOrder(resource))
      .map((resource) => this.mapOrder(resource))
      .sort(
        (a, b) => this.dateValue(b.authoredOn) - this.dateValue(a.authoredOn),
      );

    return {
      total: orders.length,
      orders,
    };
  }

  async assignRadiologist(orderId: string, dto: AssignRadiologistDto) {
    if (!dto.hospitalId?.trim()) {
      throw new BadRequestException('hospitalId is required.');
    }

    if (!dto.radiologistId?.trim()) {
      throw new BadRequestException('radiologistId is required.');
    }

    const order = await this.readOrder(orderId);

    if (!this.isRadiologyOrder(order)) {
      throw new NotFoundException('Radiology order not found');
    }

    const orderHospitalId = this.referenceId(
      order.extension?.find(
        (extension) => extension.url === HOSPITAL_EXTENSION_URL,
      )?.valueReference?.reference,
      'Organization',
    );

    if (!orderHospitalId || orderHospitalId !== dto.hospitalId.trim()) {
      throw new BadRequestException(
        'Radiology order does not belong to the selected hospital.',
      );
    }

    const radiologist = await this.radiologistsService.get(
      dto.radiologistId.trim(),
      dto.hospitalId.trim(),
    );

    if (!radiologist.active) {
      throw new BadRequestException(
        'The selected radiologist is inactive for this hospital.',
      );
    }

    const current = this.assignedRadiologist(order);

    if (current.radiologistId === radiologist.practitionerId) {
      return this.mapOrder(order);
    }

    const now = new Date().toISOString();

    const performer = [
      ...(order.performer ?? []).filter(
        (reference) => !reference.reference?.startsWith('Practitioner/'),
      ),
      {
        reference: `Practitioner/${radiologist.practitionerId}`,
        display: radiologist.displayName,
      },
    ];

    const extension = [
      ...(order.extension ?? []).filter(
        (item) =>
          item.url !== ASSIGNED_AT_EXTENSION_URL &&
          item.url !== ASSIGNED_BY_EXTENSION_URL &&
          item.url !== ASSIGNED_BY_NAME_EXTENSION_URL,
      ),
      {
        url: ASSIGNED_AT_EXTENSION_URL,
        valueDateTime: now,
      },
      ...(dto.assignedById?.trim()
        ? [
            {
              url: ASSIGNED_BY_EXTENSION_URL,
              valueReference: {
                reference: `Practitioner/${dto.assignedById.trim()}`,
                display: dto.assignedByName?.trim() || undefined,
              },
            },
          ]
        : []),
      ...(!dto.assignedById?.trim() && dto.assignedByName?.trim()
        ? [
            {
              url: ASSIGNED_BY_NAME_EXTENSION_URL,
              valueString: dto.assignedByName.trim(),
            },
          ]
        : []),
    ];

    const updated = await this.medplumService
      .getClient()
      .updateResource<ServiceRequest>({
        ...order,
        performer,
        extension,
      });

    return this.mapOrder(updated);
  }

  async unassignRadiologist(orderId: string, hospitalId: string) {
    if (!hospitalId?.trim()) {
      throw new BadRequestException('hospitalId is required.');
    }

    const order = await this.readOrder(orderId);

    if (!this.isRadiologyOrder(order)) {
      throw new NotFoundException('Radiology order not found');
    }

    const orderHospitalId = this.referenceId(
      order.extension?.find(
        (extension) => extension.url === HOSPITAL_EXTENSION_URL,
      )?.valueReference?.reference,
      'Organization',
    );

    if (!orderHospitalId || orderHospitalId !== hospitalId.trim()) {
      throw new BadRequestException(
        'Radiology order does not belong to the selected hospital.',
      );
    }

    const performer = (order.performer ?? []).filter(
      (reference) => !reference.reference?.startsWith('Practitioner/'),
    );

    const extension = (order.extension ?? []).filter(
      (item) =>
        item.url !== ASSIGNED_AT_EXTENSION_URL &&
        item.url !== ASSIGNED_BY_EXTENSION_URL &&
        item.url !== ASSIGNED_BY_NAME_EXTENSION_URL,
    );

    const updated = await this.medplumService
      .getClient()
      .updateResource<ServiceRequest>({
        ...order,
        performer: performer.length > 0 ? performer : undefined,
        extension,
      });

    return this.mapOrder(updated);
  }

  async updateOrderStatus(
    orderId: string,
    status: OrderStatus,
    hospitalId: string,
  ) {
    if (!hospitalId?.trim()) {
      throw new BadRequestException('hospitalId is required.');
    }

    const allowed: OrderStatus[] = [
      'draft',
      'active',
      'on-hold',
      'revoked',
      'completed',
      'entered-in-error',
    ];

    if (!allowed.includes(status)) {
      throw new BadRequestException('Invalid radiology order status');
    }

    const order = await this.readOrder(orderId);

    const orderHospitalId = this.referenceId(
      order.extension?.find(
        (extension) => extension.url === HOSPITAL_EXTENSION_URL,
      )?.valueReference?.reference,
      'Organization',
    );

    if (
      !this.isRadiologyOrder(order) ||
      orderHospitalId !== hospitalId.trim()
    ) {
      throw new NotFoundException('Radiology order not found');
    }

    const updated = await this.medplumService.getClient().updateResource({
      ...order,
      status,
    });

    return this.mapOrder(updated);
  }

  async updateWorkflowStatus(
    orderId: string,
    workflowStatus: RadiologyWorkflowStatus,
  ) {
    const allowed = Object.keys(WORKFLOW_RANK) as RadiologyWorkflowStatus[];

    if (!allowed.includes(workflowStatus)) {
      throw new BadRequestException('Invalid radiology workflow status');
    }

    const order = await this.readOrder(orderId);

    if (!this.isRadiologyOrder(order)) {
      throw new NotFoundException('Radiology order not found');
    }

    const currentStatus = this.workflowStatus(order);

    if (WORKFLOW_RANK[workflowStatus] < WORKFLOW_RANK[currentStatus]) {
      return this.mapOrder(order);
    }

    if (currentStatus === workflowStatus) {
      return this.mapOrder(order);
    }

    if (REQUIRES_PACS_IMAGES.has(workflowStatus)) {
      await this.assertImagesInPacs(orderId, order);
    }

    const now = new Date().toISOString();

    const extensions = [
      ...(order.extension ?? []).filter(
        (extension) =>
          extension.url !== WORKFLOW_EXTENSION_URL &&
          extension.url !== WORKFLOW_UPDATED_AT_EXTENSION_URL,
      ),
      {
        url: WORKFLOW_EXTENSION_URL,
        valueCode: workflowStatus,
      },
      {
        url: WORKFLOW_UPDATED_AT_EXTENSION_URL,
        valueDateTime: now,
      },
    ];

    const updated = await this.medplumService.getClient().updateResource({
      ...order,
      status: workflowStatus === 'final' ? 'completed' : order.status,
      extension: extensions,
    });

    return this.mapOrder(updated);
  }

  private validateCreateDto(dto: CreateRadiologyOrderDto) {
    if (!dto.patientId?.trim()) {
      throw new BadRequestException('Patient ID is required');
    }

    if (!dto.encounterId?.trim()) {
      throw new BadRequestException('Encounter ID is required');
    }

    if (!dto.hospitalId?.trim()) {
      throw new BadRequestException('Hospital ID is required');
    }

    if (!dto.examCode?.trim()) {
      throw new BadRequestException('Radiology exam code is required');
    }

    if (!dto.examName?.trim()) {
      throw new BadRequestException('Radiology exam name is required');
    }

    const modalities = [
      'XR',
      'CT',
      'MR',
      'US',
      'MG',
      'NM',
      'PT',
      'DX',
      'OTHER',
    ];

    if (!modalities.includes(dto.modality)) {
      throw new BadRequestException('Invalid radiology modality');
    }
  }

  private async generateAccessionNumber(): Promise<string> {
    const medplum = this.medplumService.getClient();
    const now = new Date();

    const yy = String(now.getFullYear()).slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');

    // DICOM Accession Number (0008,0050) uses VR SH,
    // which has a maximum length of 16 characters.
    //
    // Format:
    // RAD + YYMMDD + 6-char base36 suffix = 15 characters
    // Example: RAD260830A1B2C3
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const suffix = Math.floor(
        Math.random() * 2176782336, // 36^6
      )
        .toString(36)
        .toUpperCase()
        .padStart(6, '0');

      const accessionNumber = `RAD${yy}${mm}${dd}${suffix}`;

      try {
        const existing = await medplum.searchResources('ServiceRequest', {
          identifier: `${ACCESSION_IDENTIFIER_SYSTEM}|${accessionNumber}`,
          _count: '1',
        });

        if (existing.length === 0) {
          return accessionNumber;
        }
      } catch {
        return accessionNumber;
      }
    }

    throw new BadRequestException(
      'Unable to generate a unique radiology accession number',
    );
  }

  private async findOrderResourceByAccession(
    accessionNumber: string,
  ): Promise<ServiceRequest | undefined> {
    const accession = accessionNumber?.trim();

    if (!accession) {
      throw new BadRequestException('Accession number is required');
    }

    const medplum = this.medplumService.getClient();

    try {
      const resources = await medplum.searchResources('ServiceRequest', {
        identifier: `${ACCESSION_IDENTIFIER_SYSTEM}|${accession}`,
        _count: '20',
      });

      const match = resources.find(
        (resource) =>
          this.isRadiologyOrder(resource) &&
          this.accessionNumber(resource) === accession,
      );

      if (match) {
        return match;
      }
    } catch {
      // Fall through to a local-filter fallback for development servers
      // that do not expose identifier search exactly as expected.
    }

    const fallback = await medplum.searchResources('ServiceRequest', {
      _count: '500',
    });

    return fallback.find(
      (resource) =>
        this.isRadiologyOrder(resource) &&
        this.accessionNumber(resource) === accession,
    );
  }

  private async readPatient(patientId: string): Promise<Patient> {
    try {
      return await this.medplumService
        .getClient()
        .readResource('Patient', patientId);
    } catch {
      throw new NotFoundException('Patient not found');
    }
  }

  private async readEncounter(encounterId: string): Promise<Encounter> {
    try {
      return await this.medplumService
        .getClient()
        .readResource('Encounter', encounterId);
    } catch {
      throw new NotFoundException('Encounter not found');
    }
  }

  private async readOrder(orderId: string): Promise<ServiceRequest> {
    if (!orderId?.trim()) {
      throw new BadRequestException('Radiology order ID is required');
    }

    try {
      return await this.medplumService
        .getClient()
        .readResource('ServiceRequest', orderId);
    } catch {
      throw new NotFoundException('Radiology order not found');
    }
  }

  private validateEncounterPatient(encounter: Encounter, patientId: string) {
    const subject = encounter.subject?.reference;

    if (subject && subject !== `Patient/${patientId}`) {
      throw new BadRequestException(
        'Encounter does not belong to the selected patient',
      );
    }
  }

  private isRadiologyOrder(order: ServiceRequest) {
    return Boolean(
      order.category?.some((category) =>
        category.coding?.some(
          (coding) =>
            coding.system === RADIOLOGY_CATEGORY_SYSTEM &&
            coding.code === RADIOLOGY_CATEGORY_CODE,
        ),
      ),
    );
  }

  private accessionNumber(order: ServiceRequest) {
    return order.identifier?.find(
      (identifier) => identifier.system === ACCESSION_IDENTIFIER_SYSTEM,
    )?.value;
  }

  private workflowStatus(order: ServiceRequest): RadiologyWorkflowStatus {
    const value = order.extension?.find(
      (extension) => extension.url === WORKFLOW_EXTENSION_URL,
    )?.valueCode as RadiologyWorkflowStatus | undefined;

    return value && value in WORKFLOW_RANK ? value : 'ordered';
  }

  private assignedRadiologist(order: ServiceRequest) {
    const performer = order.performer?.find((reference) =>
      reference.reference?.startsWith('Practitioner/'),
    );

    const assignedAt = order.extension?.find(
      (extension) => extension.url === ASSIGNED_AT_EXTENSION_URL,
    )?.valueDateTime;

    const assignedBy = order.extension?.find(
      (extension) => extension.url === ASSIGNED_BY_EXTENSION_URL,
    )?.valueReference;

    const assignedByNameExtension = order.extension?.find(
      (extension) => extension.url === ASSIGNED_BY_NAME_EXTENSION_URL,
    )?.valueString;

    return {
      radiologistId: this.referenceId(performer?.reference, 'Practitioner'),
      radiologistName: performer?.display,
      assignedAt,
      assignedById: this.referenceId(assignedBy?.reference, 'Practitioner'),
      assignedByName: assignedBy?.display ?? assignedByNameExtension,
    };
  }

  private mapOrder(order: ServiceRequest) {
    const hospitalExtension = order.extension?.find(
      (extension) => extension.url === HOSPITAL_EXTENSION_URL,
    );

    const modalityExtension = order.extension?.find(
      (extension) => extension.url === MODALITY_EXTENSION_URL,
    );

    const clinicalQuestionExtension = order.extension?.find(
      (extension) => extension.url === CLINICAL_QUESTION_EXTENSION_URL,
    );

    const workflowUpdatedAtExtension = order.extension?.find(
      (extension) => extension.url === WORKFLOW_UPDATED_AT_EXTENSION_URL,
    );

    return {
      id: order.id,
      accessionNumber: this.accessionNumber(order),
      workflowStatus: this.workflowStatus(order),
      workflowUpdatedAt: workflowUpdatedAtExtension?.valueDateTime,

      ...this.assignedRadiologist(order),
      status: order.status,
      intent: order.intent,
      priority: order.priority ?? 'routine',

      patientId: this.referenceId(order.subject?.reference, 'Patient'),
      patientName: order.subject?.display,
      encounterId: this.referenceId(order.encounter?.reference, 'Encounter'),
      hospitalId: this.referenceId(
        hospitalExtension?.valueReference?.reference,
        'Organization',
      ),

      examCode: order.code?.coding?.[0]?.code,
      examName:
        order.code?.text ??
        order.code?.coding?.[0]?.display ??
        'Radiology Exam',

      modality: modalityExtension?.valueCode ?? 'OTHER',

      bodySiteCode: order.bodySite?.[0]?.coding?.[0]?.code,
      bodySiteName:
        order.bodySite?.[0]?.text ?? order.bodySite?.[0]?.coding?.[0]?.display,

      clinicalIndication: order.reasonCode?.[0]?.text,
      clinicalQuestion: clinicalQuestionExtension?.valueString,

      requesterId: this.referenceId(order.requester?.reference, 'Practitioner'),
      requesterName: order.requester?.display,

      authoredOn: order.authoredOn,
      notes: order.note?.map((note) => note.text).filter(Boolean),
    };
  }

  private patientDisplay(patient: Patient): string | undefined {
    const name = patient.name?.[0];

    if (!name) {
      return undefined;
    }

    if (name.text?.trim()) {
      return name.text.trim();
    }

    const generatedName = [name.given?.join(' '), name.family]
      .filter(Boolean)
      .join(' ')
      .trim();

    return generatedName || undefined;
  }

  private referenceId(reference: string | undefined, resourceType: string) {
    const prefix = `${resourceType}/`;

    if (!reference?.startsWith(prefix)) {
      return undefined;
    }

    return reference.slice(prefix.length);
  }

  private worklistLimit(value?: string) {
    if (!value?.trim()) {
      return 200;
    }

    const parsed = Number.parseInt(value, 10);

    if (!Number.isFinite(parsed) || parsed < 1) {
      throw new BadRequestException('limit must be a positive integer');
    }

    return Math.min(parsed, 1000);
  }

  private dateValue(value?: string) {
    if (!value) {
      return 0;
    }

    const time = new Date(value).getTime();

    return Number.isNaN(time) ? 0 : time;
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
}
