import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomInt } from 'node:crypto';
import type { MedplumClient } from '@medplum/core';
import type { Patient, ProjectMembership, User } from '@medplum/fhirtypes';
import { MedplumService } from '../medplum/medplum.service';
import { CreatePortalAccessDto } from './dto/portal-access.dto';

export interface PortalLogin {
  id: string;
  username?: string;
  active: boolean;
  createdAt?: string;
}

export interface PortalAccessStatus {
  patientId: string;
  hospitalId: string;
  status: 'none' | 'active' | 'disabled';
  logins: PortalLogin[];
}

const USERNAME = /^[a-z0-9][a-z0-9._+-]{1,62}(@[a-z0-9.-]+\.[a-z]{2,})?$/;

/**
 * Patient portal logins (27.2), managed by hospital staff. A login is a Medplum
 * User whose ProjectMembership in the hospital project has the patient as its
 * profile. Memberships are only visible to the provisioning (super-admin)
 * client, so every read and write here goes through it, after the patient has
 * been checked against the signed-in hospital with the API's service client.
 *
 * Passwords are never logged or stored; a generated one is returned once.
 */
@Injectable()
export class PortalAccessService {
  constructor(private readonly medplumService: MedplumService) {}

  async status(
    patientId: string,
    hospitalId: string,
  ): Promise<PortalAccessStatus> {
    await this.patientOf(patientId, hospitalId);
    const provisioning = await this.provisioning();
    const memberships = await this.memberships(provisioning, patientId);
    return this.describe(provisioning, patientId, hospitalId, memberships);
  }

  async create(
    patientId: string,
    hospitalId: string,
    dto: CreatePortalAccessDto,
  ): Promise<
    PortalAccessStatus & { username: string; temporaryPassword?: string }
  > {
    const patient = await this.patientOf(patientId, hospitalId);
    const username = this.username(dto?.username);
    const email = username.includes('@')
      ? username
      : `${username}@unitech.local`;
    const supplied = typeof dto?.password === 'string' && dto.password !== '';
    if (supplied) this.assertPasswordPolicy(dto.password as string);
    const password = supplied
      ? (dto.password as string)
      : this.generatePassword();

    const provisioning = await this.provisioning();
    const memberships = await this.memberships(provisioning, patientId);
    if (memberships.some((m) => m.active !== false))
      throw new ConflictException(
        'This patient already has an active portal login',
      );
    // A login for an existing user would attach that person (possibly staff) to
    // this patient's record, so a username can belong to one account only.
    const taken = await provisioning
      .searchResources('User', { email, _count: '1' })
      .catch(() => {
        throw new BadRequestException('Unable to check the username');
      });
    if (taken.length) throw new ConflictException('Username already exists');

    const name = patient.name?.[0];
    const firstName =
        name?.given?.[0] ?? name?.text?.split(/\s+/)[0] ?? 'Patient',
      lastName =
        name?.family ?? name?.text?.split(/\s+/).slice(1).join(' ') ?? 'Portal';
    const membership = (await provisioning.invite(this.projectId(), {
      resourceType: 'Patient',
      firstName,
      lastName: lastName || firstName,
      email,
      password,
      sendEmail: false,
      membership: { profile: { reference: `Patient/${patientId}` } },
    })) as
      | ProjectMembership
      | {
          resourceType: 'OperationOutcome';
          issue?: Array<{ diagnostics?: string }>;
        };
    if (membership.resourceType === 'OperationOutcome')
      throw new BadRequestException(
        membership.issue?.[0]?.diagnostics ??
          'Unable to create the portal login',
      );
    if (membership.profile?.reference !== `Patient/${patientId}`)
      throw new BadRequestException(
        'Medplum did not link the login to this patient',
      );

    const result = await this.describe(provisioning, patientId, hospitalId, [
      ...memberships,
      membership,
    ]);
    return {
      ...result,
      username: this.displayUsername(email),
      ...(supplied ? {} : { temporaryPassword: password }),
    };
  }

  async disable(
    patientId: string,
    hospitalId: string,
  ): Promise<PortalAccessStatus & { disabled: number }> {
    await this.patientOf(patientId, hospitalId);
    const provisioning = await this.provisioning();
    const memberships = await this.memberships(provisioning, patientId);
    const active = memberships.filter((m) => m.active !== false);
    if (!active.length)
      throw new NotFoundException('This patient has no active portal login');
    const updated = await Promise.all(
      active.map((m) =>
        provisioning.updateResource<ProjectMembership>({ ...m, active: false }),
      ),
    );
    const byId = new Map(updated.map((m) => [m.id, m]));
    const result = await this.describe(
      provisioning,
      patientId,
      hospitalId,
      memberships.map((m) => byId.get(m.id as string) ?? m),
    );
    return { ...result, disabled: updated.length };
  }

  /** The patient, only if the signed-in hospital manages it. */
  private async patientOf(patientId: string, hospitalId: string) {
    if (!patientId?.trim() || !hospitalId?.trim())
      throw new BadRequestException('patientId and hospitalId are required');
    const patient = (await this.medplumService
      .getClient()
      .readResource('Patient', patientId)
      .catch(() => undefined)) as Patient | undefined;
    if (
      !patient ||
      patient.managingOrganization?.reference !== `Organization/${hospitalId}`
    )
      throw new NotFoundException('Patient not found');
    return patient;
  }

  private projectId(): string {
    const projectId = this.medplumService.getClient().getProject()?.id;
    if (!projectId)
      throw new BadRequestException('Medplum project context is unavailable');
    return projectId;
  }

  private async provisioning(): Promise<MedplumClient> {
    try {
      return await this.medplumService.getProvisioningClient();
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error
          ? error.message
          : 'User provisioning is not configured',
      );
    }
  }

  /** The patient's memberships in this hospital's Medplum project. */
  private async memberships(
    provisioning: MedplumClient,
    patientId: string,
  ): Promise<ProjectMembership[]> {
    const project = `Project/${this.projectId()}`;
    const found = await provisioning.searchResources('ProjectMembership', {
      profile: `Patient/${patientId}`,
      _count: '50',
    });
    return found.filter(
      (m) =>
        m.project?.reference === project &&
        m.profile?.reference === `Patient/${patientId}`,
    );
  }

  private async describe(
    provisioning: MedplumClient,
    patientId: string,
    hospitalId: string,
    memberships: ProjectMembership[],
  ): Promise<PortalAccessStatus> {
    const logins = await Promise.all(
      memberships.map(async (m): Promise<PortalLogin> => {
        const userId = m.user?.reference?.startsWith('User/')
          ? m.user.reference.slice(5)
          : undefined;
        const user = userId
          ? ((await provisioning
              .readResource('User', userId)
              .catch(() => undefined)) as User | undefined)
          : undefined;
        return {
          id: m.id as string,
          username: user?.email ? this.displayUsername(user.email) : undefined,
          active: m.active !== false,
          createdAt: m.meta?.lastUpdated,
        };
      }),
    );
    return {
      patientId,
      hospitalId,
      status: logins.some((l) => l.active)
        ? 'active'
        : logins.length
          ? 'disabled'
          : 'none',
      logins,
    };
  }

  private username(value: unknown): string {
    const username =
      typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (!USERNAME.test(username))
      throw new BadRequestException(
        'Enter a username of letters, numbers, dots or dashes, or an email address',
      );
    return username;
  }

  private displayUsername(email: string): string {
    return email.replace(/@unitech\.local$/, '');
  }

  private assertPasswordPolicy(password: string) {
    if (
      password.length < 8 ||
      !/[A-Z]/.test(password) ||
      !/[a-z]/.test(password) ||
      !/[0-9]/.test(password)
    )
      throw new BadRequestException(
        'Password must be at least 8 characters and include upper-case, lower-case, and a number',
      );
  }

  /** A one-time password that meets the sign-in policy, without look-alikes. */
  private generatePassword(): string {
    const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ',
      lower = 'abcdefghijkmnpqrstuvwxyz',
      digits = '23456789',
      all = upper + lower + digits;
    const pick = (set: string) => set[randomInt(set.length)];
    const chars = [pick(upper), pick(lower), pick(digits)];
    for (let i = 0; i < 11; i++) chars.push(pick(all));
    for (let i = chars.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join('');
  }
}
