import { Injectable, OnModuleInit } from '@nestjs/common';
import { MedplumClient } from '@medplum/core';

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
