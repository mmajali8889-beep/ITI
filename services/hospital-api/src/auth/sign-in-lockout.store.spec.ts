import type { Basic } from '@medplum/fhirtypes';
import { ConcurrentUpdateError } from '../medplum/medplum.service';
import { MedplumLockoutStore } from './sign-in-lockout.store';

/** In-memory Medplum with real version checks, shared like the real server. */
function fakeMedplum() {
  const store = new Map<string, Basic>();
  let seq = 0;
  const snapshot = (resource: Basic) =>
    JSON.parse(JSON.stringify(resource)) as Basic;
  const find = (value: string) =>
    [...store.values()].find((item) =>
      item.identifier?.some((id) => id.value === value),
    );
  const client = {
    searchResources: async (_type: string, query: { identifier: string }) => {
      const found = find(query.identifier.split('|').pop() ?? '');
      return found ? [snapshot(found)] : [];
    },
    createResourceIfNoneExist: async (resource: Basic, query: string) => {
      const existing = find(decodeURIComponent(query.split('|').pop() ?? ''));
      if (existing) return snapshot(existing);
      const created = {
        ...resource,
        id: `b-${++seq}`,
        meta: { versionId: '1' },
      };
      store.set(created.id, created);
      return snapshot(created);
    },
    deleteResource: async (_type: string, id: string) => {
      store.delete(id);
    },
  };
  const service = {
    getClient: () => client,
    updateIfUnchanged: async (resource: Basic) => {
      await Promise.resolve(); // let a parallel request interleave
      const current = store.get(resource.id!);
      if (!current || current.meta?.versionId !== resource.meta?.versionId)
        throw new ConcurrentUpdateError('Basic');
      const next = {
        ...resource,
        meta: { versionId: String(Number(current.meta?.versionId) + 1) },
      };
      store.set(resource.id!, next);
      return snapshot(next);
    },
  };
  return { store, service: service as never };
}

const increment = (current?: { count: number; firstAt: number }) => ({
  count: (current?.count ?? 0) + 1,
  firstAt: current?.firstAt ?? Date.now(),
});

describe('MedplumLockoutStore (24.4)', () => {
  it('keeps counts across store instances (restart, or another API instance)', async () => {
    const medplum = fakeMedplum();
    await new MedplumLockoutStore(medplum.service).update('h:nurse', increment);
    await new MedplumLockoutStore(medplum.service).update('h:nurse', increment);
    expect(
      await new MedplumLockoutStore(medplum.service).get('h:nurse'),
    ).toMatchObject({ count: 2 });
  });

  it('counts every failure when instances update at the same time', async () => {
    const medplum = fakeMedplum();
    const instances = [0, 1, 2, 3].map(
      () => new MedplumLockoutStore(medplum.service),
    );
    await Promise.all(
      instances.map((store) => store.update('h:nurse', increment)),
    );
    expect(await instances[0].get('h:nurse')).toMatchObject({ count: 4 });
    expect(medplum.store.size).toBe(1);
  });

  it('round-trips a lock and clears it', async () => {
    const medplum = fakeMedplum();
    const store = new MedplumLockoutStore(medplum.service);
    const lockedUntil = Date.now() + 60_000;
    await store.update('h:nurse', () => ({
      count: 5,
      firstAt: Date.now(),
      lockedUntil,
    }));
    expect((await store.get('h:nurse'))?.lockedUntil).toBe(lockedUntil);
    await store.clear('h:nurse');
    expect(await store.get('h:nurse')).toBeUndefined();
  });

  it('never stores the username itself', async () => {
    const medplum = fakeMedplum();
    await new MedplumLockoutStore(medplum.service).update(
      'hospital-a:nurse.jones',
      increment,
    );
    const stored = JSON.stringify([...medplum.store.values()]);
    expect(stored).not.toContain('nurse.jones');
    expect(stored).toMatch(/[0-9a-f]{64}/);
  });

  it('purges failure records not updated within the window', async () => {
    const searched: Array<Record<string, string>> = [];
    const deleted: string[] = [];
    const client = {
      searchResources: async (_type: string, query: Record<string, string>) => {
        searched.push(query);
        return [
          { resourceType: 'Basic', id: 'old-1' },
          { resourceType: 'Basic', id: 'old-2' },
        ];
      },
      deleteResource: async (_type: string, id: string) => {
        deleted.push(id);
      },
    };
    const store = new MedplumLockoutStore({ getClient: () => client } as never);
    await expect(store.purgeStale(15 * 60 * 1000)).resolves.toBe(2);
    expect(deleted).toEqual(['old-1', 'old-2']);
    expect(searched[0].code).toContain('signin-failures');
    expect(searched[0]._lastUpdated).toMatch(/^lt\d{4}-/);
  });
});
