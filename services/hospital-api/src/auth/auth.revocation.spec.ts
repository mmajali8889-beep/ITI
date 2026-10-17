import type { Basic } from '@medplum/fhirtypes';
import type { AuthSession } from './auth.types';
import { AuthService, assertDevAdminConfiguration } from './auth.service';

/** Minimal in-memory Medplum: just what revocation persistence uses. */
function fakeMedplum() {
  const store = new Map<string, Basic>();
  let seq = 0;
  const client = {
    store,
    failCreate: false,
    async createResourceIfNoneExist(resource: Basic, query: string) {
      if (client.failCreate) throw new Error('Medplum unavailable');
      const value = decodeURIComponent(query.split('|').pop() ?? '');
      const existing = [...store.values()].find((item) =>
        item.identifier?.some((id) => id.value === value),
      );
      if (existing) return existing;
      const created = { ...resource, id: `basic-${++seq}` };
      store.set(created.id, created);
      return created;
    },
    async *searchResourcePages() {
      yield [...store.values()];
    },
    async deleteResource(_type: string, id: string) {
      store.delete(id);
    },
  };
  return { client, service: { getClient: () => client } as never };
}

function issue(service: AuthService, expiresAt = Date.now() + 60_000): string {
  const session = {
    hospitalId: 'hospital-a',
    expiresAt,
    profile: {
      resourceType: 'Practitioner',
      id: 'practitioner-1',
      name: [{ text: 'UAT Nurse' }],
    },
    roles: ['nurse'],
    permissions: ['dashboard'],
    medplum: { signOut: jest.fn().mockResolvedValue(undefined) },
  } as unknown as Omit<AuthSession, 'id'>;
  return (
    service as unknown as {
      createSessionToken(value: Omit<AuthSession, 'id'>): string;
    }
  ).createSessionToken(session);
}

describe('AuthService persisted session revocation (24.3)', () => {
  beforeEach(() => {
    process.env.AUTH_SESSION_SECRET =
      'test-session-secret-that-is-longer-than-32-characters';
    delete process.env.AUTH_DEV_ADMIN_ENABLED;
  });

  it('keeps a logged-out token refused after a restart', async () => {
    const medplum = fakeMedplum();
    const before = new AuthService(medplum.service);
    const token = issue(before);
    await before.logout(token);
    expect(before.getSession(token)).toBeUndefined();

    const afterRestart = new AuthService(medplum.service);
    expect(afterRestart.getSession(token)).toBeDefined(); // not loaded yet
    await afterRestart.loadRevocations();
    expect(afterRestart.getSession(token)).toBeUndefined();
  });

  it('stores a hash of the token, never the token itself', async () => {
    const medplum = fakeMedplum();
    const service = new AuthService(medplum.service);
    const token = issue(service);
    await service.logout(token);
    const stored = JSON.stringify([...medplum.client.store.values()]);
    expect(stored).not.toContain(token);
    expect(stored).toMatch(/[0-9a-f]{64}/);
  });

  it('deletes revocations whose token has expired', async () => {
    const medplum = fakeMedplum();
    const service = new AuthService(medplum.service);
    await service.logout(issue(service, Date.now() + 60_000));
    const [entry] = medplum.client.store.values();
    entry.extension = [
      {
        url: entry.extension![0].url,
        valueDateTime: new Date(Date.now() - 1000).toISOString(),
      },
    ];
    await new AuthService(medplum.service).loadRevocations();
    expect(medplum.client.store.size).toBe(0);
  });

  it('still refuses the token on this instance when persistence fails', async () => {
    const medplum = fakeMedplum();
    medplum.client.failCreate = true;
    const service = new AuthService(medplum.service);
    const token = issue(service);
    await expect(service.logout(token)).resolves.toBeUndefined();
    expect(service.getSession(token)).toBeUndefined();
  });
});

describe('Development admin login (24.6)', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  const matches = (service: AuthService, u: string, p: string) =>
    (
      service as unknown as {
        matchesDevelopmentAdmin(u: string, p: string): boolean;
      }
    ).matchesDevelopmentAdmin(u, p);

  beforeEach(() => {
    process.env.AUTH_SESSION_SECRET =
      'test-session-secret-that-is-longer-than-32-characters';
    delete process.env.AUTH_DEV_ADMIN_ENABLED;
    delete process.env.DEV_ADMIN_USERNAME;
    delete process.env.DEV_ADMIN_PASSWORD;
    process.env.NODE_ENV = 'development';
  });

  it('is off unless explicitly enabled, even for admin/admin', () => {
    expect(matches(new AuthService(), 'admin', 'admin')).toBe(false);
  });

  it('has no built-in credentials when enabled without them', () => {
    process.env.AUTH_DEV_ADMIN_ENABLED = 'true';
    expect(matches(new AuthService(), 'admin', 'admin')).toBe(false);
  });

  it('accepts only the configured credentials when enabled', () => {
    Object.assign(process.env, {
      AUTH_DEV_ADMIN_ENABLED: 'true',
      DEV_ADMIN_USERNAME: 'local-admin',
      DEV_ADMIN_PASSWORD: 'Local-Only-Pass1',
    });
    const service = new AuthService();
    expect(matches(service, 'local-admin', 'Local-Only-Pass1')).toBe(true);
    expect(matches(service, 'local-admin', 'wrong')).toBe(false);
    expect(matches(service, 'admin', 'admin')).toBe(false);
  });

  it('refuses to start in production with the dev login enabled', () => {
    expect(() =>
      assertDevAdminConfiguration({
        NODE_ENV: 'production',
        AUTH_DEV_ADMIN_ENABLED: 'true',
      }),
    ).toThrow(/must not be set/);
    expect(() =>
      assertDevAdminConfiguration({ NODE_ENV: 'production' }),
    ).not.toThrow();
    expect(() =>
      assertDevAdminConfiguration({
        NODE_ENV: 'development',
        AUTH_DEV_ADMIN_ENABLED: 'true',
      }),
    ).not.toThrow();
  });
});
