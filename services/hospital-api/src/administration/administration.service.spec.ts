import { BadRequestException, ConflictException } from '@nestjs/common';
import { AdministrationService } from './administration.service';

describe('AdministrationService', () => {
  const medplum = {
    searchResources: jest.fn(),
    createResource: jest.fn(),
    readResource: jest.fn(),
    updateResource: jest.fn(),
    invite: jest.fn(),
    getProject: jest.fn(),
  };
  let service: AdministrationService;
  beforeEach(() => {
    jest.resetAllMocks();
    medplum.searchResources.mockResolvedValue([]);
    medplum.createResource.mockImplementation(async (resource) => ({
      ...resource,
      id: 'made-1',
    }));
    medplum.updateResource.mockImplementation(async (resource) => resource);
    medplum.getProject.mockReturnValue({
      resourceType: 'Project',
      id: 'project-1',
    });
    service = new AdministrationService({
      getClient: () => medplum,
      getProvisioningClient: async () => medplum,
    } as never);
  });
  it('creates an available FHIR bed scoped to the hospital', async () => {
    const result = await service.createCatalog({
      hospitalId: 'h1',
      kind: 'bed-configuration',
      code: 'B-101',
      name: 'Bed 101',
    });
    expect(result).toMatchObject({ resourceType: 'Location', code: 'B-101' });
    expect(medplum.createResource).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: 'Location',
        organization: { reference: 'Organization/h1' },
        extension: expect.arrayContaining([
          expect.objectContaining({ valueString: 'available' }),
        ]),
      }),
    );
  });
  it('creates a governed custom RBAC role', async () => {
    const role = await service.createRole({
      hospitalId: 'h1',
      code: 'quality-officer',
      name: 'Quality Officer',
      permissions: ['audit.read'],
    });
    expect(role).toMatchObject({
      code: 'quality-officer',
      permissions: ['audit.read'],
    });
    expect(medplum.createResource).toHaveBeenCalledWith(
      expect.objectContaining({ resourceType: 'Group', type: 'person' }),
    );
  });
  it('prevents duplicate practitioner role assignment', async () => {
    medplum.readResource.mockResolvedValue({
      resourceType: 'Practitioner',
      id: 'p1',
      name: [{ text: 'Dr A' }],
      extension: [
        {
          url: 'https://hospital-ehr.local/fhir/StructureDefinition/admin-hospital',
          valueReference: { reference: 'Organization/h1' },
        },
        {
          url: 'https://hospital-ehr.local/fhir/StructureDefinition/admin-kind',
          valueCode: 'practitioners',
        },
      ],
    });
    medplum.searchResources.mockResolvedValue([
      {
        resourceType: 'PractitionerRole',
        active: true,
        code: [{ coding: [{ code: 'doctor' }] }],
      },
    ]);
    await expect(
      service.assignRole({
        hospitalId: 'h1',
        practitionerId: 'p1',
        roleCode: 'doctor',
        roleName: 'Doctor',
      }),
    ).rejects.toThrow(ConflictException);
  });
  it('provisions login and enforces canonical job permissions without persisting the password', async () => {
    medplum.invite.mockResolvedValue({
      resourceType: 'ProjectMembership',
      profile: { reference: 'Practitioner/p1' },
    });
    medplum.readResource.mockResolvedValue({
      resourceType: 'Practitioner',
      id: 'p1',
      identifier: [],
      telecom: [],
      extension: [],
    });
    const result = await service.createUser({
      hospitalId: 'h1',
      name: 'Noura Ali',
      identifier: 'EMP-10',
      username: 'noura',
      password: 'Strong123',
      roles: ['nurse'],
      permissions: ['administration'],
    });
    expect(medplum.invite).toHaveBeenCalledWith(
      'project-1',
      expect.objectContaining({
        email: 'noura@unitech.local',
        password: 'Strong123',
        sendEmail: false,
      }),
    );
    expect(medplum.createResource).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: 'PractitionerRole',
        extension: expect.arrayContaining([
          expect.objectContaining({
            valueString:
              '["dashboard","patients","clinical","emergency","inpatient","nursing","icu","discharge"]',
          }),
        ]),
      }),
    );
    expect(JSON.stringify(medplum.updateResource.mock.calls)).not.toContain(
      'Strong123',
    );
    expect(result).toMatchObject({
      username: 'noura',
      identityStatus: 'active',
      permissions: [
        'dashboard',
        'patients',
        'clinical',
        'emergency',
        'inpatient',
        'nursing',
        'icu',
        'discharge',
      ],
    });
    expect(result.permissions).not.toContain('administration');
  });
  it('rejects user creation without a governed job role', async () => {
    await expect(
      service.createUser({
        hospitalId: 'h1',
        name: 'No Role',
        identifier: 'EMP-11',
        username: 'norole',
        password: 'Strong123',
        roles: [],
        permissions: ['administration'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(medplum.invite).not.toHaveBeenCalled();
  });
});
