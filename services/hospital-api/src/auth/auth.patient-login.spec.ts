import { UnauthorizedException } from '@nestjs/common';

// The signed-in patient's own Medplum client. Like Medplum's default patient
// access policy, it can read the patient's own record but not Organizations.
const userRead = jest.fn();
jest.mock('@medplum/core', () => {
  const actual = jest.requireActual('@medplum/core');
  return {
    ...actual,
    MedplumClient: jest.fn().mockImplementation(() => ({
      startLogin: jest.fn().mockResolvedValue({ code: 'code' }),
      processCode: jest.fn().mockResolvedValue({
        resourceType: 'Patient',
        id: 'patient-1',
        name: [{ text: 'Portal Patient' }],
      }),
      readResource: userRead,
      searchResources: jest.fn().mockResolvedValue([]),
    })),
  };
});

import { AuthService } from './auth.service';
import { InMemoryLockoutStore } from './sign-in-lockout.store';
import type { MedplumService } from '../medplum/medplum.service';

const HOSPITAL_A = {
  resourceType: 'Organization',
  id: 'hospital-a',
  identifier: [
    { system: 'https://hospital-ehr.local/organization-code', value: 'HOSP-A' },
  ],
};

describe('AuthService patient (portal) sign-in (27.2)', () => {
  const serviceRead = jest.fn();
  let service: AuthService;

  beforeEach(() => {
    process.env.ENABLED_HOSPITAL_CODES = 'HOSP-A';
    userRead.mockReset().mockImplementation((type: string) =>
      type === 'Patient'
        ? Promise.resolve({
            resourceType: 'Patient',
            id: 'patient-1',
            managingOrganization: { reference: 'Organization/hospital-a' },
          })
        : Promise.reject(new Error('Forbidden')),
    );
    serviceRead.mockReset().mockResolvedValue(HOSPITAL_A);
    service = new AuthService({
      getClient: () => ({ readResource: serviceRead }),
    } as unknown as MedplumService);
    (
      service as unknown as { lockoutStore: InMemoryLockoutStore }
    ).lockoutStore = new InMemoryLockoutStore();
  });

  const signIn = (hospitalId = 'hospital-a') =>
    service.login({ hospitalId, username: 'patient@x', password: 'pw' });

  it('signs a patient in although their access policy hides Organizations', async () => {
    const session = await signIn();
    expect(session.profile).toMatchObject({
      resourceType: 'Patient',
      id: 'patient-1',
    });
    expect(session.permissions).toEqual([]);
    expect(serviceRead).toHaveBeenCalledWith('Organization', 'hospital-a');
  });

  it('refuses a hospital that does not manage the patient, like a wrong password', async () => {
    await expect(signIn('hospital-b')).rejects.toThrow(
      new UnauthorizedException(
        'Invalid username or password, or hospital access is not permitted',
      ),
    );
    expect(serviceRead).not.toHaveBeenCalled();
  });

  it('still refuses hospitals that are not enabled', async () => {
    serviceRead.mockResolvedValue({
      ...HOSPITAL_A,
      identifier: [
        {
          system: 'https://hospital-ehr.local/organization-code',
          value: 'HOSP-B',
        },
      ],
    });
    await expect(signIn()).rejects.toMatchObject({
      response: { code: 'HOSPITAL_NOT_ENABLED' },
    });
  });
});
