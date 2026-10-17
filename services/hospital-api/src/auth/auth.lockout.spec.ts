import { HttpStatus, UnauthorizedException } from '@nestjs/common';
import type { HttpException } from '@nestjs/common';

const startLogin = jest.fn();
jest.mock('@medplum/core', () => {
  const actual = jest.requireActual('@medplum/core');
  return {
    ...actual,
    MedplumClient: jest.fn().mockImplementation(() => ({
      startLogin,
      processCode: jest.fn().mockResolvedValue({
        resourceType: 'Practitioner',
        id: 'p1',
        name: [{ text: 'UAT Nurse' }],
      }),
      readResource: jest.fn().mockResolvedValue({
        resourceType: 'Organization',
        id: 'hospital-a',
        identifier: [
          {
            system: 'https://hospital-ehr.local/organization-code',
            value: 'HOSP-A',
          },
        ],
      }),
      searchResources: jest.fn().mockResolvedValue([]),
    })),
  };
});

import { AuthService } from './auth.service';

const GOOD = 'Correct-Password-1';
const attempt = (service: AuthService, password: string, username = 'nurse1') =>
  service.login({ hospitalId: 'hospital-a', username, password });

describe('AuthService per-account lockout', () => {
  beforeEach(() => {
    process.env.AUTH_SESSION_SECRET =
      'test-session-secret-that-is-longer-than-32-characters';
    process.env.AUTH_MAX_FAILED_LOGINS = '5';
    process.env.AUTH_LOCKOUT_MINUTES = '15';
    delete process.env.ENABLED_HOSPITAL_CODES;
    delete process.env.ACTIVE_HOSPITAL_CODE;
    startLogin.mockReset();
    startLogin.mockImplementation(
      async ({ password }: { password: string }) => {
        if (password !== GOOD) throw new Error('Email or password is invalid');
        return { code: 'auth-code' };
      },
    );
  });
  afterEach(() => jest.useRealTimers());

  it('locks the account on the 5th failure and refuses even the right password', async () => {
    const service = new AuthService();
    for (let i = 0; i < 5; i += 1)
      await expect(attempt(service, `wrong-${i}`)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    const locked = (await attempt(service, GOOD).catch(
      (error: unknown) => error,
    )) as HttpException;
    expect(locked.getStatus()).toBe(HttpStatus.LOCKED);
    expect(locked.getResponse()).toMatchObject({ code: 'ACCOUNT_LOCKED' });
    expect(startLogin).toHaveBeenCalledTimes(5); // the locked attempt never reaches Medplum
  });

  it('resets the counter after a successful sign-in', async () => {
    const service = new AuthService();
    for (let i = 0; i < 4; i += 1)
      await expect(attempt(service, `wrong-${i}`)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    await expect(attempt(service, GOOD)).resolves.toMatchObject({
      hospitalId: 'hospital-a',
    });
    for (let i = 0; i < 4; i += 1)
      await expect(attempt(service, `wrong-${i}`)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    await expect(attempt(service, GOOD)).resolves.toBeDefined();
  });

  it('locks only the targeted account', async () => {
    const service = new AuthService();
    for (let i = 0; i < 5; i += 1)
      await attempt(service, `wrong-${i}`).catch(() => undefined);
    await expect(attempt(service, GOOD, 'nurse2')).resolves.toBeDefined();
  });

  it('treats usernames case-insensitively so the lock cannot be sidestepped', async () => {
    const service = new AuthService();
    for (let i = 0; i < 5; i += 1)
      await attempt(service, `wrong-${i}`, i % 2 ? 'NURSE1' : 'nurse1').catch(
        () => undefined,
      );
    const locked = (await attempt(service, GOOD, 'Nurse1').catch(
      (error: unknown) => error,
    )) as HttpException;
    expect(locked.getStatus()).toBe(HttpStatus.LOCKED);
  });

  it('unlocks after the lockout period', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-17T08:00:00Z') });
    const service = new AuthService();
    for (let i = 0; i < 5; i += 1)
      await attempt(service, `wrong-${i}`).catch(() => undefined);
    jest.setSystemTime(new Date('2026-10-17T08:16:00Z'));
    await expect(attempt(service, GOOD)).resolves.toBeDefined();
  });

  it('refuses hospitals that are not enabled, without counting it as a failed password', async () => {
    process.env.ENABLED_HOSPITAL_CODES = 'HOSP-01'; // the mocked hospital is HOSP-A
    const service = new AuthService();
    for (let i = 0; i < 6; i += 1) {
      const error = (await attempt(service, GOOD).catch(
        (e: unknown) => e,
      )) as HttpException;
      expect(error).toBeInstanceOf(UnauthorizedException);
      expect(error.getResponse()).toMatchObject({
        code: 'HOSPITAL_NOT_ENABLED',
      });
    }
    process.env.ENABLED_HOSPITAL_CODES = 'HOSP-01,HOSP-A';
    await expect(attempt(service, GOOD)).resolves.toMatchObject({
      hospitalId: 'hospital-a',
    });
  });
});
