import { ConflictException, Injectable, OnModuleInit } from '@nestjs/common';
import { MedplumClient } from '@medplum/core';
import type { WithId } from '@medplum/core';
import type { Resource } from '@medplum/fhirtypes';

/** Another request changed the resource between our read and our write. */
export class ConcurrentUpdateError extends ConflictException {
  constructor(resourceType: string) {
    super({ message: `${resourceType} was changed by another request; reload and try again`, code: 'CONCURRENT_UPDATE' });
  }
}

/** Medplum reports a failed If-Match as 412 Precondition Failed (409 on some paths). */
export function isVersionConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  if (error instanceof ConcurrentUpdateError) return true;
  const candidate = error as { status?: number; response?: { status?: number }; message?: string; outcome?: { issue?: Array<{ details?: { text?: string } }> } };
  const status = candidate.status ?? candidate.response?.status;
  if (status === 409 || status === 412) return true;
  const text = `${candidate.message ?? ''} ${candidate.outcome?.issue?.map((issue) => issue.details?.text).join(' ') ?? ''}`;
  return /precondition failed|version conflict/i.test(text);
}

@Injectable()
export class MedplumService implements OnModuleInit {
  private readonly client: MedplumClient;
  private provisioningClient?: MedplumClient;

  constructor() {
    this.client = new MedplumClient({
      baseUrl: process.env.MEDPLUM_BASE_URL,
    });
  }

  async onModuleInit(): Promise<void> {
    const clientId = process.env.MEDPLUM_CLIENT_ID;
    const clientSecret = process.env.MEDPLUM_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error('Medplum credentials are missing');
    }

    await this.client.startClientLogin(
      clientId,
      clientSecret,
    );

    console.log('Medplum API authentication successful');
  }

  getClient(): MedplumClient {
    return this.client;
  }

  /**
   * Optimistic-locking update: succeeds only if the resource is still at the
   * version that was read. Without If-Match Medplum applies the last write, so
   * read-check-write sequences (counters, balances, bed occupancy) race.
   * Throws ConcurrentUpdateError when another request updated it first.
   */
  async updateIfUnchanged<T extends Resource>(resource: T): Promise<WithId<T>> {
    const versionId = resource.meta?.versionId;
    if (!resource.id || !versionId) throw new Error(`${resource.resourceType} must be read before a guarded update`);
    try {
      return await this.client.updateResource<T>(resource, { headers: { 'If-Match': `W/"${versionId}"` } });
    } catch (error) {
      if (isVersionConflict(error)) throw new ConcurrentUpdateError(resource.resourceType);
      throw error;
    }
  }

  async getProvisioningClient(): Promise<MedplumClient> {
    if (this.provisioningClient) return this.provisioningClient;

    const email = process.env.MEDPLUM_PROVISIONING_EMAIL;
    const password = process.env.MEDPLUM_PROVISIONING_PASSWORD;
    if (!email || !password) {
      throw new Error(
        'Medplum provisioning credentials are missing; configure MEDPLUM_PROVISIONING_EMAIL and MEDPLUM_PROVISIONING_PASSWORD',
      );
    }

    // Do not scope the provisioning login to the hospital ClientApplication.
    // The provisioning administrator belongs to Medplum's super-admin project
    // and must be able to invite into the target hospital project.
    const client = new MedplumClient({
      baseUrl: process.env.MEDPLUM_BASE_URL,
    });
    const response = await client.startLogin({
      email,
      password,
      scope: 'openid profile',
    });
    if (!response.code || response.mfaRequired || response.mfaEnrollRequired) {
      throw new Error('Medplum provisioning account requires interactive authentication');
    }
    await client.processCode(response.code);
    this.provisioningClient = client;
    return client;
  }
}
