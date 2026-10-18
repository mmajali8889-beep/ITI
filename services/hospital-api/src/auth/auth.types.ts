import type { MedplumClient, ProfileResource } from '@medplum/core';

export interface AuthSession {
  id: string;
  hospitalId: string;
  expiresAt: number;
  /** When the session was issued (ms); absent on tokens issued before 27.2. */
  issuedAt?: number;
  profile: ProfileResource;
  roles: string[];
  permissions: string[];
  medplum: MedplumClient;
}
