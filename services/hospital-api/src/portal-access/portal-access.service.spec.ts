import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PortalAccessService } from './portal-access.service';

describe('PortalAccessService', () => {
  const patient = {
    resourceType: 'Patient',
    id: 'p1',
    managingOrganization: { reference: 'Organization/h1' },
    name: [{ given: ['Ahmad'], family: 'Saleh', text: 'Ahmad Saleh' }],
  };
  const membership = (id: string, active?: boolean) => ({
    resourceType: 'ProjectMembership',
    id,
    project: { reference: 'Project/project-1' },
    profile: { reference: 'Patient/p1' },
    user: { reference: `User/u-${id}` },
    ...(active === undefined ? {} : { active }),
  });
  const service = {
    readResource: jest.fn(),
    getProject: jest.fn(),
  };
  const provisioning = {
    searchResources: jest.fn(),
    readResource: jest.fn(),
    updateResource: jest.fn(),
    invite: jest.fn(),
  };
  const auth = { revokeProfileSessions: jest.fn() };
  let portal: PortalAccessService;
  beforeEach(() => {
    jest.resetAllMocks();
    service.readResource.mockResolvedValue(patient);
    service.getProject.mockReturnValue({ id: 'project-1' });
    provisioning.searchResources.mockResolvedValue([]);
    provisioning.readResource.mockImplementation(async (_type, id: string) => ({
      resourceType: 'User',
      id,
      email: `${id}@unitech.local`,
    }));
    provisioning.updateResource.mockImplementation(async (r) => r);
    provisioning.invite.mockImplementation(async () => membership('m-new'));
    portal = new PortalAccessService(
      {
        getClient: () => service,
        getProvisioningClient: async () => provisioning,
      } as never,
      auth as never,
    );
  });

  it('reports no login for a patient without one', async () => {
    await expect(portal.status('p1', 'h1')).resolves.toEqual({
      patientId: 'p1',
      hospitalId: 'h1',
      status: 'none',
      logins: [],
    });
  });

  it('lists only memberships of this project and patient', async () => {
    provisioning.searchResources.mockResolvedValue([
      membership('m1'),
      { ...membership('m2'), project: { reference: 'Project/other' } },
      membership('m3', false),
    ]);
    const result = await portal.status('p1', 'h1');
    expect(result.status).toBe('active');
    expect(result.logins).toEqual([
      expect.objectContaining({ id: 'm1', username: 'u-m1', active: true }),
      expect.objectContaining({ id: 'm3', active: false }),
    ]);
  });

  it("refuses another hospital's patient as not found", async () => {
    service.readResource.mockResolvedValue({
      ...patient,
      managingOrganization: { reference: 'Organization/h2' },
    });
    await expect(portal.status('p1', 'h1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      portal.create('p1', 'h1', { username: 'ahmad' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(portal.disable('p1', 'h1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(provisioning.invite).not.toHaveBeenCalled();
    expect(provisioning.updateResource).not.toHaveBeenCalled();
  });

  it('creates a login linked to the patient with a one-time password', async () => {
    const result = await portal.create('p1', 'h1', { username: 'Ahmad.S' });
    expect(provisioning.invite).toHaveBeenCalledWith('project-1', {
      resourceType: 'Patient',
      firstName: 'Ahmad',
      lastName: 'Saleh',
      email: 'ahmad.s@unitech.local',
      password: result.temporaryPassword,
      sendEmail: false,
      membership: { profile: { reference: 'Patient/p1' } },
    });
    expect(result).toMatchObject({ status: 'active', username: 'ahmad.s' });
    expect(result.temporaryPassword).toMatch(/[A-Z]/);
    expect(result.temporaryPassword).toMatch(/[a-z]/);
    expect(result.temporaryPassword).toMatch(/[0-9]/);
    expect(result.temporaryPassword?.length).toBeGreaterThanOrEqual(12);
  });

  it('uses a supplied password and does not echo it', async () => {
    const result = await portal.create('p1', 'h1', {
      username: 'ahmad@example.com',
      password: 'Portal-Pass1',
    });
    expect(provisioning.invite).toHaveBeenCalledWith(
      'project-1',
      expect.objectContaining({
        email: 'ahmad@example.com',
        password: 'Portal-Pass1',
      }),
    );
    expect(result).not.toHaveProperty('temporaryPassword');
    expect(JSON.stringify(result)).not.toContain('Portal-Pass1');
  });

  it('rejects a weak password or an invalid username', async () => {
    await expect(
      portal.create('p1', 'h1', { username: 'ahmad', password: 'weak' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      portal.create('p1', 'h1', { username: 'a b' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(provisioning.invite).not.toHaveBeenCalled();
  });

  it('refuses a second active login', async () => {
    provisioning.searchResources.mockResolvedValue([membership('m1')]);
    await expect(
      portal.create('p1', 'h1', { username: 'ahmad' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(provisioning.invite).not.toHaveBeenCalled();
  });

  it('refuses a username that already belongs to an account', async () => {
    provisioning.searchResources.mockImplementation(async (type: string) =>
      type === 'User' ? [{ resourceType: 'User', id: 'staff-1' }] : [],
    );
    await expect(
      portal.create('p1', 'h1', { username: 'dr.khalid' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(provisioning.invite).not.toHaveBeenCalled();
  });

  it('disables every active login of the patient', async () => {
    provisioning.searchResources.mockResolvedValue([
      membership('m1'),
      membership('m2', false),
    ]);
    const result = await portal.disable('p1', 'h1');
    expect(provisioning.updateResource).toHaveBeenCalledTimes(1);
    expect(provisioning.updateResource).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'm1', active: false }),
    );
    expect(result).toMatchObject({ status: 'disabled', disabled: 1 });
    expect(auth.revokeProfileSessions).toHaveBeenCalledWith('Patient/p1');
  });

  it('reports when there is nothing to disable', async () => {
    await expect(portal.disable('p1', 'h1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(auth.revokeProfileSessions).not.toHaveBeenCalled();
  });
});
