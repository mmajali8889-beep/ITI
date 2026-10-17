import { ForbiddenException } from '@nestjs/common';
import { PatientPortalController } from './patient-portal.controller';
describe('PatientPortalController', () => {
  it('prevents a patient account from reading another patient portal', () => {
    const controller = new PatientPortalController({ get: jest.fn() } as never);
    expect(() =>
      controller.get('p2', 'h1', {
        auth: { profile: { resourceType: 'Patient', id: 'p1' } },
      } as never),
    ).toThrow(ForbiddenException);
  });
});
