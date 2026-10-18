import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { MedplumService } from '../medplum/medplum.service';
import { PatientsService } from './patients.service';
import type { CreatePatientDto } from './dto/create-patient.dto';

describe('PatientsService registration workflow', () => {
  let service: PatientsService;
  const medplum = {
    searchResources: jest.fn(),
    readResource: jest.fn(),
    createResource: jest.fn(),
    createResourceIfNoneExist: jest.fn(),
    updateResource: jest.fn(),
  };
  const validRegistration = (): CreatePatientDto => ({
    hospitalId: 'hospital-a-id',
    hospitalCode: 'HOSP-A',
    hospitalMrn: 'HA-000001',
    nationalId: '1234567890',
    firstNameAr: 'أحمد',
    familyNameAr: 'الخطيب',
    firstNameEn: 'Ahmad',
    familyNameEn: 'Alkhatib',
    gender: 'male',
    birthDate: '1990-04-12',
    phone: '+962790000000',
    nationality: 'Jordanian',
    preferredLanguage: 'ar',
    maritalStatus: 'single',
    registrationConfirmed: true,
  });

  beforeEach(async () => {
    jest.resetAllMocks();
    medplum.searchResources.mockResolvedValue([]);
    medplum.readResource.mockResolvedValue({
      resourceType: 'Organization',
      id: 'hospital-a-id',
      active: true,
      identifier: [
        {
          system: 'https://hospital-ehr.local/organization-code',
          value: 'HOSP-A',
        },
      ],
    });
    medplum.createResource.mockImplementation(async (resource) => ({
      ...resource,
      id: 'patient-1',
    }));
    medplum.createResourceIfNoneExist.mockImplementation(async (resource) => ({
      ...resource,
      id: 'mrn-counter-1',
      meta: { versionId: '1' },
    }));
    medplum.updateResource.mockImplementation(async (resource) => ({
      ...resource,
      meta: { versionId: '2' },
    }));
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PatientsService,
        {
          provide: MedplumService,
          useValue: {
            getClient: () => medplum,
            updateIfUnchanged: (r: unknown) => medplum.updateResource(r),
          },
        },
      ],
    }).compile();
    service = module.get(PatientsService);
  });

  it('creates a hospital-scoped FHIR patient after validation', async () => {
    await expect(service.create(validRegistration())).resolves.toMatchObject({
      id: 'patient-1',
      hospitalId: 'hospital-a-id',
      hospitalMrn: 'HOSP-A-000001',
    });
    expect(medplum.createResource).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: 'Patient',
        active: true,
        managingOrganization: { reference: 'Organization/hospital-a-id' },
      }),
    );
  });

  it('generates an MRN and creates RelatedPerson, Coverage, allergy alerts, and photo when captured', async () => {
    const dto = validRegistration();
    delete dto.hospitalMrn;
    dto.nextOfKinName = 'محمد الخطيب';
    dto.nextOfKinRelationship = 'Father';
    dto.nextOfKinPhone = '+962790000001';
    dto.photoContentType = 'image/jpeg';
    dto.photoBase64 = Buffer.from('photo').toString('base64');
    dto.insurance = {
      payerId: 'payer-1',
      payerName: 'UAT Insurance',
      subscriberId: 'MEM-1',
      validFrom: '2026-01-01',
    };
    dto.knownAllergies = [
      { substance: 'Penicillin', criticality: 'high', reaction: 'Rash' },
    ];
    const result = await service.create(dto);
    expect(result.hospitalMrn).toBe('HOSP-A-000001');
    for (const type of [
      'Patient',
      'RelatedPerson',
      'Coverage',
      'AllergyIntolerance',
    ])
      expect(medplum.createResource).toHaveBeenCalledWith(
        expect.objectContaining({ resourceType: type }),
      );
    expect(medplum.createResource).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: 'Patient',
        photo: [expect.objectContaining({ contentType: 'image/jpeg' })],
      }),
    );
  });

  it('allocates the next immutable hospital sequence and ignores a submitted MRN', async () => {
    let counter = {
      resourceType: 'Basic',
      id: 'mrn-counter-1',
      meta: { versionId: '1' },
      extension: [
        {
          url: 'https://hospital-ehr.local/fhir/StructureDefinition/mrn-sequence-value',
          valueInteger: 41,
        },
      ],
    };
    medplum.createResourceIfNoneExist.mockImplementation(async () => counter);
    medplum.updateResource.mockImplementation(async (resource) => {
      counter = {
        ...resource,
        meta: { versionId: String(Number(counter.meta.versionId) + 1) },
      };
      return counter;
    });
    medplum.createResource.mockImplementation(async (resource) => ({
      ...resource,
      id: `patient-${counter.meta.versionId}`,
    }));

    const first = await service.create({
      ...validRegistration(),
      hospitalMrn: 'USER-999999',
      nationalId: '1234567890',
    });
    const second = await service.create({
      ...validRegistration(),
      hospitalMrn: 'USER-000001',
      nationalId: '1234567891',
    });

    expect(first.hospitalMrn).toBe('HOSP-A-000042');
    expect(second.hospitalMrn).toBe('HOSP-A-000043');
    expect(first.hospitalMrn).not.toBe(second.hospitalMrn);
  });

  it('searches directly by passport within the hospital boundary', async () => {
    medplum.searchResources.mockResolvedValueOnce([
      {
        resourceType: 'Patient',
        id: 'patient-1',
        managingOrganization: { reference: 'Organization/hospital-a-id' },
        identifier: [
          {
            system: 'https://hospital-ehr.local/identifier/passport',
            value: 'P12345',
          },
        ],
      },
    ]);
    await service.findAll({
      hospitalId: 'hospital-a-id',
      passportNumber: 'p12345',
    });
    expect(medplum.searchResources).toHaveBeenCalledWith('Patient', {
      identifier: 'https://hospital-ehr.local/identifier/passport|P12345',
      organization: 'Organization/hospital-a-id',
    });
  });

  it('lists and searches only the hospital patients, newest first', async () => {
    medplum.searchResources.mockResolvedValue([]);
    await service.findAll({ hospitalId: 'hospital-a-id' });
    expect(medplum.searchResources).toHaveBeenLastCalledWith('Patient', {
      organization: 'Organization/hospital-a-id',
      _sort: '-_lastUpdated',
      _count: '50',
    });
    await service.findAll({ hospitalId: 'hospital-a-id', search: 'Sameeh' });
    expect(medplum.searchResources).toHaveBeenLastCalledWith(
      'Patient',
      expect.objectContaining({
        organization: 'Organization/hospital-a-id',
        name: 'Sameeh',
      }),
    );
  });

  it('blocks an existing authoritative identifier', async () => {
    medplum.searchResources.mockResolvedValueOnce([
      {
        resourceType: 'Patient',
        id: 'existing-1',
        name: [{ text: 'Existing patient' }],
      },
    ]);
    await expect(service.create(validRegistration())).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(medplum.createResource).not.toHaveBeenCalled();
  });

  it('rejects a hospital code that does not belong to the organization', async () => {
    const dto = validRegistration();
    dto.hospitalCode = 'HOSP-B';
    await expect(service.create(dto)).rejects.toThrow(
      'Selected hospital identity is invalid',
    );
    expect(medplum.createResource).not.toHaveBeenCalled();
  });

  it('rejects an unconfirmed registration', async () => {
    const dto = validRegistration();
    dto.registrationConfirmed = false;
    await expect(service.create(dto)).rejects.toThrow(BadRequestException);
    expect(medplum.createResource).not.toHaveBeenCalled();
  });

  it('rejects future birth dates', async () => {
    const dto = validRegistration();
    dto.birthDate = '2999-01-01';
    await expect(service.create(dto)).rejects.toThrow(
      'A valid non-future birth date is required',
    );
  });

  it('requires a hospital boundary when searching patients', async () => {
    await expect(service.findAll({ hospitalId: '' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('hides a patient that belongs to another hospital', async () => {
    medplum.readResource.mockResolvedValueOnce({
      resourceType: 'Patient',
      id: 'patient-1',
      managingOrganization: { reference: 'Organization/hospital-b-id' },
    });

    await expect(
      service.findById('patient-1', 'hospital-a-id'),
    ).rejects.toThrow(NotFoundException);
  });
});
