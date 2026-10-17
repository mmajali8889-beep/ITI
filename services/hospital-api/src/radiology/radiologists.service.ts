import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type {
  Identifier,
  Organization,
  Practitioner,
  PractitionerRole,
} from '@medplum/fhirtypes';

import { MedplumService } from '../medplum/medplum.service';

import { CreateRadiologistDto } from './dto/create-radiologist.dto';

import { UpdateRadiologistDto } from './dto/update-radiologist.dto';

const CLINICAL_ROLE_SYSTEM =
  'http://hospital-ehr.local/fhir/CodeSystem/clinical-role';
const RADIOLOGIST_ROLE_CODE = 'radiologist';

const EMPLOYEE_ID_SYSTEM =
  'http://hospital-ehr.local/fhir/NamingSystem/employee-id';
const MEDICAL_LICENSE_SYSTEM =
  'http://hospital-ehr.local/fhir/NamingSystem/medical-license';

@Injectable()
export class RadiologistsService {
  constructor(private readonly medplumService: MedplumService) {}

  async list(hospitalId: string, active?: string) {
    const hospital = await this.readHospital(hospitalId);

    const roles = await this.findHospitalRoles(hospitalId);

    const activeFilter = this.optionalBoolean(active);

    const filteredRoles = roles.filter(
      (role) =>
        activeFilter === undefined ||
        Boolean(role.active ?? true) === activeFilter,
    );

    const radiologists = await Promise.all(
      filteredRoles.map(async (role) => {
        const practitionerId = this.referenceId(
          role.practitioner?.reference,
          'Practitioner',
        );

        if (!practitionerId) {
          return undefined;
        }

        try {
          const practitioner = await this.medplumService
            .getClient()
            .readResource('Practitioner', practitionerId);

          return this.mapRadiologist(practitioner, role, hospital);
        } catch {
          return undefined;
        }
      }),
    );

    const items = radiologists
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));

    return {
      hospitalId,
      hospitalName: hospital.name ?? hospitalId,
      total: items.length,
      radiologists: items,
    };
  }

  async get(practitionerId: string, hospitalId: string) {
    const hospital = await this.readHospital(hospitalId);
    const practitioner = await this.readPractitioner(practitionerId);
    const role = await this.findRole(practitionerId, hospitalId);

    if (!role) {
      throw new NotFoundException(
        'Radiologist role was not found for the selected hospital.',
      );
    }

    return this.mapRadiologist(practitioner, role, hospital);
  }

  async create(dto: CreateRadiologistDto) {
    this.validateCreate(dto);

    const hospital = await this.readHospital(dto.hospitalId);

    const existingPractitioner = await this.findExistingPractitioner(dto);

    let practitioner = existingPractitioner;
    let createdPractitioner = false;

    if (!practitioner) {
      practitioner = await this.medplumService
        .getClient()
        .createResource<Practitioner>(this.buildPractitioner(dto));
      createdPractitioner = true;
    }

    if (!practitioner.id) {
      throw new BadRequestException('Practitioner was created without an ID.');
    }

    let role = await this.findRole(practitioner.id, dto.hospitalId);
    let createdRole = false;

    if (!role) {
      role = await this.medplumService
        .getClient()
        .createResource<PractitionerRole>({
          resourceType: 'PractitionerRole',
          active: dto.active ?? true,
          practitioner: {
            reference: `Practitioner/${practitioner.id}`,
            display: this.practitionerDisplay(practitioner),
          },
          organization: {
            reference: `Organization/${dto.hospitalId}`,
            display: hospital.name,
          },
          code: [
            {
              coding: [
                {
                  system: CLINICAL_ROLE_SYSTEM,
                  code: RADIOLOGIST_ROLE_CODE,
                  display: 'Radiologist',
                },
              ],
              text: 'Radiologist',
            },
          ],
          specialty: [
            {
              text: 'Radiology',
            },
          ],
        });
      createdRole = true;
    } else if (dto.active !== undefined && role.active !== dto.active) {
      role = await this.medplumService
        .getClient()
        .updateResource<PractitionerRole>({
          ...role,
          active: dto.active,
        });
    }

    return {
      createdPractitioner,
      createdRole,
      radiologist: this.mapRadiologist(practitioner, role, hospital),
    };
  }

  async update(practitionerId: string, dto: UpdateRadiologistDto) {
    if (!dto.hospitalId?.trim()) {
      throw new BadRequestException('hospitalId is required.');
    }

    const hospital = await this.readHospital(dto.hospitalId);
    const practitioner = await this.readPractitioner(practitionerId);
    let role = await this.findRole(practitionerId, dto.hospitalId);

    if (!role) {
      throw new NotFoundException(
        'Radiologist role was not found for the selected hospital.',
      );
    }

    const updatedPractitioner = await this.medplumService
      .getClient()
      .updateResource<Practitioner>(
        this.applyPractitionerUpdates(practitioner, dto),
      );

    if (dto.active !== undefined && role.active !== dto.active) {
      role = await this.medplumService
        .getClient()
        .updateResource<PractitionerRole>({
          ...role,
          active: dto.active,
        });
    }

    return this.mapRadiologist(updatedPractitioner, role, hospital);
  }

  private validateCreate(dto: CreateRadiologistDto) {
    if (!dto.hospitalId?.trim()) {
      throw new BadRequestException('hospitalId is required.');
    }
    if (!dto.givenName?.trim()) {
      throw new BadRequestException('givenName is required.');
    }
    if (!dto.familyName?.trim()) {
      throw new BadRequestException('familyName is required.');
    }
    if (!dto.employeeId?.trim() && !dto.licenseNumber?.trim()) {
      throw new BadRequestException(
        'employeeId or licenseNumber is required to prevent duplicate practitioner records.',
      );
    }
  }

  private buildPractitioner(dto: CreateRadiologistDto): Practitioner {
    return {
      resourceType: 'Practitioner',
      active: dto.active ?? true,
      identifier: this.buildIdentifiers(dto.employeeId, dto.licenseNumber),
      name: [
        {
          use: 'official',
          text: dto.displayName?.trim() || undefined,
          given: [dto.givenName.trim()],
          family: dto.familyName.trim(),
        },
      ],
      telecom: this.buildTelecom(dto.phone, dto.email),
    };
  }

  private applyPractitionerUpdates(
    practitioner: Practitioner,
    dto: UpdateRadiologistDto,
  ): Practitioner {
    const currentName = practitioner.name?.[0];

    const given =
      dto.givenName !== undefined
        ? dto.givenName.trim()
        : currentName?.given?.[0];
    const family =
      dto.familyName !== undefined
        ? dto.familyName.trim()
        : currentName?.family;
    const text =
      dto.displayName !== undefined
        ? dto.displayName.trim() || undefined
        : currentName?.text;

    return {
      ...practitioner,
      active: dto.active ?? practitioner.active,
      name: [
        {
          ...currentName,
          use: currentName?.use ?? 'official',
          text,
          given: given ? [given] : currentName?.given,
          family,
        },
        ...(practitioner.name?.slice(1) ?? []),
      ],
      identifier: this.mergeIdentifiers(
        practitioner.identifier,
        dto.employeeId,
        dto.licenseNumber,
      ),
      telecom: this.mergeTelecom(practitioner.telecom, dto.phone, dto.email),
    };
  }

  private async findExistingPractitioner(dto: CreateRadiologistDto) {
    const medplum = this.medplumService.getClient();

    const employeeId = dto.employeeId?.trim();
    const licenseNumber = dto.licenseNumber?.trim();

    const candidates = await medplum.searchResources('Practitioner', {
      _count: '500',
    });

    return candidates.find(
      (practitioner) =>
        Boolean(
          employeeId &&
          practitioner.identifier?.some(
            (identifier) =>
              identifier.system === EMPLOYEE_ID_SYSTEM &&
              identifier.value === employeeId,
          ),
        ) ||
        Boolean(
          licenseNumber &&
          practitioner.identifier?.some(
            (identifier) =>
              identifier.system === MEDICAL_LICENSE_SYSTEM &&
              identifier.value === licenseNumber,
          ),
        ),
    );
  }

  private async findHospitalRoles(
    hospitalId: string,
  ): Promise<PractitionerRole[]> {
    const medplum = this.medplumService.getClient();

    let roles: PractitionerRole[] = [];

    try {
      roles = await medplum.searchResources('PractitionerRole', {
        organization: `Organization/${hospitalId}`,
        _count: '500',
      });
    } catch {
      roles = await medplum.searchResources('PractitionerRole', {
        _count: '500',
      });
    }

    return roles.filter(
      (role) =>
        role.organization?.reference === `Organization/${hospitalId}` &&
        this.isRadiologistRole(role),
    );
  }

  private async findRole(practitionerId: string, hospitalId: string) {
    const roles = await this.findHospitalRoles(hospitalId);

    return roles.find(
      (role) =>
        role.practitioner?.reference === `Practitioner/${practitionerId}`,
    );
  }

  private isRadiologistRole(role: PractitionerRole) {
    return Boolean(
      role.code?.some((concept) =>
        concept.coding?.some(
          (coding) =>
            coding.system === CLINICAL_ROLE_SYSTEM &&
            coding.code === RADIOLOGIST_ROLE_CODE,
        ),
      ),
    );
  }

  private async readHospital(hospitalId: string): Promise<Organization> {
    if (!hospitalId?.trim()) {
      throw new BadRequestException('hospitalId is required.');
    }

    try {
      return await this.medplumService
        .getClient()
        .readResource('Organization', hospitalId);
    } catch {
      throw new NotFoundException('Hospital organization was not found.');
    }
  }

  private async readPractitioner(
    practitionerId: string,
  ): Promise<Practitioner> {
    if (!practitionerId?.trim()) {
      throw new BadRequestException('practitionerId is required.');
    }

    try {
      return await this.medplumService
        .getClient()
        .readResource('Practitioner', practitionerId);
    } catch {
      throw new NotFoundException('Practitioner was not found.');
    }
  }

  private mapRadiologist(
    practitioner: Practitioner,
    role: PractitionerRole,
    hospital: Organization,
  ) {
    const name = practitioner.name?.[0];

    return {
      practitionerId: practitioner.id,
      practitionerRoleId: role.id,
      hospitalId: hospital.id,
      hospitalName: hospital.name ?? hospital.id,
      active:
        Boolean(practitioner.active ?? true) && Boolean(role.active ?? true),
      practitionerActive: practitioner.active ?? true,
      roleActive: role.active ?? true,
      roleCode: RADIOLOGIST_ROLE_CODE,
      roleName: 'Radiologist',
      specialtyName: 'Radiology',
      displayName: this.practitionerDisplay(practitioner) ?? 'Radiologist',
      givenName: name?.given?.join(' '),
      familyName: name?.family,
      employeeId: this.identifierValue(practitioner, EMPLOYEE_ID_SYSTEM),
      licenseNumber: this.identifierValue(practitioner, MEDICAL_LICENSE_SYSTEM),
      phone: practitioner.telecom?.find((item) => item.system === 'phone')
        ?.value,
      email: practitioner.telecom?.find((item) => item.system === 'email')
        ?.value,
    };
  }

  private practitionerDisplay(practitioner: Practitioner) {
    const name = practitioner.name?.[0];

    if (name?.text?.trim()) {
      return name.text.trim();
    }

    const generated = [name?.given?.join(' '), name?.family]
      .filter(Boolean)
      .join(' ')
      .trim();

    return generated || undefined;
  }

  private buildIdentifiers(
    employeeId?: string,
    licenseNumber?: string,
  ): Identifier[] | undefined {
    const identifiers: Identifier[] = [];

    if (employeeId?.trim()) {
      identifiers.push({
        system: EMPLOYEE_ID_SYSTEM,
        value: employeeId.trim(),
      });
    }

    if (licenseNumber?.trim()) {
      identifiers.push({
        system: MEDICAL_LICENSE_SYSTEM,
        value: licenseNumber.trim(),
      });
    }

    return identifiers.length ? identifiers : undefined;
  }

  private mergeIdentifiers(
    current: Identifier[] | undefined,
    employeeId?: string,
    licenseNumber?: string,
  ) {
    let identifiers = [...(current ?? [])];

    if (employeeId !== undefined) {
      identifiers = identifiers.filter(
        (identifier) => identifier.system !== EMPLOYEE_ID_SYSTEM,
      );
      if (employeeId.trim()) {
        identifiers.push({
          system: EMPLOYEE_ID_SYSTEM,
          value: employeeId.trim(),
        });
      }
    }

    if (licenseNumber !== undefined) {
      identifiers = identifiers.filter(
        (identifier) => identifier.system !== MEDICAL_LICENSE_SYSTEM,
      );
      if (licenseNumber.trim()) {
        identifiers.push({
          system: MEDICAL_LICENSE_SYSTEM,
          value: licenseNumber.trim(),
        });
      }
    }

    return identifiers.length ? identifiers : undefined;
  }

  private buildTelecom(phone?: string, email?: string) {
    const telecom: Practitioner['telecom'] = [];

    if (phone?.trim()) {
      telecom.push({
        system: 'phone',
        use: 'work',
        value: phone.trim(),
      });
    }

    if (email?.trim()) {
      telecom.push({
        system: 'email',
        use: 'work',
        value: email.trim(),
      });
    }

    return telecom.length ? telecom : undefined;
  }

  private mergeTelecom(
    current: Practitioner['telecom'],
    phone?: string,
    email?: string,
  ) {
    let telecom = [...(current ?? [])];

    if (phone !== undefined) {
      telecom = telecom.filter((item) => item.system !== 'phone');
      if (phone.trim()) {
        telecom.push({
          system: 'phone',
          use: 'work',
          value: phone.trim(),
        });
      }
    }

    if (email !== undefined) {
      telecom = telecom.filter((item) => item.system !== 'email');
      if (email.trim()) {
        telecom.push({
          system: 'email',
          use: 'work',
          value: email.trim(),
        });
      }
    }

    return telecom.length ? telecom : undefined;
  }

  private identifierValue(practitioner: Practitioner, system: string) {
    return practitioner.identifier?.find(
      (identifier) => identifier.system === system,
    )?.value;
  }

  private referenceId(reference: string | undefined, resourceType: string) {
    if (!reference) {
      return undefined;
    }

    const prefix = `${resourceType}/`;
    return reference.startsWith(prefix)
      ? reference.slice(prefix.length)
      : undefined;
  }

  private optionalBoolean(value?: string) {
    if (value === undefined || value === '') {
      return undefined;
    }
    if (value === 'true') {
      return true;
    }
    if (value === 'false') {
      return false;
    }

    throw new BadRequestException('active must be true or false.');
  }
}
