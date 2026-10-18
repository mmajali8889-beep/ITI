import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { isMedplumRateLimitError } from '../medplum/medplum-rate-limit.filter';
import { MedplumService } from '../medplum/medplum.service';
import { MedplumClient, getDisplayString } from '@medplum/core';
import type { ProfileResource } from '@medplum/core';
import type { Basic, Organization, PractitionerRole } from '@medplum/fhirtypes';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { AuthSession } from './auth.types';
import { PERMISSIONS_EXTENSION, permissionsForRoles } from './permissions';
import { isHospitalEnabled } from '../hospitals/enabled-hospitals';
import {
  InMemoryLockoutStore,
  MedplumLockoutStore,
  type SignInLockoutStore,
} from './sign-in-lockout.store';

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const REMEMBERED_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const REVOCATION_CODE_SYSTEM = 'https://hospital-ehr.local/CodeSystem/auth';
const REVOCATION_HASH_SYSTEM =
  'https://hospital-ehr.local/revoked-session-sha256';
const REVOCATION_EXPIRES_URL =
  'https://hospital-ehr.local/fhir/StructureDefinition/revoked-session-expires';

/** Fails closed: a production process must never offer the development admin login. */
export function assertDevAdminConfiguration(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (env.NODE_ENV === 'production' && env.AUTH_DEV_ADMIN_ENABLED === 'true') {
    throw new Error(
      'AUTH_DEV_ADMIN_ENABLED must not be set when NODE_ENV=production',
    );
  }
}

@Injectable()
export class AuthService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuthService.name);
  private readonly sessions = new Map<string, AuthSession>();
  // SHA-256 of revoked session tokens. Persisted in Medplum (Basic resources)
  // so a logout survives restarts and reaches other API instances on refresh.
  private readonly revokedTokenHashes = new Set<string>();
  private revocationRefresh?: NodeJS.Timeout;
  private lockoutPurge?: NodeJS.Timeout;
  private readonly revocationRefreshMs =
    Number(process.env.AUTH_REVOCATION_REFRESH_SECONDS ?? 60) * 1000;

  constructor(@Optional() private readonly medplumService?: MedplumService) {
    assertDevAdminConfiguration();
    this.lockoutStore = medplumService
      ? new MedplumLockoutStore(medplumService)
      : new InMemoryLockoutStore();
    if (this.devAdminEnabled()) {
      this.logger.warn(
        'Development admin login is ENABLED (AUTH_DEV_ADMIN_ENABLED=true); never use this outside local development',
      );
    }
  }

  async onModuleInit(): Promise<void> {
    if (!this.medplumService) return;
    await this.loadRevocations();
    this.revocationRefresh = setInterval(() => {
      this.loadRevocations().catch((error: unknown) =>
        this.logger.warn(
          `Refreshing revoked sessions failed: ${String(error)}`,
        ),
      );
    }, this.revocationRefreshMs);
    this.revocationRefresh.unref?.();
    // Hourly: drop sign-in failure records whose window and lock have expired.
    this.lockoutPurge = setInterval(
      () => {
        this.lockoutStore
          .purgeStale?.(this.lockoutMs)
          .catch((error: unknown) =>
            this.logger.warn(
              `Purging sign-in failure records failed: ${String(error)}`,
            ),
          );
      },
      60 * 60 * 1000,
    );
    this.lockoutPurge.unref?.();
  }

  onModuleDestroy(): void {
    if (this.revocationRefresh) clearInterval(this.revocationRefresh);
    if (this.lockoutPurge) clearInterval(this.lockoutPurge);
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /** Loads still-valid revocations into memory and deletes expired ones. */
  async loadRevocations(): Promise<void> {
    const client = this.medplumService?.getClient();
    if (!client) return;
    const now = Date.now();
    const active = new Set<string>();
    for await (const page of client.searchResourcePages('Basic', {
      code: `${REVOCATION_CODE_SYSTEM}|revoked-session`,
      _count: '1000',
    })) {
      for (const item of page) {
        const hash = item.identifier?.find(
          (id) => id.system === REVOCATION_HASH_SYSTEM,
        )?.value;
        const expires = Date.parse(
          item.extension?.find((ext) => ext.url === REVOCATION_EXPIRES_URL)
            ?.valueDateTime ?? '',
        );
        if (!hash) continue;
        if (Number.isFinite(expires) && expires <= now) {
          await client.deleteResource('Basic', item.id).catch(() => undefined);
          continue;
        }
        active.add(hash);
      }
    }
    for (const hash of active) this.revokedTokenHashes.add(hash);
  }

  private async persistRevocation(
    hash: string,
    expiresAt: number,
  ): Promise<void> {
    const client = this.medplumService?.getClient();
    if (!client) return;
    const revocation: Basic = {
      resourceType: 'Basic',
      code: {
        coding: [
          {
            system: REVOCATION_CODE_SYSTEM,
            code: 'revoked-session',
            display: 'Revoked session',
          },
        ],
      },
      identifier: [{ system: REVOCATION_HASH_SYSTEM, value: hash }],
      // Basic.created is a FHIR `date`.
      created: new Date().toISOString().slice(0, 10),
      extension: [
        {
          url: REVOCATION_EXPIRES_URL,
          valueDateTime: new Date(expiresAt).toISOString(),
        },
      ],
    };
    await client.createResourceIfNoneExist<Basic>(
      revocation,
      `identifier=${encodeURIComponent(REVOCATION_HASH_SYSTEM)}|${hash}`,
    );
  }
  // Per-account brute-force protection, keyed by hospital and username. Medplum
  // only throttles per client address, which behind a hospital NAT blocks
  // everyone at once. The counters live in Medplum (24.4), so they are shared
  // by every API instance and survive restarts; memory is the fallback.
  private readonly lockoutStore: SignInLockoutStore;
  private readonly maxFailedLogins = Number(
    process.env.AUTH_MAX_FAILED_LOGINS ?? 5,
  );
  private readonly lockoutMs =
    Number(process.env.AUTH_LOCKOUT_MINUTES ?? 15) * 60 * 1000;

  private async assertNotLocked(key: string): Promise<void> {
    const entry = await this.lockoutStore.get(key).catch((error: unknown) => {
      // If the store is unreachable, Medplum sign-in fails anyway; don't add a second error.
      this.logger.warn(`Sign-in lockout check failed: ${String(error)}`);
      return undefined;
    });
    if (!entry?.lockedUntil) return;
    const remainingMs = entry.lockedUntil - Date.now();
    if (remainingMs <= 0) {
      await this.lockoutStore.clear(key).catch(() => undefined);
      return;
    }
    throw new HttpException(
      {
        message:
          'This account is temporarily locked after repeated failed sign-ins; try again later or ask an administrator',
        code: 'ACCOUNT_LOCKED',
        retryAfterSeconds: Math.ceil(remainingMs / 1000),
      },
      HttpStatus.LOCKED,
    );
  }

  private async recordFailedLogin(key: string): Promise<void> {
    const now = Date.now();
    await this.lockoutStore
      .update(key, (entry) => {
        // Start a new window once the previous one (or its lock) has expired.
        const current =
          entry &&
          now - entry.firstAt < this.lockoutMs &&
          !(entry.lockedUntil && entry.lockedUntil <= now)
            ? { ...entry }
            : { count: 0, firstAt: now };
        current.count += 1;
        if (current.count >= this.maxFailedLogins)
          current.lockedUntil = now + this.lockoutMs;
        return current;
      })
      .catch((error: unknown) =>
        this.logger.warn(`Could not record failed sign-in: ${String(error)}`),
      );
  }
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
      const claims = JSON.parse(
        Buffer.from(payload, 'base64url').toString(),
      ) as {
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

  /** Opt-in only, never in production, and only with credentials set explicitly. */
  private devAdminEnabled(): boolean {
    return (
      process.env.AUTH_DEV_ADMIN_ENABLED === 'true' &&
      process.env.NODE_ENV !== 'production'
    );
  }

  private matchesDevelopmentAdmin(username: string, password: string): boolean {
    if (!this.devAdminEnabled()) return false;

    // No built-in fallback: an unset username or password disables the login.
    const expectedUsername = process.env.DEV_ADMIN_USERNAME;
    const expectedPassword = process.env.DEV_ADMIN_PASSWORD;
    if (!expectedUsername || !expectedPassword) return false;
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
      throw new BadRequestException(
        'Hospital, username, and password are required',
      );
    }

    const lockKey = `${hospitalId}:${username.toLowerCase()}`;
    await this.assertNotLocked(lockKey);

    const client = new MedplumClient({
      baseUrl: process.env.MEDPLUM_BASE_URL,
      clientId: process.env.MEDPLUM_CLIENT_ID,
    });

    try {
      let profile: ProfileResource;
      if (this.matchesDevelopmentAdmin(username, input.password)) {
        const clientId = process.env.MEDPLUM_CLIENT_ID;
        const clientSecret = process.env.MEDPLUM_CLIENT_SECRET;
        if (!clientId || !clientSecret) {
          throw new UnauthorizedException(
            'Development admin is not configured',
          );
        }
        await client.startClientLogin(clientId, clientSecret);
        profile = {
          resourceType: 'Practitioner' as const,
          id: 'development-admin',
          name: [{ text: 'System Administrator' }],
        };
      } else {
        const response = await client.startLogin({
          email: username.includes('@')
            ? username
            : `${username}@unitech.local`,
          password: input.password,
          scope: input.remember
            ? 'openid profile offline_access'
            : 'openid profile',
        });

        if (response.mfaRequired || response.mfaEnrollRequired) {
          throw new UnauthorizedException({
            code: response.mfaEnrollRequired
              ? 'MFA_ENROLL_REQUIRED'
              : 'MFA_REQUIRED',
            message: 'Multi-factor authentication is required for this account',
          });
        }

        if (!response.code) {
          throw new UnauthorizedException('Unable to complete sign in');
        }

        profile = await client.processCode(response.code);
      }

      // For staff this read is intentionally performed with the user's token. It
      // prevents a user from creating a session for a hospital they cannot access
      // in Medplum. Patients' access policies (correctly) hide Organization
      // resources, so a patient is instead checked against their own record.
      const hospital =
        profile.resourceType === 'Patient'
          ? await this.patientHospital(client, profile.id, hospitalId)
          : await client.readResource('Organization', hospitalId);
      const hospitalCode = hospital.identifier?.find(
        (identifier) =>
          identifier.system === 'https://hospital-ehr.local/organization-code',
      )?.value;
      if (!isHospitalEnabled(hospitalCode)) {
        throw new UnauthorizedException({
          message: 'Sign-in is not enabled for this hospital yet',
          code: 'HOSPITAL_NOT_ENABLED',
        });
      }

      const practitionerRoles: PractitionerRole[] =
        profile.resourceType === 'Practitioner' &&
        profile.id !== 'development-admin'
          ? await client
              .searchResources('PractitionerRole', {
                practitioner: `Practitioner/${profile.id}`,
                organization: `Organization/${hospitalId}`,
                active: 'true',
                _count: '100',
              })
              .catch(() => [])
          : [];
      const roles =
        profile.id === 'development-admin'
          ? ['system-administrator']
          : [
              ...new Set(
                practitionerRoles.flatMap(
                  (item) =>
                    item.code?.flatMap(
                      (code) =>
                        code.coding
                          ?.map((coding) => coding.code)
                          .filter((value): value is string => Boolean(value)) ??
                        [],
                    ) ?? [],
                ),
              ),
            ];
      const directPermissions = practitionerRoles.flatMap((role) => {
        const raw = role.extension?.find(
          (extension) => extension.url === PERMISSIONS_EXTENSION,
        )?.valueString;
        if (!raw) return [];
        try {
          return JSON.parse(raw) as string[];
        } catch {
          return [];
        }
      });
      const permissions =
        profile.id === 'development-admin'
          ? ['*']
          : [...new Set([...permissionsForRoles(roles), ...directPermissions])];
      const sessionData: Omit<AuthSession, 'id'> = {
        hospitalId,
        expiresAt:
          Date.now() +
          (input.remember ? REMEMBERED_SESSION_TTL_MS : SESSION_TTL_MS),
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
      await this.lockoutStore.clear(lockKey).catch(() => undefined);
      return session;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      // Medplum throttles sign-in attempts per client address. Report that as
      // such, or staff are told their (correct) password is wrong.
      if (isMedplumRateLimitError(error)) {
        throw new HttpException(
          {
            message:
              'Too many sign-in attempts from this network; wait a few minutes and try again',
            code: 'SIGN_IN_THROTTLED',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      await this.recordFailedLogin(lockKey);
      throw new UnauthorizedException(
        'Invalid username or password, or hospital access is not permitted',
      );
    }
  }

  /**
   * Patient (portal) sign-in, 27.2: the patient's own record, read with their
   * token, must be managed by the chosen hospital. Only then is the hospital
   * read with the API's service client. A mismatch fails like a wrong password,
   * so the sign-in form does not reveal where someone is a patient.
   */
  private async patientHospital(
    userClient: MedplumClient,
    patientId: string | undefined,
    hospitalId: string,
  ): Promise<Organization> {
    const service = this.medplumService?.getClient();
    if (!service || !patientId)
      throw new Error('Patient sign-in is not available');
    const patient = await userClient.readResource('Patient', patientId);
    if (
      patient.managingOrganization?.reference !== `Organization/${hospitalId}`
    )
      throw new Error('Patient is not registered at this hospital');
    return service.readResource('Organization', hospitalId);
  }

  getSession(id: string | undefined): AuthSession | undefined {
    if (!id) return undefined;
    if (this.revokedTokenHashes.has(this.hashToken(id))) return undefined;
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
    const hash = this.hashToken(session.id);
    this.revokedTokenHashes.add(hash);
    try {
      await this.persistRevocation(hash, session.expiresAt);
    } catch (error) {
      // The token is already refused by this instance; persistence makes it
      // stick across restarts and instances, so report the failure loudly.
      this.logger.error(
        `Could not persist session revocation; it will not survive a restart: ${String(error)}`,
      );
    }
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
