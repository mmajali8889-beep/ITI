import type { MedplumClient, ProfileResource } from '@medplum/core';

export interface AuthSession {
  id: string;
  hospitalId: string;
  expiresAt: number;
  profile: ProfileResource;
  roles: string[];
  permissions: string[];
  medplum: MedplumClient;
}
