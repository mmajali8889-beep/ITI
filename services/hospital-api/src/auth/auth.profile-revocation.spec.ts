import type { Basic } from '@medplum/fhirtypes';
import type { AuthSession } from './auth.types';
import { AuthService } from './auth.service';

/** Minimal in-memory Medplum: just what profile revocation persistence uses. */
function fakeMedplum() {
  const store = new Map<string, Basic>();
  let seq = 0;
  const client = {
    store,
    failUpsert: false,
    async upsertResource(resource: Basic, query: string) {
      if (client.failUpsert) throw new Error('Medplum unavailable');
      const value = decodeURIComponent(query.split('|').pop() ?? '');
      const existing = [...store.values()].find((item) =>
        item.identifier?.some((id) => id.value === value),
      );
      const saved = { ...resource, id: existing?.id ?? `basic-${++seq}` };
      store.set(saved.id, saved);
      return saved;
    },
    async createResourceIfNoneExist(resource: Basic) {
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

function issue(
  service: AuthService,
  profile: { resourceType: string; id: string },
  issuedAt: number | undefined = Date.now(),
): string {
  const session = {
    hospitalId: 'hospital-a',
    issuedAt,
    expiresAt: Date.now() + 60 * 60_000,
    profile: { ...profile, name: [{ text: 'UAT' }] },
    roles: [],
    permissions: [],
    medplum: { signOut: jest.fn().mockResolvedValue(undefined) },
  } as unknown as Omit<AuthSession, 'id'>;
  return (
    service as unknown as {
      createSessionToken(value: Omit<AuthSession, 'id'>): string;
    }
  ).createSessionToken(session);
}

const patient = { resourceType: 'Patient', id: 'p1' };

describe('AuthService per-profile session revocation (27.2)', () => {
  beforeEach(() => {
    process.env.AUTH_SESSION_SECRET =
      'test-session-secret-that-is-longer-than-32-characters';
    delete process.env.AUTH_DEV_ADMIN_ENABLED;
  });

  it("ends the profile's open sessions and leaves others alone", async () => {
    const medplum = fakeMedplum();
    const service = new AuthService(medplum.service);
    const own = issue(service, patient, Date.now() - 1000);
    const other = issue(service, { resourceType: 'Patient', id: 'p2' });
    const staff = issue(service, { resourceType: 'Practitioner', id: 'p1' });
    expect(service.getSession(own)).toBeDefined();

    await service.revokeProfileSessions('Patient/p1');

    expect(service.getSession(own)).toBeUndefined();
    expect(service.getSession(other)).toBeDefined();
    expect(service.getSession(staff)).toBeDefined();
  });

  it('still accepts a session issued after the revocation', async () => {
    const service = new AuthService(fakeMedplum().service);
    await service.revokeProfileSessions('Patient/p1');
    const later = issue(service, patient, Date.now() + 1000);
    expect(service.getSession(later)).toBeDefined();
  });

  it('refuses a token without issuedAt (issued before this change)', async () => {
    const service = new AuthService(fakeMedplum().service);
    const legacy = issue(service, patient, undefined);
    await service.revokeProfileSessions('Patient/p1');
    expect(service.getSession(legacy)).toBeUndefined();
  });

  it('keeps the revocation after a restart and on other instances', async () => {
    const medplum = fakeMedplum();
    const first = new AuthService(medplum.service);
    const token = issue(first, patient, Date.now() - 1000);
    await first.revokeProfileSessions('Patient/p1');
    await first.revokeProfileSessions('Patient/p1');
    expect(medplum.client.store.size).toBe(1); // one record per profile

    const other = new AuthService(medplum.service);
    expect(other.getSession(token)).toBeDefined(); // not loaded yet
    await other.loadRevocations();
    expect(other.getSession(token)).toBeUndefined();
  });

  it('deletes a revocation once no session it covers can still be alive', async () => {
    const medplum = fakeMedplum();
    const service = new AuthService(medplum.service);
    await service.revokeProfileSessions('Patient/p1');
    const [record] = medplum.client.store.values();
    record.extension = [
      {
        url: record.extension![0].url,
        valueDateTime: new Date(
          Date.now() - 31 * 24 * 60 * 60 * 1000,
        ).toISOString(),
      },
    ];
    await new AuthService(medplum.service).loadRevocations();
    expect(medplum.client.store.size).toBe(0);
  });

  it('still refuses on this instance when persistence fails', async () => {
    const medplum = fakeMedplum();
    medplum.client.failUpsert = true;
    const service = new AuthService(medplum.service);
    const token = issue(service, patient, Date.now() - 1000);
    await expect(
      service.revokeProfileSessions('Patient/p1'),
    ).resolves.toBeUndefined();
    expect(service.getSession(token)).toBeUndefined();
  });
});
