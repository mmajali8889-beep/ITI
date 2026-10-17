import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type {
  AllergyIntolerance,
  Encounter,
  Patient,
} from '@medplum/fhirtypes';

import { MedplumService } from '../medplum/medplum.service';

import { CreateAllergyDto } from './dto/create-allergy.dto';

@Injectable()
export class AllergiesService {
  constructor(private readonly medplumService: MedplumService) {}

  // =====================================================
  // CREATE ALLERGY
  // =====================================================

  async create(dto: CreateAllergyDto) {
    const medplum = this.medplumService.getClient();

    if (!dto.patientId) {
      throw new BadRequestException('Patient ID is required');
    }

    if (!dto.hospitalId) {
      throw new BadRequestException('Hospital ID is required');
    }

    if (!dto.code) {
      throw new BadRequestException('Allergy code is required');
    }

    if (!dto.display) {
      throw new BadRequestException('Allergy description is required');
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

    if (dto.encounterId) {
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
    // ONSET DATE
    // ===================================================

    let onsetDateTime: string | undefined;

    if (dto.onsetDateTime) {
      const date = new Date(dto.onsetDateTime);

      if (Number.isNaN(date.getTime())) {
        throw new BadRequestException('Invalid onset date');
      }

      onsetDateTime = date.toISOString();
    }

    // ===================================================
    // BUILD FHIR ALLERGY INTOLERANCE
    // ===================================================

    const allergy: AllergyIntolerance = {
      resourceType: 'AllergyIntolerance',

      clinicalStatus: {
        coding: [
          {
            system:
              'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical',

            code: dto.clinicalStatus ?? 'active',

            display: this.formatDisplay(dto.clinicalStatus ?? 'active'),
          },
        ],
      },

      verificationStatus: {
        coding: [
          {
            system:
              'http://terminology.hl7.org/CodeSystem/allergyintolerance-verification',

            code: dto.verificationStatus ?? 'confirmed',

            display: this.formatDisplay(dto.verificationStatus ?? 'confirmed'),
          },
        ],
      },

      type: dto.type ?? 'allergy',

      category: dto.category ? [dto.category] : undefined,

      criticality: dto.criticality,

      code: {
        coding: [
          {
            system: 'https://hospital-ehr.local/CodeSystem/allergy',

            code: dto.code,

            display: dto.display,
          },
        ],

        text: dto.display,
      },

      patient: {
        reference: `Patient/${dto.patientId}`,
      },

      encounter: dto.encounterId
        ? {
            reference: `Encounter/${dto.encounterId}`,
          }
        : undefined,

      onsetDateTime,

      recordedDate: new Date().toISOString(),

      note: dto.note
        ? [
            {
              text: dto.note,
            },
          ]
        : undefined,

      extension: [
        {
          url: 'https://hospital-ehr.local/fhir/StructureDefinition/allergy-hospital',

          valueReference: {
            reference: `Organization/${dto.hospitalId}`,
          },
        },
      ],
    };

    // ===================================================
    // REACTION
    // ===================================================

    if (dto.reaction) {
      allergy.reaction = [
        {
          manifestation: [
            {
              text: dto.reaction,
            },
          ],

          severity: dto.severity,
        },
      ];
    }

    // ===================================================
    // SAVE
    // ===================================================

    const created = await medplum.createResource<AllergyIntolerance>(allergy);

    return this.mapAllergy(created);
  }

  // =====================================================
  // GET PATIENT ALLERGIES
  // =====================================================

  async findByPatient(patientId: string) {
    if (!patientId) {
      throw new BadRequestException('Patient ID is required');
    }

    const medplum = this.medplumService.getClient();

    const result = await medplum.searchResources('AllergyIntolerance', {
      patient: `Patient/${patientId}`,

      _count: '200',
    });

    const allergies: AllergyIntolerance[] = [...result];

    allergies.sort((a, b) => {
      const aDate = a.recordedDate ? new Date(a.recordedDate).getTime() : 0;

      const bDate = b.recordedDate ? new Date(b.recordedDate).getTime() : 0;

      return bDate - aDate;
    });

    return {
      total: allergies.length,

      allergies: allergies.map((allergy) => this.mapAllergy(allergy)),
    };
  }

  // =====================================================
  // GET ALLERGY BY ID
  // =====================================================

  async findById(allergyId: string) {
    if (!allergyId) {
      throw new BadRequestException('Allergy ID is required');
    }

    const medplum = this.medplumService.getClient();

    let allergy: AllergyIntolerance;

    try {
      allergy = await medplum.readResource('AllergyIntolerance', allergyId);
    } catch {
      throw new NotFoundException('Allergy not found');
    }

    return this.mapAllergy(allergy);
  }

  // =====================================================
  // UPDATE STATUS
  // =====================================================

  async updateStatus(allergyId: string, clinicalStatus: string) {
    const allowedStatuses = ['active', 'inactive', 'resolved'];

    if (!allowedStatuses.includes(clinicalStatus)) {
      throw new BadRequestException('Invalid allergy clinical status');
    }

    const medplum = this.medplumService.getClient();

    let allergy: AllergyIntolerance;

    try {
      allergy = await medplum.readResource('AllergyIntolerance', allergyId);
    } catch {
      throw new NotFoundException('Allergy not found');
    }

    allergy.clinicalStatus = {
      coding: [
        {
          system:
            'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical',

          code: clinicalStatus,

          display: this.formatDisplay(clinicalStatus),
        },
      ],
    };

    const updated = await medplum.updateResource<AllergyIntolerance>(allergy);

    return this.mapAllergy(updated);
  }

  // =====================================================
  // MAP FHIR -> API
  // =====================================================

  private mapAllergy(allergy: AllergyIntolerance) {
    const clinicalStatus = allergy.clinicalStatus?.coding?.[0]?.code;

    const verificationStatus = allergy.verificationStatus?.coding?.[0]?.code;

    const code = allergy.code?.coding?.[0]?.code;

    const display = allergy.code?.text ?? allergy.code?.coding?.[0]?.display;

    const patientId = allergy.patient?.reference?.replace('Patient/', '');

    const encounterId = allergy.encounter?.reference?.replace('Encounter/', '');

    const hospitalId = allergy.extension
      ?.find(
        (extension) =>
          extension.url ===
          'https://hospital-ehr.local/fhir/StructureDefinition/allergy-hospital',
      )
      ?.valueReference?.reference?.replace('Organization/', '');

    const reaction = allergy.reaction?.[0]?.manifestation?.[0]?.text;

    const severity = allergy.reaction?.[0]?.severity;

    return {
      id: allergy.id,

      resourceType: allergy.resourceType,

      patientId,

      encounterId,

      hospitalId,

      clinicalStatus,

      verificationStatus,

      type: allergy.type,

      category: allergy.category?.[0],

      criticality: allergy.criticality,

      code,

      display,

      reaction,

      severity,

      onsetDateTime: allergy.onsetDateTime,

      recordedDate: allergy.recordedDate,

      note: allergy.note?.[0]?.text,
    };
  }

  // =====================================================
  // FORMAT DISPLAY
  // =====================================================

  private formatDisplay(value: string) {
    return value
      .split('-')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }
}
