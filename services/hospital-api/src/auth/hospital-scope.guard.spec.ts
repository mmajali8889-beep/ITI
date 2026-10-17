import { NotFoundException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { HospitalScopeGuard } from './hospital-scope.guard';

const H1 = 'hospital-1';
const resources: Record<string, unknown> = {
  'Patient/p1': {
    resourceType: 'Patient',
    id: 'p1',
    managingOrganization: { reference: `Organization/${H1}` },
  },
  'Patient/p2': {
    resourceType: 'Patient',
    id: 'p2',
    managingOrganization: { reference: 'Organization/hospital-2' },
  },
  'Encounter/e1': {
    resourceType: 'Encounter',
    id: 'e1',
    subject: { reference: 'Patient/p1' },
    serviceProvider: { reference: `Organization/${H1}` },
  },
  'Encounter/e2': {
    resourceType: 'Encounter',
    id: 'e2',
    subject: { reference: 'Patient/p2' },
    serviceProvider: { reference: 'Organization/hospital-2' },
  },
};
const medplumService = {
  getClient: () => ({
    readResource: async (type: string, id: string) => {
      const found = resources[`${type}/${id}`];
      if (!found) throw new Error('not found');
      return found;
    },
  }),
};
const guard = new HospitalScopeGuard(medplumService as never);
const context = (request: object) =>
  ({ switchToHttp: () => ({ getRequest: () => request }) }) as ExecutionContext;
const authed = (params: object = {}, query: object = {}) =>
  context({ auth: { hospitalId: H1 }, params, query });

describe('HospitalScopeGuard', () => {
  it('allows requests without a patient or encounter', async () => {
    await expect(guard.canActivate(authed())).resolves.toBe(true);
  });

  it('allows public requests (no session)', async () => {
    await expect(
      guard.canActivate(context({ params: { patientId: 'p2' }, query: {} })),
    ).resolves.toBe(true);
  });

  it('allows a patient and encounter of the session hospital', async () => {
    await expect(
      guard.canActivate(authed({ patientId: 'p1' }, { encounterId: 'e1' })),
    ).resolves.toBe(true);
  });

  it('hides a patient of another hospital (route param)', async () => {
    await expect(
      guard.canActivate(authed({ patientId: 'p2' })),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('hides a patient of another hospital (query param)', async () => {
    await expect(
      guard.canActivate(authed({}, { patientId: 'p2' })),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('hides an encounter of another hospital', async () => {
    await expect(
      guard.canActivate(authed({ encounterId: 'e2' })),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects an encounter that belongs to a different patient', async () => {
    resources['Encounter/e3'] = {
      ...(resources['Encounter/e1'] as object),
      id: 'e3',
      subject: { reference: 'Patient/other' },
    };
    await expect(
      guard.canActivate(authed({ patientId: 'p1', encounterId: 'e3' })),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('treats unknown ids as not found', async () => {
    await expect(
      guard.canActivate(authed({ patientId: 'missing' })),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
