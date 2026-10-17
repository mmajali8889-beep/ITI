import { createHash } from 'node:crypto';
import type { Basic } from '@medplum/fhirtypes';
import type { MedplumService } from '../medplum/medplum.service';
import { isVersionConflict } from '../medplum/medplum.service';

/** Failed sign-ins for one account: count within the window, and any lock. */
export interface FailureState {
  count: number;
  firstAt: number;
  lockedUntil?: number;
}

/**
 * Where per-account sign-in failures are kept. The Medplum-backed store is
 * shared by every API instance and survives restarts; the in-memory one is the
 * fallback (and is what unit tests use).
 */
export interface SignInLockoutStore {
  get(key: string): Promise<FailureState | undefined>;
  /** Applies `update` to the current state atomically and returns the result. */
  update(
    key: string,
    update: (current: FailureState | undefined) => FailureState,
  ): Promise<FailureState>;
  clear(key: string): Promise<void>;
  /** Removes records not updated for `olderThanMs` (expired windows and locks). */
  purgeStale?(olderThanMs: number): Promise<number>;
}

export class InMemoryLockoutStore implements SignInLockoutStore {
  private readonly entries = new Map<string, FailureState>();

  get(key: string): Promise<FailureState | undefined> {
    return Promise.resolve(this.entries.get(key));
  }

  update(
    key: string,
    update: (current: FailureState | undefined) => FailureState,
  ): Promise<FailureState> {
    const next = update(this.entries.get(key));
    this.entries.set(key, next);
    return Promise.resolve(next);
  }

  clear(key: string): Promise<void> {
    this.entries.delete(key);
    return Promise.resolve();
  }
}

const CODE_SYSTEM = 'https://hospital-ehr.local/CodeSystem/auth';
const KEY_SYSTEM = 'https://hospital-ehr.local/signin-failures-sha256';
const COUNT_URL =
  'https://hospital-ehr.local/fhir/StructureDefinition/signin-failure-count';
const FIRST_AT_URL =
  'https://hospital-ehr.local/fhir/StructureDefinition/signin-failure-first-at';
const LOCKED_UNTIL_URL =
  'https://hospital-ehr.local/fhir/StructureDefinition/signin-locked-until';
const ATTEMPTS = 5;

/**
 * Keeps failure counters in Medplum as one Basic resource per account, keyed by
 * a SHA-256 of "hospital:username" (the username itself is not stored).
 * Updates are guarded (If-Match) and retried, so parallel failed sign-ins on
 * different API instances are all counted.
 */
export class MedplumLockoutStore implements SignInLockoutStore {
  constructor(private readonly medplumService: MedplumService) {}

  async get(key: string): Promise<FailureState | undefined> {
    const resource = await this.find(key);
    return resource ? this.state(resource) : undefined;
  }

  async update(
    key: string,
    update: (current: FailureState | undefined) => FailureState,
  ): Promise<FailureState> {
    for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
      // Make sure the record exists (count 0), then always increment it with a
      // guarded update, so concurrent first failures cannot overwrite each other.
      const existing = (await this.find(key)) ?? (await this.createEmpty(key));
      const next = update(
        existing.extension?.length ? this.state(existing) : undefined,
      );
      try {
        await this.medplumService.updateIfUnchanged<Basic>({
          ...existing,
          extension: this.extensions(next),
        });
        return next;
      } catch (error) {
        if (!isVersionConflict(error) || attempt === ATTEMPTS - 1) throw error;
      }
    }
    throw new Error('Could not record the failed sign-in');
  }

  async clear(key: string): Promise<void> {
    const existing = await this.find(key);
    if (existing?.id)
      await this.medplumService
        .getClient()
        .deleteResource('Basic', existing.id)
        .catch(() => undefined);
  }

  /**
   * Without this, a failed sign-in for a username nobody retries would leave a
   * record behind for good, so spraying random usernames could grow storage
   * without bound.
   */
  async purgeStale(olderThanMs: number): Promise<number> {
    const client = this.medplumService.getClient();
    const cutoff = new Date(Date.now() - olderThanMs).toISOString();
    const stale = await client.searchResources('Basic', {
      code: `${CODE_SYSTEM}|signin-failures`,
      _lastUpdated: `lt${cutoff}`,
      _count: '500',
    });
    for (const record of stale) {
      await client.deleteResource('Basic', record.id).catch(() => undefined);
    }
    return stale.length;
  }

  private createEmpty(key: string): Promise<Basic> {
    const hash = this.hash(key);
    return this.medplumService.getClient().createResourceIfNoneExist<Basic>(
      {
        resourceType: 'Basic',
        code: { coding: [{ system: CODE_SYSTEM, code: 'signin-failures' }] },
        identifier: [{ system: KEY_SYSTEM, value: hash }],
      },
      `identifier=${encodeURIComponent(KEY_SYSTEM)}|${hash}`,
    );
  }

  private hash(key: string): string {
    return createHash('sha256').update(key).digest('hex');
  }

  private async find(key: string): Promise<Basic | undefined> {
    const [resource] = await this.medplumService
      .getClient()
      .searchResources('Basic', {
        identifier: `${KEY_SYSTEM}|${this.hash(key)}`,
        _count: '1',
      });
    return resource;
  }

  private state(resource: Basic): FailureState {
    const ext = (url: string) =>
      resource.extension?.find((item) => item.url === url);
    const lockedUntil = Date.parse(ext(LOCKED_UNTIL_URL)?.valueDateTime ?? '');
    return {
      count: ext(COUNT_URL)?.valueInteger ?? 0,
      firstAt: Date.parse(ext(FIRST_AT_URL)?.valueDateTime ?? '') || Date.now(),
      lockedUntil: Number.isFinite(lockedUntil) ? lockedUntil : undefined,
    };
  }

  private extensions(state: FailureState): Basic['extension'] {
    return [
      { url: COUNT_URL, valueInteger: state.count },
      {
        url: FIRST_AT_URL,
        valueDateTime: new Date(state.firstAt).toISOString(),
      },
      ...(state.lockedUntil
        ? [
            {
              url: LOCKED_UNTIL_URL,
              valueDateTime: new Date(state.lockedUntil).toISOString(),
            },
          ]
        : []),
    ];
  }
}
