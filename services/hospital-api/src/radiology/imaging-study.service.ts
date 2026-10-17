import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type {
  Encounter,
  ImagingStudy,
  Patient,
  ServiceRequest,
} from '@medplum/fhirtypes';

import { MedplumService } from '../medplum/medplum.service';

import {
  CreateImagingStudyDto,
  ImagingStudyStatus,
} from './dto/create-imaging-study.dto';

const HOSPITAL_EXTENSION =
  'http://hospital-ehr.local/fhir/StructureDefinition/hospital';

const ORDER_EXTENSION =
  'http://hospital-ehr.local/fhir/StructureDefinition/radiology-order';

const PACS_URL_EXTENSION =
  'http://hospital-ehr.local/fhir/StructureDefinition/pacs-study-url';

const NOTES_EXTENSION =
  'http://hospital-ehr.local/fhir/StructureDefinition/imaging-study-notes';

const ACCESSION_IDENTIFIER_SYSTEM =
  'http://hospital-ehr.local/fhir/NamingSystem/radiology-accession';

@Injectable()
export class ImagingStudyService {
  constructor(private readonly medplumService: MedplumService) {}

  async create(dto: CreateImagingStudyDto) {
    this.validateCreate(dto);

    const medplum = this.medplumService.getClient();

    const patient = await this.readPatient(dto.patientId);

    let encounter: Encounter | undefined;

    if (dto.encounterId) {
      encounter = await this.readEncounter(dto.encounterId);

      if (encounter.subject?.reference !== `Patient/${dto.patientId}`) {
        throw new BadRequestException(
          'Encounter does not belong to the selected patient.',
        );
      }
    }

    let order: ServiceRequest | undefined;

    if (dto.orderId) {
      order = await this.readOrder(dto.orderId);

      if (order.subject?.reference !== `Patient/${dto.patientId}`) {
        throw new BadRequestException(
          'Radiology order does not belong to the selected patient.',
        );
      }
    }

    const existing = await this.findByStudyInstanceUid(dto.studyInstanceUid);

    if (existing) {
      throw new BadRequestException(
        'An ImagingStudy with this Study Instance UID already exists.',
      );
    }

    const study: ImagingStudy = {
      resourceType: 'ImagingStudy',
      status: dto.status ?? 'available',

      subject: {
        reference: `Patient/${dto.patientId}`,
        display: this.patientDisplay(patient),
      },

      identifier: [
        {
          system: 'urn:dicom:uid',
          value: `urn:oid:${dto.studyInstanceUid}`,
        },
        ...(dto.accessionNumber
          ? [
              {
                system: ACCESSION_IDENTIFIER_SYSTEM,
                value: dto.accessionNumber,
              },
            ]
          : []),
      ],

      ...(encounter
        ? {
            encounter: {
              reference: `Encounter/${encounter.id}`,
            },
          }
        : {}),

      ...(dto.started
        ? {
            started: dto.started,
          }
        : {}),

      ...(dto.description
        ? {
            description: dto.description,
          }
        : {}),

      modality: [
        {
          system: 'http://dicom.nema.org/resources/ontology/DCM',
          code: dto.modality,
          display: dto.modality,
        },
      ],

      ...(dto.numberOfSeries !== undefined
        ? {
            numberOfSeries: dto.numberOfSeries,
          }
        : {}),

      ...(dto.numberOfInstances !== undefined
        ? {
            numberOfInstances: dto.numberOfInstances,
          }
        : {}),

      ...(dto.series?.length
        ? {
            series: dto.series.map((series) => ({
              uid: series.uid,

              ...(series.number !== undefined
                ? {
                    number: series.number,
                  }
                : {}),

              modality: {
                system: 'http://dicom.nema.org/resources/ontology/DCM',
                code: series.modality,
                display: series.modality,
              },

              ...(series.description
                ? {
                    description: series.description,
                  }
                : {}),

              ...(series.numberOfInstances !== undefined
                ? {
                    numberOfInstances: series.numberOfInstances,
                  }
                : {}),

              ...(series.bodySiteCode
                ? {
                    bodySite: {
                      system: 'http://snomed.info/sct',
                      code: series.bodySiteCode,
                      display: series.bodySiteName,
                    },
                  }
                : {}),
            })),
          }
        : {}),

      extension: [
        {
          url: HOSPITAL_EXTENSION,
          valueReference: {
            reference: `Organization/${dto.hospitalId}`,
          },
        },

        ...(order
          ? [
              {
                url: ORDER_EXTENSION,
                valueReference: {
                  reference: `ServiceRequest/${order.id}`,
                },
              },
            ]
          : []),

        ...(dto.pacsStudyUrl
          ? [
              {
                url: PACS_URL_EXTENSION,
                valueUrl: dto.pacsStudyUrl,
              },
            ]
          : []),

        ...(dto.notes
          ? [
              {
                url: NOTES_EXTENSION,
                valueString: dto.notes,
              },
            ]
          : []),
      ],
    };

    const created = await medplum.createResource(study);

    return this.mapStudy(created);
  }

  async findByStudyInstanceUid(studyInstanceUid: string) {
    const uid = studyInstanceUid?.trim();

    if (!uid) {
      throw new BadRequestException('studyInstanceUid is required.');
    }

    const medplum = this.medplumService.getClient();

    const studies = await medplum
      .searchResources('ImagingStudy', {
        identifier: `urn:dicom:uid|urn:oid:${uid}`,
        _count: '10',
      })
      .catch(() => [] as ImagingStudy[]);

    const match = studies.find((study) => this.studyInstanceUid(study) === uid);

    return match ? this.mapStudy(match) : undefined;
  }

  async getByAccessionNumber(accessionNumber: string) {
    const accession = accessionNumber?.trim();

    if (!accession) {
      throw new BadRequestException('accessionNumber is required.');
    }

    const studies = await this.medplumService
      .getClient()
      .searchResources('ImagingStudy', {
        identifier: `${ACCESSION_IDENTIFIER_SYSTEM}|${accession}`,
        _count: '100',
      })
      .catch(() => [] as ImagingStudy[]);

    const matched = studies.filter(
      (study) => this.accessionNumber(study) === accession,
    );

    return {
      accessionNumber: accession,
      count: matched.length,
      studies: matched
        .sort(this.newestFirst)
        .map((study) => this.mapStudy(study)),
    };
  }

  async getById(studyId: string) {
    const study = await this.readStudy(studyId);

    return this.mapStudy(study);
  }

  async getByPatient(patientId: string) {
    await this.readPatient(patientId);

    const studies = await this.medplumService
      .getClient()
      .searchResources('ImagingStudy', {
        subject: `Patient/${patientId}`,
        _count: '500',
      });

    return {
      patientId,
      studies: studies
        .sort(this.newestFirst)
        .map((study) => this.mapStudy(study)),
      count: studies.length,
    };
  }

  async getByEncounter(encounterId: string) {
    const encounter = await this.readEncounter(encounterId);

    const patientId = this.referenceId(encounter.subject?.reference, 'Patient');

    if (!patientId) {
      throw new BadRequestException('Encounter has no patient subject.');
    }

    const studies = await this.medplumService
      .getClient()
      .searchResources('ImagingStudy', {
        subject: `Patient/${patientId}`,
        _count: '500',
      });

    const filtered = studies.filter(
      (study) => study.encounter?.reference === `Encounter/${encounterId}`,
    );

    return {
      encounterId,
      studies: filtered
        .sort(this.newestFirst)
        .map((study) => this.mapStudy(study)),
      count: filtered.length,
    };
  }

  async getByOrder(orderId: string) {
    const order = await this.readOrder(orderId);

    const patientId = this.referenceId(order.subject?.reference, 'Patient');

    if (!patientId) {
      throw new BadRequestException('Radiology order has no patient subject.');
    }

    const studies = await this.medplumService
      .getClient()
      .searchResources('ImagingStudy', {
        subject: `Patient/${patientId}`,
        _count: '500',
      });

    const filtered = studies.filter(
      (study) =>
        this.extensionReference(study, ORDER_EXTENSION) ===
        `ServiceRequest/${orderId}`,
    );

    return {
      orderId,
      studies: filtered
        .sort(this.newestFirst)
        .map((study) => this.mapStudy(study)),
      count: filtered.length,
    };
  }

  async updateStatus(studyId: string, status: ImagingStudyStatus) {
    const allowed: ImagingStudyStatus[] = [
      'registered',
      'available',
      'cancelled',
      'entered-in-error',
      'unknown',
    ];

    if (!allowed.includes(status)) {
      throw new BadRequestException('Invalid ImagingStudy status.');
    }

    const study = await this.readStudy(studyId);

    const updated = await this.medplumService.getClient().updateResource({
      ...study,
      status,
    });

    return this.mapStudy(updated);
  }

  private validateCreate(dto: CreateImagingStudyDto) {
    if (!dto.patientId?.trim()) {
      throw new BadRequestException('patientId is required.');
    }

    if (!dto.hospitalId?.trim()) {
      throw new BadRequestException('hospitalId is required.');
    }

    if (!dto.studyInstanceUid?.trim()) {
      throw new BadRequestException('studyInstanceUid is required.');
    }

    if (!dto.modality?.trim()) {
      throw new BadRequestException('modality is required.');
    }
  }

  private async readPatient(id: string): Promise<Patient> {
    try {
      return await this.medplumService.getClient().readResource('Patient', id);
    } catch {
      throw new NotFoundException(`Patient ${id} was not found.`);
    }
  }

  private async readEncounter(id: string): Promise<Encounter> {
    try {
      return await this.medplumService
        .getClient()
        .readResource('Encounter', id);
    } catch {
      throw new NotFoundException(`Encounter ${id} was not found.`);
    }
  }

  private async readOrder(id: string): Promise<ServiceRequest> {
    try {
      return await this.medplumService
        .getClient()
        .readResource('ServiceRequest', id);
    } catch {
      throw new NotFoundException(`ServiceRequest ${id} was not found.`);
    }
  }

  private async readStudy(id: string): Promise<ImagingStudy> {
    try {
      return await this.medplumService
        .getClient()
        .readResource('ImagingStudy', id);
    } catch {
      throw new NotFoundException(`ImagingStudy ${id} was not found.`);
    }
  }

  private studyInstanceUid(study: ImagingStudy) {
    return study.identifier
      ?.find((identifier) => identifier.system === 'urn:dicom:uid')
      ?.value?.replace(/^urn:oid:/, '');
  }

  private accessionNumber(study: ImagingStudy) {
    return study.identifier?.find(
      (identifier) => identifier.system === ACCESSION_IDENTIFIER_SYSTEM,
    )?.value;
  }

  private referenceId(reference: string | undefined, resourceType: string) {
    const prefix = `${resourceType}/`;

    return reference?.startsWith(prefix)
      ? reference.slice(prefix.length)
      : undefined;
  }

  private extensionReference(study: ImagingStudy, url: string) {
    return study.extension?.find((extension) => extension.url === url)
      ?.valueReference?.reference;
  }

  private extensionString(study: ImagingStudy, url: string) {
    const extension = study.extension?.find((item) => item.url === url);

    return extension?.valueString ?? extension?.valueUrl;
  }

  private patientDisplay(patient: Patient): string | undefined {
    const name = patient.name?.[0];

    if (!name) {
      return undefined;
    }

    if (name.text?.trim()) {
      return name.text.trim();
    }

    const generated = [name.given?.join(' '), name.family]
      .filter(Boolean)
      .join(' ')
      .trim();

    return generated || undefined;
  }

  private newestFirst = (a: ImagingStudy, b: ImagingStudy) =>
    String(b.started ?? b.meta?.lastUpdated ?? '').localeCompare(
      String(a.started ?? a.meta?.lastUpdated ?? ''),
    );

  private mapStudy(study: ImagingStudy) {
    return {
      id: study.id,
      status: study.status,
      patientId: this.referenceId(study.subject.reference, 'Patient'),
      encounterId: this.referenceId(study.encounter?.reference, 'Encounter'),
      orderId: this.referenceId(
        this.extensionReference(study, ORDER_EXTENSION),
        'ServiceRequest',
      ),
      hospitalId: this.referenceId(
        this.extensionReference(study, HOSPITAL_EXTENSION),
        'Organization',
      ),
      studyInstanceUid: this.studyInstanceUid(study),
      accessionNumber: this.accessionNumber(study),
      started: study.started,
      description: study.description,
      modalities:
        study.modality?.map((modality) => modality.code).filter(Boolean) ?? [],
      numberOfSeries: study.numberOfSeries ?? study.series?.length ?? 0,
      numberOfInstances:
        study.numberOfInstances ??
        study.series?.reduce(
          (total, series) => total + (series.numberOfInstances ?? 0),
          0,
        ) ??
        0,
      pacsStudyUrl: this.extensionString(study, PACS_URL_EXTENSION),
      notes: this.extensionString(study, NOTES_EXTENSION),
      series:
        study.series?.map((series) => ({
          uid: series.uid,
          number: series.number,
          modality: series.modality?.code,
          description: series.description,
          numberOfInstances: series.numberOfInstances,
        })) ?? [],
      lastUpdated: study.meta?.lastUpdated,
    };
  }
}
