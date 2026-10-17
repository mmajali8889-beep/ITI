import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { MedplumClient, getDisplayString } from '@medplum/core';
import type { ProfileResource } from '@medplum/core';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AuthSession } from './auth.types';
import { PERMISSIONS_EXTENSION, permissionsForRoles } from './permissions';

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const REMEMBERED_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

@Injectable()
export class AuthService {
  private readonly sessions = new Map<string, AuthSession>();
  private readonly revokedSessions = new Set<string>();
  private readonly sessionSecret = this.getSessionSecret();

  private getSessionSecret(): string {
    const configured = process.env.AUTH_SESSION_SECRET?.trim();
    if (configured) {
      if (configured.length < 32) {
        throw new Error('AUTH_SESSION_SECRET must be at least 32 characters');
      }
      return configured;
    }
    if (process.env.NODE_ENV === 'production') {
      throw new Error('AUTH_SESSION_SECRET is required in production');
    }
    return 'unitech-ehr-local-development-session-secret-v1';
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.sessionSecret)
      .update(payload)
      .digest('base64url');
  }

  private createSessionToken(session: Omit<AuthSession, 'id'>): string {
    const payload = Buffer.from(
      JSON.stringify({
        v: 1,
        hospitalId: session.hospitalId,
        expiresAt: session.expiresAt,
        profileId: session.profile.id,
        profileType: session.profile.resourceType,
        display: getDisplayString(session.profile),
        roles: session.roles,
        permissions: session.permissions,
      }),
    ).toString('base64url');
    return `${payload}.${this.sign(payload)}`;
  }

  private restoreSession(token: string): AuthSession | undefined {
    const [payload, signature, extra] = token.split('.');
    if (!payload || !signature || extra) return undefined;
    const expected = Buffer.from(this.sign(payload));
    const received = Buffer.from(signature);
    if (
      expected.length !== received.length ||
      !timingSafeEqual(expected, received)
    ) {
      return undefined;
    }
    try {
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as {
        v: number;
        hospitalId: string;
        expiresAt: number;
        profileId?: string;
        profileType: 'Practitioner' | 'Patient' | 'Bot';
        display: string;
        roles: string[];
        permissions: string[];
      };
      if (
        claims.v !== 1 ||
        !claims.hospitalId ||
        !claims.profileId ||
        !Number.isFinite(claims.expiresAt) ||
        claims.expiresAt <= Date.now() ||
        !Array.isArray(claims.roles) ||
        !Array.isArray(claims.permissions)
      ) {
        return undefined;
      }
      const profile = {
        resourceType: claims.profileType,
        id: claims.profileId,
        name: [{ text: claims.display }],
      } as ProfileResource;
      return {
        id: token,
        hospitalId: claims.hospitalId,
        expiresAt: claims.expiresAt,
        profile,
        roles: claims.roles,
        permissions: claims.permissions,
        medplum: new MedplumClient({ baseUrl: process.env.MEDPLUM_BASE_URL }),
      };
    } catch {
      return undefined;
    }
  }

  private matchesDevelopmentAdmin(username: string, password: string): boolean {
    if (process.env.NODE_ENV === 'production') return false;

    const expectedUsername = process.env.DEV_ADMIN_USERNAME ?? 'admin';
    const expectedPassword = process.env.DEV_ADMIN_PASSWORD ?? 'admin';
    const usernameBuffer = Buffer.from(username);
    const passwordBuffer = Buffer.from(password);
    const expectedUsernameBuffer = Buffer.from(expectedUsername);
    const expectedPasswordBuffer = Buffer.from(expectedPassword);

    return (
      usernameBuffer.length === expectedUsernameBuffer.length &&
      passwordBuffer.length === expectedPasswordBuffer.length &&
      timingSafeEqual(usernameBuffer, expectedUsernameBuffer) &&
      timingSafeEqual(passwordBuffer, expectedPasswordBuffer)
    );
  }

  async login(input: {
    hospitalId?: string;
    username?: string;
    password?: string;
    remember?: boolean;
  }): Promise<AuthSession> {
    const hospitalId = input.hospitalId?.trim();
    const username = input.username?.trim();

    if (!hospitalId || !username || !input.password) {
      throw new BadRequestException('Hospital, username, and password are required');
    }

    const client = new MedplumClient({
      baseUrl: process.env.MEDPLUM_BASE_URL,
      clientId: process.env.MEDPLUM_CLIENT_ID,
    });

    try {
      let profile;
      if (this.matchesDevelopmentAdmin(username, input.password)) {
        const clientId = process.env.MEDPLUM_CLIENT_ID;
        const clientSecret = process.env.MEDPLUM_CLIENT_SECRET;
        if (!clientId || !clientSecret) {
          throw new UnauthorizedException('Development admin is not configured');
        }
        await client.startClientLogin(clientId, clientSecret);
        profile = {
          resourceType: 'Practitioner' as const,
          id: 'development-admin',
          name: [{ text: 'System Administrator' }],
        };
      } else {
        const response = await client.startLogin({
          email: username.includes('@') ? username : `${username}@unitech.local`,
          password: input.password,
          scope: input.remember ? 'openid profile offline_access' : 'openid profile',
        });

        if (response.mfaRequired || response.mfaEnrollRequired) {
          throw new UnauthorizedException({
            code: response.mfaEnrollRequired ? 'MFA_ENROLL_REQUIRED' : 'MFA_REQUIRED',
            message: 'Multi-factor authentication is required for this account',
          });
        }

        if (!response.code) {
          throw new UnauthorizedException('Unable to complete sign in');
        }

        profile = await client.processCode(response.code);
      }

      // This read is intentionally performed with the user's token. It prevents a
      // user from creating a session for a hospital they cannot access in Medplum.
      const hospital = await client.readResource('Organization', hospitalId);
      const hospitalCode = hospital.identifier?.find(
        (identifier) => identifier.system === 'https://hospital-ehr.local/organization-code',
      )?.value;
      const activeHospitalCode = process.env.ACTIVE_HOSPITAL_CODE ?? 'HOSP-A';
      if (hospitalCode?.toUpperCase() !== activeHospitalCode.toUpperCase()) {
        throw new UnauthorizedException(`Only ${activeHospitalCode} is enabled in this rollout phase`);
      }

      const practitionerRoles = profile.resourceType === 'Practitioner' && profile.id !== 'development-admin'
        ? await client.searchResources('PractitionerRole', { practitioner: `Practitioner/${profile.id}`, organization: `Organization/${hospitalId}`, active: 'true', _count: '100' }).catch(() => [])
        : [];
      const roles = profile.id === 'development-admin' ? ['system-administrator'] : [...new Set(practitionerRoles.flatMap((item) => item.code?.flatMap((code) => code.coding?.map((coding) => coding.code).filter((value): value is string => Boolean(value)) ?? []) ?? []))];
      const directPermissions = practitionerRoles.flatMap((role) => {
        const raw = role.extension?.find((extension) => extension.url === PERMISSIONS_EXTENSION)?.valueString;
        if (!raw) return [];
        try { return JSON.parse(raw) as string[]; } catch { return []; }
      });
      const permissions = profile.id === 'development-admin'
        ? ['*']
        : [...new Set([...permissionsForRoles(roles), ...directPermissions])];
      const sessionData: Omit<AuthSession, 'id'> = {
        hospitalId,
        expiresAt: Date.now() + (input.remember ? REMEMBERED_SESSION_TTL_MS : SESSION_TTL_MS),
        profile,
        roles,
        permissions,
        medplum: client,
      };
      const session: AuthSession = {
        ...sessionData,
        id: this.createSessionToken(sessionData),
      };

      this.sessions.set(session.id, session);
      return session;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Invalid username or password, or hospital access is not permitted');
    }
  }

  getSession(id: string | undefined): AuthSession | undefined {
    if (!id) return undefined;
    if (this.revokedSessions.has(id)) return undefined;
    const session = this.sessions.get(id) ?? this.restoreSession(id);
    if (!session) return undefined;
    if (session.expiresAt <= Date.now()) {
      this.sessions.delete(id);
      return undefined;
    }
    this.sessions.set(id, session);
    return session;
  }

  async logout(id: string | undefined): Promise<void> {
    const session = this.getSession(id);
    if (!session) return;
    this.sessions.delete(session.id);
    this.revokedSessions.add(session.id);
    await session.medplum.signOut().catch(() => undefined);
  }

  toResponse(session: AuthSession) {
    return {
      authenticated: true,
      hospitalId: session.hospitalId,
      expiresAt: new Date(session.expiresAt).toISOString(),
      user: {
        id: session.profile.id,
        resourceType: session.profile.resourceType,
        display: getDisplayString(session.profile),
        roles: session.roles,
        permissions: session.permissions,
      },
    };
  }
}
