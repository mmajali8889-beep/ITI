import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { MedplumClient } from '@medplum/core';
import type {
  ChargeItemDefinition,
  Group,
  Location,
  Practitioner,
  PractitionerRole,
  Resource,
} from '@medplum/fhirtypes';
import { MedplumService } from '../medplum/medplum.service';
import { isBlank } from '../common/is-blank';
import {
  AssignRoleDto,
  CreateCatalogItemDto,
  CreateRoleDto,
  CreateUserProfileDto,
} from './dto/administration.dto';
import { ROLE_PERMISSIONS, permissionsForRoles } from '../auth/permissions';
const BASE = 'https://hospital-ehr.local/fhir/StructureDefinition',
  HOSPITAL = `${BASE}/admin-hospital`,
  KIND = `${BASE}/admin-kind`,
  PERMISSIONS = `${BASE}/rbac-permissions`,
  ROLE_SYSTEM = 'https://hospital-ehr.local/CodeSystem/security-role',
  // Price lists are billing tariffs too (see BillingService): one list.
  BILLING_HOSPITAL = `${BASE}/billing-hospital`,
  TARIFF_CATEGORY = `${BASE}/tariff-category`;
const BILLABLE_CATEGORIES = [
  'consultation',
  'laboratory',
  'radiology',
  'medication',
  'room-bed',
  'surgery',
  'consumable',
  'procedure',
];
const KINDS = [
  'facilities',
  'departments',
  'clinics',
  'practitioners',
  'schedules',
  'services',
  'price-lists',
  'insurance-contracts',
  'bed-configuration',
  'drug-formulary',
  'lab-catalog',
  'radiology-catalog',
  'clinical-templates',
  'reference-data',
] as const;
const DEFAULT_ROLES = [
  'receptionist',
  'nurse',
  'doctor',
  'consultant',
  'lab-technician',
  'lab-supervisor',
  'radiologist',
  'radiology-technician',
  'pharmacist',
  'cashier',
  'insurance-officer',
  'medical-records',
  'supply-chain-officer',
  'administrator',
  'system-administrator',
];
@Injectable()
export class AdministrationService {
  constructor(private readonly medplumService: MedplumService) {}
  async overview(hospitalId: string) {
    this.requireHospital(hospitalId);
    const entries = await Promise.all(
      KINDS.map(
        async (kind) =>
          [kind, (await this.catalog(hospitalId, kind)).items.length] as const,
      ),
    );
    const roles = await this.roles(hospitalId),
      users = await this.users(hospitalId);
    return {
      hospitalId,
      generatedAt: new Date().toISOString(),
      counts: {
        ...Object.fromEntries(entries),
        users: users.items.length,
        roles: roles.items.length,
      },
      supportedKinds: KINDS,
      defaultRoles: DEFAULT_ROLES,
    };
  }
  async catalog(hospitalId: string, kind: string) {
    this.requireHospital(hospitalId);
    this.assertKind(kind);
    const type = this.resourceType(kind),
      items = (await this.medplumService
        .getClient()
        .searchResources(type as never, { _count: '1000' })) as Resource[];
    return {
      kind,
      hospitalId,
      items: items
        .filter((i) => this.scoped(i, hospitalId, kind))
        .map((i) => this.map(i, kind)),
    };
  }
  async createCatalog(d: CreateCatalogItemDto) {
    this.required(d, ['hospitalId', 'kind', 'code', 'name']);
    this.assertKind(d.kind);
    if (d.kind === 'practitioners')
      throw new BadRequestException(
        'Create practitioners from User Management to provision credentials and permissions',
      );
    const ext = [
        {
          url: HOSPITAL,
          valueReference: { reference: `Organization/${d.hospitalId}` },
        },
        { url: KIND, valueCode: d.kind },
      ],
      code = {
        coding: [
          {
            system: `https://hospital-ehr.local/CodeSystem/${d.kind}`,
            code: d.code.trim(),
            display: d.name.trim(),
          },
        ],
        text: d.name.trim(),
      };
    let r: Resource;
    switch (d.kind) {
      case 'facilities':
      case 'departments':
      case 'clinics':
        r = {
          resourceType: 'Organization',
          active: true,
          name: d.name.trim(),
          identifier: [
            {
              system: `https://hospital-ehr.local/${d.kind}`,
              value: d.code.trim(),
            },
          ],
          type: [code],
          partOf: { reference: `Organization/${d.parentId || d.hospitalId}` },
          extension: ext,
        };
        break;
      case 'schedules':
        r = {
          resourceType: 'Schedule',
          active: true,
          actor: [
            {
              reference: d.parentId
                ? `Practitioner/${d.parentId}`
                : `Organization/${d.hospitalId}`,
              display: d.name.trim(),
            },
          ],
          serviceType: [code],
          extension: ext,
        };
        break;
      case 'services':
        r = {
          resourceType: 'HealthcareService',
          active: true,
          providedBy: { reference: `Organization/${d.hospitalId}` },
          name: d.name.trim(),
          comment: d.description,
          identifier: [{ value: d.code.trim() }],
          type: [code],
          specialty: d.specialty ? [{ text: d.specialty }] : undefined,
          extension: ext,
        };
        break;
      case 'price-lists':
        if (!Number.isFinite(d.price) || Number(d.price) < 0)
          throw new BadRequestException(
            'A valid non-negative price is required',
          );
        if (!d.category || !BILLABLE_CATEGORIES.includes(d.category))
          throw new BadRequestException(
            `A billing category is required: ${BILLABLE_CATEGORIES.join(', ')}`,
          );
        if (
          (await this.catalog(d.hospitalId, 'price-lists')).items.some(
            (item) => item.code === d.code.trim() && item.status === 'active',
          )
        )
          throw new ConflictException('Active price code already exists');
        r = {
          resourceType: 'ChargeItemDefinition',
          url: `https://hospital-ehr.local/price/${d.hospitalId}/${encodeURIComponent(d.code)}`,
          status: 'active',
          title: d.name.trim(),
          code,
          propertyGroup: [
            {
              priceComponent: [
                {
                  type: 'base',
                  amount: {
                    value: Number(d.price),
                    currency: d.currency || 'SAR',
                  },
                },
              ],
            },
          ],
          extension: [
            ...ext,
            {
              url: BILLING_HOSPITAL,
              valueReference: { reference: `Organization/${d.hospitalId}` },
            },
            { url: TARIFF_CATEGORY, valueString: d.category },
          ],
        } as ChargeItemDefinition;
        break;
      case 'insurance-contracts':
        r = {
          resourceType: 'Contract',
          status: 'executed',
          issued: new Date().toISOString(),
          subject: [{ reference: `Organization/${d.hospitalId}` }],
          identifier: [{ value: d.code.trim() }],
          title: d.name.trim(),
          scope: code,
          extension: ext,
        };
        break;
      case 'bed-configuration':
        r = {
          resourceType: 'Location',
          status: 'active',
          mode: 'instance',
          name: d.name.trim(),
          identifier: [{ value: d.code.trim() }],
          organization: { reference: `Organization/${d.hospitalId}` },
          partOf: d.parentId
            ? { reference: `Location/${d.parentId}` }
            : undefined,
          physicalType: {
            coding: [
              {
                system:
                  'http://terminology.hl7.org/CodeSystem/location-physical-type',
                code: 'bd',
                display: 'Bed',
              },
            ],
          },
          extension: [
            ...ext,
            { url: `${BASE}/bed-state`, valueString: 'available' },
          ],
        } as Location;
        break;
      case 'drug-formulary':
        r = {
          resourceType: 'MedicationKnowledge',
          status: 'active',
          code,
          extension: ext,
        };
        break;
      case 'lab-catalog':
      case 'radiology-catalog':
        r = {
          resourceType: 'ActivityDefinition',
          url: `https://hospital-ehr.local/catalog/${d.hospitalId}/${d.kind}/${encodeURIComponent(d.code)}`,
          status: 'active',
          name: this.safeName(d.code),
          title: d.name.trim(),
          kind: 'ServiceRequest',
          code,
          publisher: `Organization/${d.hospitalId}`,
          description: d.description,
          extension: ext,
        };
        break;
      case 'clinical-templates':
        r = {
          resourceType: 'Questionnaire',
          url: `https://hospital-ehr.local/template/${d.hospitalId}/${encodeURIComponent(d.code)}`,
          status: 'active',
          title: d.name.trim(),
          name: this.safeName(d.code),
          description: d.description,
          item: [],
          extension: ext,
        };
        break;
      default:
        r = {
          resourceType: 'CodeSystem',
          url: `https://hospital-ehr.local/reference/${d.hospitalId}/${encodeURIComponent(d.code)}`,
          status: 'active',
          content: 'complete',
          name: this.safeName(d.code),
          title: d.name.trim(),
          description: d.description,
          concept: [],
          extension: ext,
        };
    }
    return this.map(
      await this.medplumService.getClient().createResource(r),
      d.kind,
    );
  }
  async roles(hospitalId: string) {
    this.requireHospital(hospitalId);
    const groups = await this.medplumService
      .getClient()
      .searchResources('Group', { type: 'person', _count: '500' });
    const custom = groups
      .filter((g) => this.scoped(g, hospitalId, 'roles'))
      .map((g) => ({
        id: g.id,
        code: g.identifier?.[0]?.value,
        name: g.name,
        permissions: this.json<string[]>(g, PERMISSIONS) ?? [],
        managed: true,
      }));
    const used = new Set(custom.map((r) => r.code));
    return {
      items: [
        ...custom,
        ...DEFAULT_ROLES.filter((code) => !used.has(code)).map((code) => ({
          code,
          name: this.title(code),
          permissions: this.defaultPermissions(code),
          managed: false,
        })),
      ],
    };
  }
  async createRole(d: CreateRoleDto) {
    this.required(d, ['hospitalId', 'code', 'name']);
    if (!Array.isArray(d.permissions) || !d.permissions.length)
      throw new BadRequestException('At least one permission is required');
    const code = d.code.trim().toLowerCase(),
      existing = await this.roles(d.hospitalId);
    if (existing.items.some((r) => r.code === code))
      throw new ConflictException('Role code already exists');
    const g: Group = {
      resourceType: 'Group',
      type: 'person',
      actual: true,
      active: true,
      name: d.name.trim(),
      identifier: [{ system: ROLE_SYSTEM, value: code }],
      code: { coding: [{ system: ROLE_SYSTEM, code: 'rbac-role' }] },
      extension: [
        {
          url: HOSPITAL,
          valueReference: { reference: `Organization/${d.hospitalId}` },
        },
        { url: KIND, valueCode: 'roles' },
        {
          url: PERMISSIONS,
          valueString: JSON.stringify([...new Set(d.permissions)]),
        },
      ],
    };
    const made = await this.medplumService.getClient().createResource(g);
    return {
      id: made.id,
      code,
      name: made.name,
      permissions: d.permissions,
      managed: true,
    };
  }
  async users(hospitalId: string) {
    this.requireHospital(hospitalId);
    const roles = await this.medplumService
        .getClient()
        .searchResources('PractitionerRole', {
          organization: `Organization/${hospitalId}`,
          _count: '1000',
        }),
      ids = [
        ...new Set(
          roles
            .map((r) => r.practitioner?.reference?.replace('Practitioner/', ''))
            .filter((x): x is string => Boolean(x)),
        ),
      ],
      people = await Promise.all(
        ids.map((id) =>
          this.medplumService
            .getClient()
            .readResource('Practitioner', id)
            .catch(() => undefined),
        ),
      ),
      activePeople = people.filter((p) => p !== undefined);
    return {
      items: activePeople.map((p) => {
        const assigned = roles.filter(
          (r) =>
            r.practitioner?.reference === `Practitioner/${p.id}` &&
            r.active !== false,
        );
        return {
          id: p.id,
          name: p.name?.[0]?.text ?? p.name?.[0]?.family,
          identifier: p.identifier?.find(
            (i) =>
              i.system ===
              `https://hospital-ehr.local/practitioner/${hospitalId}`,
          )?.value,
          username: p.telecom
            ?.find((t) => t.system === 'email')
            ?.value?.replace(/@unitech\.local$/, ''),
          active: p.active !== false,
          roles: assigned.flatMap(
            (r) =>
              r.code?.flatMap(
                (c) =>
                  c.coding
                    ?.map((x) => x.code)
                    .filter((v): v is string => Boolean(v)) ?? [],
              ) ?? [],
          ),
          permissions: [
            ...new Set(assigned.flatMap((r) => this.parsePermissions(r))),
          ],
        };
      }),
    };
  }
  async createUser(d: CreateUserProfileDto) {
    this.required(d, [
      'hospitalId',
      'name',
      'identifier',
      'username',
      'password',
    ]);
    if (
      d.password.length < 8 ||
      !/[A-Z]/.test(d.password) ||
      !/[a-z]/.test(d.password) ||
      !/[0-9]/.test(d.password)
    )
      throw new BadRequestException(
        'Password must be at least 8 characters and include upper-case, lower-case, and a number',
      );
    const roles = [...new Set((d.roles ?? []).filter(Boolean))];
    if (!roles.length)
      throw new BadRequestException('Select at least one job role');
    const permissions = await this.permissionsForRoleCodes(d.hospitalId, roles),
      client = this.medplumService.getClient(),
      username = d.username.trim().toLowerCase(),
      email = username.includes('@') ? username : `${username}@unitech.local`;
    if (!permissions.length)
      throw new BadRequestException(
        'Selected roles do not grant any permissions',
      );
    const found = await client.searchResources('Practitioner', {
      identifier: d.identifier.trim(),
      _count: '20',
    });
    if (found.length)
      throw new ConflictException('Practitioner identifier already exists');
    const usernameFound = await client.searchResources('Practitioner', {
      email,
      _count: '20',
    });
    if (usernameFound.length)
      throw new ConflictException('Username already exists');
    const projectId = client.getProject()?.id;
    if (!projectId)
      throw new BadRequestException('Medplum project context is unavailable');
    const parts = d.name.trim().split(/\s+/),
      firstName = parts.shift() ?? d.name.trim(),
      lastName = parts.join(' ') || firstName;
    let provisioningClient: MedplumClient;
    try {
      provisioningClient = await this.medplumService.getProvisioningClient();
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error
          ? error.message
          : 'User provisioning is not configured',
      );
    }
    const membership = await provisioningClient.invite(projectId, {
      resourceType: 'Practitioner',
      firstName,
      lastName,
      email,
      password: d.password,
      sendEmail: false,
      membership: { admin: roles.includes('system-administrator') },
    });
    if (membership.resourceType === 'OperationOutcome')
      throw new BadRequestException(
        membership.issue?.[0]?.diagnostics ??
          'Unable to provision login account',
      );
    const profileId = membership.profile?.reference?.replace(
      'Practitioner/',
      '',
    );
    if (!profileId)
      throw new BadRequestException(
        'Medplum did not return the practitioner profile',
      );
    const practitioner = await client.readResource('Practitioner', profileId);
    const updated = await client.updateResource({
      ...practitioner,
      active: true,
      identifier: [
        ...(practitioner.identifier ?? []).filter(
          (i) =>
            i.system !==
            `https://hospital-ehr.local/practitioner/${d.hospitalId}`,
        ),
        {
          system: `https://hospital-ehr.local/practitioner/${d.hospitalId}`,
          value: d.identifier.trim(),
        },
      ],
      name: [{ text: d.name.trim(), family: lastName, given: [firstName] }],
      telecom: [
        ...(practitioner.telecom ?? []).filter((t) => t.system !== 'email'),
        { system: 'email', value: email, use: 'work' },
      ],
      extension: [
        ...(practitioner.extension ?? []).filter(
          (e) => e.url !== HOSPITAL && e.url !== KIND,
        ),
        {
          url: HOSPITAL,
          valueReference: { reference: `Organization/${d.hospitalId}` },
        },
        { url: KIND, valueCode: 'practitioners' },
      ],
    });
    const role: PractitionerRole = {
      resourceType: 'PractitionerRole',
      active: true,
      practitioner: {
        reference: `Practitioner/${profileId}`,
        display: d.name.trim(),
      },
      organization: { reference: `Organization/${d.hospitalId}` },
      code: roles.map((code) => ({
        coding: [{ system: ROLE_SYSTEM, code, display: this.title(code) }],
      })),
      extension: [
        {
          url: HOSPITAL,
          valueReference: { reference: `Organization/${d.hospitalId}` },
        },
        { url: PERMISSIONS, valueString: JSON.stringify(permissions) },
      ],
    };
    await client.createResource(role);
    return {
      id: updated.id,
      name: updated.name?.[0]?.text,
      identifier: d.identifier.trim(),
      username,
      active: true,
      roles,
      permissions,
      identityStatus: 'active',
    };
  }
  async assignRole(d: AssignRoleDto) {
    this.required(d, ['hospitalId', 'practitionerId', 'roleCode', 'roleName']);
    let p: Practitioner;
    try {
      p = await this.medplumService
        .getClient()
        .readResource('Practitioner', d.practitionerId);
    } catch {
      throw new NotFoundException('Practitioner not found');
    }
    if (!this.scoped(p, d.hospitalId, 'practitioners'))
      throw new NotFoundException('Practitioner not found');
    const current = await this.medplumService
      .getClient()
      .searchResources('PractitionerRole', {
        practitioner: `Practitioner/${d.practitionerId}`,
        organization: `Organization/${d.hospitalId}`,
        _count: '100',
      });
    if (
      current.some(
        (r) =>
          r.active !== false &&
          r.code?.some((c) => c.coding?.some((x) => x.code === d.roleCode)),
      )
    )
      throw new ConflictException('Role is already assigned');
    const permissions = await this.permissionsForRoleCodes(d.hospitalId, [
      d.roleCode,
    ]);
    const r: PractitionerRole = {
      resourceType: 'PractitionerRole',
      active: true,
      practitioner: {
        reference: `Practitioner/${d.practitionerId}`,
        display: p.name?.[0]?.text,
      },
      organization: { reference: `Organization/${d.hospitalId}` },
      code: [
        {
          coding: [
            { system: ROLE_SYSTEM, code: d.roleCode, display: d.roleName },
          ],
        },
      ],
      specialty: d.specialty ? [{ text: d.specialty }] : undefined,
      extension: [
        {
          url: HOSPITAL,
          valueReference: { reference: `Organization/${d.hospitalId}` },
        },
        { url: PERMISSIONS, valueString: JSON.stringify(permissions) },
      ],
    };
    const made = await this.medplumService.getClient().createResource(r);
    return {
      id: made.id,
      practitionerId: d.practitionerId,
      roleCode: d.roleCode,
      active: true,
    };
  }
  private async permissionsForRoleCodes(
    hospitalId: string,
    roleCodes: string[],
  ): Promise<string[]> {
    const defaults = roleCodes.filter((role) => DEFAULT_ROLES.includes(role));
    const customCodes = roleCodes.filter(
      (role) => !DEFAULT_ROLES.includes(role),
    );
    const permissions = permissionsForRoles(defaults);
    if (customCodes.length) {
      const configured = await this.roles(hospitalId);
      for (const code of customCodes) {
        const role = configured.items.find(
          (item) => item.code === code && item.managed,
        );
        if (!role)
          throw new BadRequestException(`Unsupported job role: ${code}`);
        permissions.push(...(role.permissions ?? []));
      }
    }
    const unique = [...new Set(permissions)];
    return unique.includes('*') ? ['*'] : unique;
  }
  private resourceType(kind: string) {
    return (
      {
        facilities: 'Organization',
        departments: 'Organization',
        clinics: 'Organization',
        practitioners: 'Practitioner',
        schedules: 'Schedule',
        services: 'HealthcareService',
        'price-lists': 'ChargeItemDefinition',
        'insurance-contracts': 'Contract',
        'bed-configuration': 'Location',
        'drug-formulary': 'MedicationKnowledge',
        'lab-catalog': 'ActivityDefinition',
        'radiology-catalog': 'ActivityDefinition',
        'clinical-templates': 'Questionnaire',
        'reference-data': 'CodeSystem',
      } as Record<string, string>
    )[kind];
  }
  private scoped(r: Resource, hospitalId: string, kind: string) {
    const x = r as Resource & {
      extension?: Array<{
        url: string;
        valueReference?: { reference?: string };
        valueCode?: string;
      }>;
      organization?: { reference?: string };
      providedBy?: { reference?: string };
      subject?: Array<{ reference?: string }>;
    };
    return (
      (x.extension?.some(
        (e) =>
          e.url === HOSPITAL &&
          e.valueReference?.reference === `Organization/${hospitalId}`,
      ) &&
        (!x.extension?.some((e) => e.url === KIND) ||
          x.extension.some((e) => e.url === KIND && e.valueCode === kind))) ||
      // Tariffs created in Billing before the lists were shared.
      (kind === 'price-lists' &&
        x.extension?.some(
          (e) =>
            e.url === BILLING_HOSPITAL &&
            e.valueReference?.reference === `Organization/${hospitalId}`,
        )) ||
      x.organization?.reference === `Organization/${hospitalId}` ||
      x.providedBy?.reference === `Organization/${hospitalId}` ||
      x.subject?.some((s) => s.reference === `Organization/${hospitalId}`) ||
      false
    );
  }
  private map(r: Resource, kind: string) {
    const x = r as Resource & {
      name?: string;
      title?: string;
      status?: string;
      active?: boolean;
      identifier?: Array<{ value?: string }>;
      code?: { coding?: Array<{ code?: string; display?: string }> };
      propertyGroup?: ChargeItemDefinition['propertyGroup'];
    };
    const amount = x.propertyGroup?.[0]?.priceComponent?.[0]?.amount;
    return {
      id: r.id,
      kind,
      resourceType: r.resourceType,
      code: x.identifier?.[0]?.value ?? x.code?.coding?.[0]?.code,
      name: x.name ?? x.title ?? x.code?.coding?.[0]?.display,
      status: x.status ?? (x.active === false ? 'inactive' : 'active'),
      price: amount?.value,
      currency: amount?.currency,
      ...(kind === 'price-lists' && {
        category: (
          r as Resource & {
            extension?: Array<{ url: string; valueString?: string }>;
          }
        ).extension?.find((e) => e.url === TARIFF_CATEGORY)?.valueString,
      }),
    };
  }
  private json<T>(r: Group, url: string): T | undefined {
    try {
      return (JSON.parse(
        r.extension?.find((e) => e.url === url)?.valueString ?? 'null',
      ) ?? undefined) as T | undefined;
    } catch {
      return undefined;
    }
  }
  private parsePermissions(r: PractitionerRole) {
    try {
      return JSON.parse(
        r.extension?.find((e) => e.url === PERMISSIONS)?.valueString ?? '[]',
      ) as string[];
    } catch {
      return [];
    }
  }
  private defaultPermissions(code: string) {
    return ROLE_PERMISSIONS[code] ?? [];
  }
  private required(d: object, fields: string[]) {
    for (const f of fields)
      if (isBlank((d as Record<string, unknown>)[f]))
        throw new BadRequestException(`${f} is required`);
  }
  private requireHospital(h: string) {
    if (!h) throw new BadRequestException('Hospital ID is required');
  }
  private assertKind(k: string) {
    if (!KINDS.includes(k as (typeof KINDS)[number]))
      throw new BadRequestException('Unsupported administration catalog');
  }
  private safeName(v: string) {
    return v.replace(/[^A-Za-z0-9_]/g, '_').replace(/^([^A-Za-z])/, '_$1');
  }
  private title(v: string) {
    return v
      .split('-')
      .map((x) => x[0]?.toUpperCase() + x.slice(1))
      .join(' ');
  }
}
