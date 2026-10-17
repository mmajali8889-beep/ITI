import { BadRequestException } from '@nestjs/common';
import { ConditionsService } from './conditions.service';

describe('ConditionsService diagnosis classifications', () => {
  const medplum = {
    readResource: jest.fn(),
    searchResources: jest.fn(),
    createResource: jest.fn(),
    updateResource: jest.fn(),
  };
  let service: ConditionsService;
  const base = {
    patientId: 'patient-1',
    hospitalId: 'hospital-a',
    category: 'problem-list-item' as const,
    description: 'Test diagnosis',
  };

  beforeEach(() => {
    jest.resetAllMocks();
    medplum.readResource.mockResolvedValue({
      resourceType: 'Patient',
      id: 'patient-1',
      managingOrganization: { reference: 'Organization/hospital-a' },
    });
    medplum.searchResources.mockResolvedValue([]);
    medplum.createResource.mockImplementation(async (resource) => ({
      ...resource,
      id: 'condition-1',
    }));
    service = new ConditionsService({ getClient: () => medplum } as never);
  });

  it('stores ICD-10 using the FHIR ICD-10 system URI', async () => {
    const result = await service.create({
      ...base,
      codeSystem: 'ICD-10',
      diagnosisCode: 'E11.9',
    });
    expect(result).toMatchObject({
      codeSystem: 'ICD-10',
      diagnosisCode: 'E11.9',
      icd10Code: 'E11.9',
    });
    expect(medplum.createResource).toHaveBeenCalledWith(
      expect.objectContaining({
        code: expect.objectContaining({
          coding: [
            expect.objectContaining({
              system: 'http://hl7.org/fhir/sid/icd-10',
              code: 'E11.9',
            }),
          ],
        }),
      }),
    );
  });

  it('stores ICD-11 MMS using the WHO system URI', async () => {
    const result = await service.create({
      ...base,
      codeSystem: 'ICD-11',
      diagnosisCode: 'BA00',
    });
    expect(result).toMatchObject({
      codeSystem: 'ICD-11',
      diagnosisCode: 'BA00',
      icd10Code: undefined,
    });
    expect(medplum.createResource).toHaveBeenCalledWith(
      expect.objectContaining({
        code: expect.objectContaining({
          coding: [
            expect.objectContaining({
              system: 'http://id.who.int/icd/release/11/mms',
              code: 'BA00',
            }),
          ],
        }),
      }),
    );
  });

  it('keeps legacy ICD-10 clients compatible', async () => {
    await expect(
      service.create({ ...base, icd10Code: 'I10' }),
    ).resolves.toMatchObject({ codeSystem: 'ICD-10', diagnosisCode: 'I10' });
  });

  it('rejects a code that does not match the selected classification', async () => {
    await expect(
      service.create({
        ...base,
        codeSystem: 'ICD-10',
        diagnosisCode: 'NOT A CODE',
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
