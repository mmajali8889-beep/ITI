import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type {
  Address,
  ContactPoint,
  Extension,
  HumanName,
  Identifier,
  Patient,
  PatientContact,
  Organization,
  RelatedPerson,
  Coverage,
  AllergyIntolerance,
  Basic,
} from '@medplum/fhirtypes';

import { MedplumService, isVersionConflict } from '../medplum/medplum.service';
import { CreatePatientDto } from './dto/create-patient.dto';

export interface DuplicateCheckOptions {
  hospitalId: string;
  hospitalCode: string;
  hospitalMrn?: string;
  nationalId?: string;
  passportNumber?: string;
  phone?: string;
}

const NATIONAL_ID_SYSTEM =
  'https://hospital-ehr.local/identifier/jordan-national-id';
const PASSPORT_SYSTEM = 'https://hospital-ehr.local/identifier/passport';
const MRN_SEQUENCE_SYSTEM =
  'https://hospital-ehr.local/identifier/mrn-sequence';
const MRN_SEQUENCE_VALUE_URL =
  'https://hospital-ehr.local/fhir/StructureDefinition/mrn-sequence-value';

interface PatientSearchOptions {
  search?: string;
  mrn?: string;
  nationalId?: string;
  phone?: string;
  passportNumber?: string;
  hospitalId: string;
}

@Injectable()
export class PatientsService {
  constructor(private readonly medplumService: MedplumService) {}

  // =====================================================
  // CREATE PATIENT
  // =====================================================

  async create(dto: CreatePatientDto) {
    const medplum = this.medplumService.getClient();

    this.normalizeRegistration(dto);

    // ===================================================
    // Basic Validation
    // ===================================================

    if (!dto.hospitalId) {
      throw new BadRequestException('Hospital ID is required');
    }

    if (!dto.hospitalCode) {
      throw new BadRequestException('Hospital code is required');
    }

    // Hospital MRNs are server-owned. Never trust or reuse a value submitted
    // by the browser because that would allow collisions and sequence gaps.
    dto.hospitalMrn = `${dto.hospitalCode}-000000`;

    if (!dto.registrationConfirmed) {
      throw new BadRequestException('Registration confirmation is required');
    }

    this.validateRegistration(dto);
    this.validateRegistrationLinks(dto);
    await this.assertHospital(dto.hospitalId, dto.hospitalCode);

    const identityDuplicateCheck = await this.checkRegistrationDuplicates({
      ...dto,
      hospitalMrn: undefined,
    });
    if (identityDuplicateCheck.blocking) {
      throw new ConflictException({
        message:
          'A patient with the same authoritative identifier already exists',
        code: 'PATIENT_DUPLICATE',
        matches: identityDuplicateCheck.matches,
      });
    }

    dto.hospitalMrn = await this.allocateHospitalMrn(
      dto.hospitalId,
      dto.hospitalCode,
    );

    // ===================================================
    // MRN System
    // ===================================================

    const mrnSystem = `https://hospital-ehr.local/mrn/${dto.hospitalCode}`;

    // ===================================================
    // Duplicate Hospital MRN Check
    // ===================================================

    const existingMrn = await medplum.searchResources('Patient', {
      identifier: `${mrnSystem}|${dto.hospitalMrn}`,
    });

    if (existingMrn.length > 0) {
      throw new BadRequestException('Hospital MRN already exists');
    }

    // ===================================================
    // Duplicate National ID Check
    // ===================================================

    if (dto.nationalId) {
      const nationalIdSystem =
        'https://hospital-ehr.local/identifier/jordan-national-id';

      const existingNationalId = await medplum.searchResources('Patient', {
        identifier: `${nationalIdSystem}|${dto.nationalId}`,
      });

      if (existingNationalId.length > 0) {
        throw new BadRequestException('National ID already exists');
      }
    }

    // ===================================================
    // Duplicate Passport Check
    // ===================================================

    if (dto.passportNumber) {
      const passportSystem = 'https://hospital-ehr.local/identifier/passport';

      const existingPassport = await medplum.searchResources('Patient', {
        identifier: `${passportSystem}|${dto.passportNumber}`,
      });

      if (existingPassport.length > 0) {
        throw new BadRequestException('Passport number already exists');
      }
    }

    // ===================================================
    // Identifiers
    // ===================================================

    const identifiers: Identifier[] = [];

    if (dto.enterpriseMrn) {
      identifiers.push({
        use: 'usual',

        type: {
          text: 'Enterprise MRN',
        },

        system: 'https://hospital-ehr.local/mrn/enterprise',

        value: dto.enterpriseMrn,
      });
    }

    identifiers.push({
      use: 'usual',

      type: {
        text: 'Hospital MRN',
      },

      system: mrnSystem,

      value: dto.hospitalMrn,

      assigner: {
        reference: `Organization/${dto.hospitalId}`,
      },
    });

    if (dto.nationalId) {
      identifiers.push({
        use: 'official',

        type: {
          text: 'Jordan National ID',
        },

        system: 'https://hospital-ehr.local/identifier/jordan-national-id',

        value: dto.nationalId,
      });
    }

    if (dto.passportNumber) {
      identifiers.push({
        use: 'official',

        type: {
          text: 'Passport Number',
        },

        system: 'https://hospital-ehr.local/identifier/passport',

        value: dto.passportNumber,
      });
    }

    // ===================================================
    // Arabic Name
    // ===================================================

    const names: HumanName[] = [];

    const arabicGivenNames = [dto.firstNameAr, dto.middleNameAr].filter(
      (value): value is string => Boolean(value),
    );

    const arabicNameParts = [
      dto.firstNameAr,
      dto.middleNameAr,
      dto.familyNameAr,
    ].filter((value): value is string => Boolean(value));

    names.push({
      use: 'official',

      family: dto.familyNameAr,

      given: arabicGivenNames,

      text: arabicNameParts.join(' '),

      extension: [
        {
          url: 'https://hospital-ehr.local/fhir/StructureDefinition/name-language',

          valueCode: 'ar',
        },
      ],
    });

    // ===================================================
    // English Name
    // ===================================================

    if (dto.firstNameEn || dto.familyNameEn) {
      const englishGivenNames = [dto.firstNameEn, dto.middleNameEn].filter(
        (value): value is string => Boolean(value),
      );

      const englishNameParts = [
        dto.firstNameEn,
        dto.middleNameEn,
        dto.familyNameEn,
      ].filter((value): value is string => Boolean(value));

      names.push({
        use: 'usual',

        family: dto.familyNameEn,

        given: englishGivenNames,

        text: englishNameParts.join(' '),

        extension: [
          {
            url: 'https://hospital-ehr.local/fhir/StructureDefinition/name-language',

            valueCode: 'en',
          },
        ],
      });
    }

    // ===================================================
    // Telecom
    // ===================================================

    const telecom: ContactPoint[] = [];

    if (dto.phone) {
      telecom.push({
        system: 'phone',

        value: dto.phone,

        use: 'mobile',
      });
    }

    if (dto.email) {
      telecom.push({
        system: 'email',
        value: dto.email,
        use: 'home',
      });
    }

    // ===================================================
    // Address
    // ===================================================

    const address: Address[] | undefined =
      dto.addressLine || dto.city || dto.country
        ? [
            {
              use: 'home',

              line: dto.addressLine ? [dto.addressLine] : undefined,

              city: dto.city,

              country: dto.country ?? 'JO',
            },
          ]
        : undefined;

    // ===================================================
    // Next of Kin
    // ===================================================

    const contacts: PatientContact[] = [];

    if (dto.nextOfKinName) {
      contacts.push({
        relationship: [
          {
            text: dto.nextOfKinRelationship ?? 'Next of Kin',
          },
        ],

        name: {
          text: dto.nextOfKinName,
        },

        telecom: dto.nextOfKinPhone
          ? [
              {
                system: 'phone',

                value: dto.nextOfKinPhone,
              },
            ]
          : undefined,
      });
    }

    // ===================================================
    // Extensions
    // ===================================================

    const extensions: Extension[] = [];

    if (dto.nationality) {
      extensions.push({
        url: 'https://hospital-ehr.local/fhir/StructureDefinition/nationality',

        valueString: dto.nationality,
      });
    }

    // ===================================================
    // Create FHIR Patient
    // ===================================================

    const patient = await medplum.createResource<Patient>({
      resourceType: 'Patient',

      active: true,

      identifier: identifiers,

      name: names,

      gender: dto.gender,

      birthDate: dto.birthDate,

      communication: dto.preferredLanguage
        ? [
            {
              language: {
                coding: [
                  {
                    system: 'urn:ietf:bcp:47',
                    code: dto.preferredLanguage,
                  },
                ],
                text: dto.preferredLanguage === 'ar' ? 'Arabic' : 'English',
              },
              preferred: true,
            },
          ]
        : undefined,

      maritalStatus:
        dto.maritalStatus && dto.maritalStatus !== 'unknown'
          ? {
              coding: [
                {
                  system:
                    'http://terminology.hl7.org/CodeSystem/v3-MaritalStatus',
                  code: (
                    {
                      single: 'S',
                      married: 'M',
                      divorced: 'D',
                      widowed: 'W',
                    } as const
                  )[dto.maritalStatus],
                },
              ],
              text: dto.maritalStatus,
            }
          : undefined,

      telecom: telecom.length > 0 ? telecom : undefined,

      address,

      contact: contacts.length > 0 ? contacts : undefined,

      photo: dto.photoBase64
        ? [
            {
              contentType: dto.photoContentType ?? 'image/jpeg',
              data: dto.photoBase64,
            },
          ]
        : undefined,

      extension: extensions.length > 0 ? extensions : undefined,

      managingOrganization: {
        reference: `Organization/${dto.hospitalId}`,
      },
    });

    const linked = await this.createRegistrationLinks(patient, dto);
    return { ...this.mapPatient(patient), ...linked };
  }

  async checkRegistrationDuplicates(options: DuplicateCheckOptions) {
    if (!options.hospitalId || !options.hospitalCode) {
      throw new BadRequestException('Hospital ID and code are required');
    }

    const checks = [
      options.hospitalMrn && {
        kind: 'hospital-mrn',
        identifier: `${this.mrnSystem(options.hospitalCode)}|${options.hospitalMrn.trim().toUpperCase()}`,
      },
      options.nationalId && {
        kind: 'national-id',
        identifier: `${NATIONAL_ID_SYSTEM}|${options.nationalId.replace(/\s/g, '')}`,
      },
      options.passportNumber && {
        kind: 'passport',
        identifier: `${PASSPORT_SYSTEM}|${options.passportNumber.trim().toUpperCase()}`,
      },
    ].filter((value): value is { kind: string; identifier: string } =>
      Boolean(value),
    );

    const medplum = this.medplumService.getClient();
    const results = await Promise.all(
      checks.map(async (check) => ({
        kind: check.kind,
        patients: await medplum.searchResources('Patient', {
          identifier: check.identifier,
          _count: '5',
        }),
      })),
    );

    const unique = new Map<
      string,
      {
        id: string;
        name?: string;
        hospitalId?: string;
        matchedBy: string[];
      }
    >();

    for (const result of results) {
      for (const patient of result.patients) {
        if (!patient.id) continue;
        const current = unique.get(patient.id) ?? {
          id: patient.id,
          name: patient.name?.[0]?.text,
          hospitalId: patient.managingOrganization?.reference?.replace(
            'Organization/',
            '',
          ),
          matchedBy: [],
        };
        current.matchedBy.push(result.kind);
        unique.set(patient.id, current);
      }
    }

    const matches = [...unique.values()];
    return {
      checked: checks.map((check) => check.kind),
      blocking: matches.length > 0,
      matches,
    };
  }

  private normalizeRegistration(dto: CreatePatientDto): void {
    const clean = (value?: string) => value?.trim() || undefined;
    dto.hospitalId = dto.hospitalId?.trim();
    dto.hospitalCode = dto.hospitalCode?.trim().toUpperCase();
    dto.hospitalMrn = dto.hospitalMrn?.trim().toUpperCase();
    dto.enterpriseMrn = clean(dto.enterpriseMrn)?.toUpperCase();
    dto.nationalId = clean(dto.nationalId)?.replace(/\s/g, '');
    dto.passportNumber = clean(dto.passportNumber)?.toUpperCase();
    dto.firstNameAr = dto.firstNameAr?.trim();
    dto.middleNameAr = clean(dto.middleNameAr);
    dto.familyNameAr = dto.familyNameAr?.trim();
    dto.firstNameEn = clean(dto.firstNameEn);
    dto.middleNameEn = clean(dto.middleNameEn);
    dto.familyNameEn = clean(dto.familyNameEn);
    dto.phone = clean(dto.phone)?.replace(/[\s()-]/g, '');
    dto.email = clean(dto.email)?.toLowerCase();
    dto.photoBase64 = clean(dto.photoBase64)?.replace(
      /^data:image\/(?:jpeg|png|webp);base64,/,
      '',
    );
  }

  private validateRegistration(dto: CreatePatientDto): void {
    if (!dto.firstNameAr || !dto.familyNameAr) {
      throw new BadRequestException(
        'Arabic first and family names are required',
      );
    }
    const arabicName = /^[\u0600-\u06FF\s'-]{2,80}$/;
    if (
      !arabicName.test(dto.firstNameAr) ||
      !arabicName.test(dto.familyNameAr)
    ) {
      throw new BadRequestException('Arabic names contain invalid characters');
    }
    if (!['male', 'female', 'other', 'unknown'].includes(dto.gender)) {
      throw new BadRequestException('Invalid gender');
    }
    const birthDate = new Date(`${dto.birthDate}T00:00:00Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(dto.birthDate) ||
      Number.isNaN(birthDate.getTime()) ||
      birthDate > new Date()
    ) {
      throw new BadRequestException(
        'A valid non-future birth date is required',
      );
    }
    if (dto.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dto.email)) {
      throw new BadRequestException('Invalid email address');
    }
    if (dto.phone && !/^\+?[0-9]{8,15}$/.test(dto.phone)) {
      throw new BadRequestException('Invalid phone number');
    }
    if (dto.nationalId && !/^[0-9]{8,12}$/.test(dto.nationalId)) {
      throw new BadRequestException('Invalid national ID');
    }
    if (dto.passportNumber && !/^[A-Z0-9]{5,20}$/.test(dto.passportNumber)) {
      throw new BadRequestException('Invalid passport number');
    }
    if (!dto.hospitalMrn || !/^[A-Z0-9-]{3,30}$/.test(dto.hospitalMrn)) {
      throw new BadRequestException('Invalid hospital MRN format');
    }
    if (
      dto.photoBase64 &&
      (!dto.photoContentType ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(dto.photoBase64) ||
        Buffer.byteLength(dto.photoBase64, 'base64') > 5 * 1024 * 1024)
    ) {
      throw new BadRequestException(
        'Patient photo must be JPEG, PNG, or WebP and no larger than 5 MB',
      );
    }
  }

  private async assertHospital(
    hospitalId: string,
    hospitalCode: string,
  ): Promise<void> {
    let hospital: Organization;
    try {
      hospital = await this.medplumService
        .getClient()
        .readResource('Organization', hospitalId);
    } catch {
      throw new BadRequestException('Selected hospital does not exist');
    }
    const code = hospital.identifier?.find(
      (item) => item.system === 'https://hospital-ehr.local/organization-code',
    )?.value;
    if (!hospital.active || code !== hospitalCode) {
      throw new BadRequestException('Selected hospital identity is invalid');
    }
  }

  private mrnSystem(hospitalCode: string): string {
    return `https://hospital-ehr.local/mrn/${hospitalCode.trim().toUpperCase()}`;
  }

  private async allocateHospitalMrn(
    hospitalId: string,
    hospitalCode: string,
  ): Promise<string> {
    const client = this.medplumService.getClient();
    const identifierValue = hospitalId;
    const query = `identifier=${encodeURIComponent(MRN_SEQUENCE_SYSTEM)}|${encodeURIComponent(identifierValue)}`;
    const seed = await this.highestExistingMrnSequence(
      hospitalId,
      hospitalCode,
    );

    let counter = await client.createResourceIfNoneExist<Basic>(
      {
        resourceType: 'Basic',
        code: {
          coding: [
            {
              system: MRN_SEQUENCE_SYSTEM,
              code: 'hospital-mrn-sequence',
              display: 'Hospital MRN Sequence',
            },
          ],
        },
        identifier: [{ system: MRN_SEQUENCE_SYSTEM, value: identifierValue }],
        subject: { reference: `Organization/${hospitalId}` },
        // Basic.created is a FHIR `date`, not a `dateTime`.
        created: new Date().toISOString().slice(0, 10),
        extension: [{ url: MRN_SEQUENCE_VALUE_URL, valueInteger: seed }],
      },
      query,
    );

    // Compare-and-swap on the counter's version: a parallel registration that
    // wins the race makes ours fail with a version conflict, and we retry.
    const attempts = 20;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const current =
        counter.extension?.find(
          (extension) => extension.url === MRN_SEQUENCE_VALUE_URL,
        )?.valueInteger ?? 0;
      const next = Math.max(current, seed) + 1;

      try {
        counter = await this.medplumService.updateIfUnchanged<Basic>({
          ...counter,
          extension: [
            ...(counter.extension ?? []).filter(
              (extension) => extension.url !== MRN_SEQUENCE_VALUE_URL,
            ),
            { url: MRN_SEQUENCE_VALUE_URL, valueInteger: next },
          ],
        });
        return `${hospitalCode}-${String(next).padStart(6, '0')}`;
      } catch (error) {
        if (
          !counter.id ||
          !isVersionConflict(error) ||
          attempt === attempts - 1
        )
          throw error;
        await new Promise((resolve) =>
          setTimeout(resolve, 20 + Math.random() * 80),
        );
        counter = await client.readResource('Basic', counter.id);
      }
    }

    throw new ConflictException('Unable to allocate a unique hospital MRN');
  }

  private async highestExistingMrnSequence(
    hospitalId: string,
    hospitalCode: string,
  ): Promise<number> {
    const patients = await this.medplumService
      .getClient()
      .searchResources('Patient', {
        organization: `Organization/${hospitalId}`,
        _count: '1000',
      });
    const system = this.mrnSystem(hospitalCode);
    const expression = new RegExp(
      `^${hospitalCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)$`,
    );
    return patients.reduce((highest, patient) => {
      const value = patient.identifier?.find(
        (identifier) => identifier.system === system,
      )?.value;
      const sequence = value?.match(expression)?.[1];
      return sequence ? Math.max(highest, Number(sequence)) : highest;
    }, 0);
  }

  private validateRegistrationLinks(dto: CreatePatientDto): void {
    if (dto.insurance) {
      for (const field of [
        'payerId',
        'payerName',
        'subscriberId',
        'validFrom',
      ] as const)
        if (!dto.insurance[field]?.trim())
          throw new BadRequestException(`Insurance ${field} is required`);
      const start = new Date(dto.insurance.validFrom);
      const end = dto.insurance.validTo
        ? new Date(dto.insurance.validTo)
        : undefined;
      if (
        Number.isNaN(start.getTime()) ||
        (end && (Number.isNaN(end.getTime()) || end < start))
      )
        throw new BadRequestException('Invalid insurance validity period');
    }
    for (const allergy of dto.knownAllergies ?? [])
      if (!allergy.substance?.trim())
        throw new BadRequestException('Known allergy substance is required');
  }

  private async createRegistrationLinks(
    patient: Patient,
    dto: CreatePatientDto,
  ) {
    const client = this.medplumService.getClient();
    let relatedPersonId: string | undefined;
    let coverageId: string | undefined;
    const allergyIds: string[] = [];
    if (dto.nextOfKinName && patient.id) {
      const related = await client.createResource<RelatedPerson>({
        resourceType: 'RelatedPerson',
        active: true,
        patient: { reference: `Patient/${patient.id}` },
        relationship: [{ text: dto.nextOfKinRelationship ?? 'Next of Kin' }],
        name: [{ text: dto.nextOfKinName }],
        telecom: dto.nextOfKinPhone
          ? [{ system: 'phone', value: dto.nextOfKinPhone }]
          : undefined,
      });
      relatedPersonId = related.id;
    }
    if (dto.insurance && patient.id) {
      const start = new Date(dto.insurance.validFrom);
      const end = dto.insurance.validTo
        ? new Date(dto.insurance.validTo)
        : undefined;
      const coverage = await client.createResource<Coverage>({
        resourceType: 'Coverage',
        status: 'active',
        beneficiary: { reference: `Patient/${patient.id}` },
        subscriberId: dto.insurance.subscriberId,
        payor: [
          {
            reference: `Organization/${dto.insurance.payerId}`,
            display: dto.insurance.payerName,
          },
        ],
        type: { text: dto.insurance.planName ?? 'Health insurance' },
        period: {
          start: start.toISOString(),
          ...(end ? { end: end.toISOString() } : {}),
        },
        class: dto.insurance.policyNumber
          ? [{ type: { text: 'Policy' }, value: dto.insurance.policyNumber }]
          : undefined,
        extension: [
          {
            url: 'https://hospital-ehr.local/fhir/StructureDefinition/financial-hospital',
            valueReference: { reference: `Organization/${dto.hospitalId}` },
          },
        ],
      });
      coverageId = coverage.id;
    }
    for (const allergy of dto.knownAllergies ?? []) {
      const created = await client.createResource<AllergyIntolerance>({
        resourceType: 'AllergyIntolerance',
        patient: { reference: `Patient/${patient.id}` },
        clinicalStatus: {
          coding: [
            {
              system:
                'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical',
              code: 'active',
            },
          ],
        },
        verificationStatus: {
          coding: [
            {
              system:
                'http://terminology.hl7.org/CodeSystem/allergyintolerance-verification',
              code: 'unconfirmed',
            },
          ],
        },
        code: {
          coding: allergy.code
            ? [
                {
                  system: 'https://hospital-ehr.local/CodeSystem/allergens',
                  code: allergy.code,
                  display: allergy.substance.trim(),
                },
              ]
            : undefined,
          text: allergy.substance.trim(),
        },
        criticality: allergy.criticality,
        reaction: allergy.reaction
          ? [{ manifestation: [{ text: allergy.reaction }] }]
          : undefined,
        recordedDate: new Date().toISOString(),
        extension: [
          {
            url: 'https://hospital-ehr.local/fhir/StructureDefinition/allergy-hospital',
            valueReference: { reference: `Organization/${dto.hospitalId}` },
          },
        ],
      });
      if (created.id) allergyIds.push(created.id);
    }
    return { relatedPersonId, coverageId, allergyIds };
  }

  // =====================================================
  // SEARCH / LIST PATIENTS
  // =====================================================

  async findAll(options: PatientSearchOptions) {
    if (!options.hospitalId?.trim()) {
      throw new BadRequestException('hospitalId is required');
    }
    const medplum = this.medplumService.getClient();

    let patients: Patient[] = [];

    // ===================================================
    // Search By National ID
    // ===================================================

    if (options.nationalId) {
      patients = await medplum.searchResources('Patient', {
        identifier: `https://hospital-ehr.local/identifier/jordan-national-id|${options.nationalId}`,
      });

      return this.filterAndMapPatients(patients, options);
    }

    if (options.passportNumber) {
      patients = await medplum.searchResources('Patient', {
        identifier: `${PASSPORT_SYSTEM}|${options.passportNumber.trim().toUpperCase()}`,
      });
      return this.filterAndMapPatients(patients, options);
    }

    // ===================================================
    // Search By MRN
    // ===================================================

    if (options.mrn) {
      patients = await medplum.searchResources('Patient', {
        identifier: options.mrn,
      });

      return this.filterAndMapPatients(patients, options);
    }

    // ===================================================
    // Search By Phone
    // ===================================================

    if (options.phone) {
      patients = await medplum.searchResources('Patient', {
        telecom: options.phone,
      });

      return this.filterAndMapPatients(patients, options);
    }

    // ===================================================
    // General Search
    // ===================================================

    if (options.search) {
      const searchText = options.search.trim();

      if (!searchText) {
        patients = await medplum.searchResources('Patient', {
          _count: '50',
        });

        return this.filterAndMapPatients(patients, options);
      }

      // -----------------------------------------------
      // Try identifier first
      // -----------------------------------------------

      const identifierResults = await medplum.searchResources('Patient', {
        identifier: searchText,
      });

      if (identifierResults.length > 0) {
        return this.filterAndMapPatients(identifierResults, options);
      }

      // -----------------------------------------------
      // Try phone
      // -----------------------------------------------

      const phoneResults = await medplum.searchResources('Patient', {
        telecom: searchText,
      });

      if (phoneResults.length > 0) {
        return this.filterAndMapPatients(phoneResults, options);
      }

      // -----------------------------------------------
      // Search Name
      // -----------------------------------------------

      patients = await medplum.searchResources('Patient', {
        name: searchText,

        _count: '50',
      });

      return this.filterAndMapPatients(patients, options);
    }

    // ===================================================
    // List Patients
    // ===================================================

    patients = await medplum.searchResources('Patient', {
      _count: '50',
    });

    return this.filterAndMapPatients(patients, options);
  }

  // =====================================================
  // GET PATIENT BY ID
  // =====================================================

  async findById(patientId: string, hospitalId: string) {
    if (!hospitalId?.trim()) {
      throw new BadRequestException('hospitalId is required');
    }

    const medplum = this.medplumService.getClient();

    let patient: Patient;

    try {
      patient = await medplum.readResource('Patient', patientId);
    } catch {
      throw new NotFoundException('Patient not found');
    }

    if (
      patient.managingOrganization?.reference !== `Organization/${hospitalId}`
    ) {
      throw new NotFoundException('Patient not found');
    }

    return this.mapPatient(patient);
  }

  // =====================================================
  // FILTER PATIENTS BY HOSPITAL
  // =====================================================

  private filterAndMapPatients(
    patients: Patient[],
    options: PatientSearchOptions,
  ) {
    let filteredPatients = patients;

    if (options.hospitalId) {
      const hospitalReference = `Organization/${options.hospitalId}`;

      filteredPatients = patients.filter(
        (patient) =>
          patient.managingOrganization?.reference === hospitalReference,
      );
    }

    return {
      total: filteredPatients.length,

      patients: filteredPatients.map((patient) => this.mapPatient(patient)),
    };
  }

  // =====================================================
  // MAP FHIR PATIENT TO API RESPONSE
  // =====================================================

  private mapPatient(patient: Patient) {
    const identifiers = patient.identifier ?? [];

    // ===================================================
    // Enterprise MRN
    // ===================================================

    const enterpriseMrn = identifiers.find(
      (identifier) =>
        identifier.system === 'https://hospital-ehr.local/mrn/enterprise',
    )?.value;

    // ===================================================
    // Hospital MRN
    // ===================================================

    const hospitalIdentifier = identifiers.find(
      (identifier) =>
        identifier.system?.startsWith('https://hospital-ehr.local/mrn/') &&
        identifier.system !== 'https://hospital-ehr.local/mrn/enterprise',
    );

    const hospitalMrn = hospitalIdentifier?.value;

    // ===================================================
    // National ID
    // ===================================================

    const nationalId = identifiers.find(
      (identifier) =>
        identifier.system ===
        'https://hospital-ehr.local/identifier/jordan-national-id',
    )?.value;

    // ===================================================
    // Passport
    // ===================================================

    const passportNumber = identifiers.find(
      (identifier) =>
        identifier.system === 'https://hospital-ehr.local/identifier/passport',
    )?.value;

    // ===================================================
    // Arabic Name
    // ===================================================

    const arabicName = patient.name?.find((name) =>
      name.extension?.some(
        (extension) =>
          extension.url ===
            'https://hospital-ehr.local/fhir/StructureDefinition/name-language' &&
          extension.valueCode === 'ar',
      ),
    );

    // ===================================================
    // English Name
    // ===================================================

    const englishName = patient.name?.find((name) =>
      name.extension?.some(
        (extension) =>
          extension.url ===
            'https://hospital-ehr.local/fhir/StructureDefinition/name-language' &&
          extension.valueCode === 'en',
      ),
    );

    // ===================================================
    // Phone
    // ===================================================

    const phone = patient.telecom?.find(
      (telecom) => telecom.system === 'phone',
    )?.value;

    const email = patient.telecom?.find(
      (telecom) => telecom.system === 'email',
    )?.value;

    // ===================================================
    // Nationality
    // ===================================================

    const nationality = patient.extension?.find(
      (extension) =>
        extension.url ===
        'https://hospital-ehr.local/fhir/StructureDefinition/nationality',
    )?.valueString;

    // ===================================================
    // Hospital ID
    // ===================================================

    const hospitalId = patient.managingOrganization?.reference?.replace(
      'Organization/',
      '',
    );

    // ===================================================
    // Response
    // ===================================================

    return {
      id: patient.id,

      resourceType: patient.resourceType,

      active: patient.active,

      hospitalId,

      hospitalMrn,

      enterpriseMrn,

      nationalId,

      passportNumber,

      nameAr: arabicName?.text,

      nameEn: englishName?.text,

      gender: patient.gender,

      birthDate: patient.birthDate,

      phone,

      email,

      nationality,

      address: patient.address?.[0],

      nextOfKin: patient.contact?.[0],

      managingOrganization: patient.managingOrganization,
    };
  }
}
