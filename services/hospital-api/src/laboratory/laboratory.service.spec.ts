import { BadRequestException, NotFoundException } from '@nestjs/common';
import { LaboratoryService } from './laboratory.service';

describe('LaboratoryService order status', () => {
  const medplum = { readResource: jest.fn(), updateResource: jest.fn() };
  let service: LaboratoryService;

  beforeEach(() => {
    jest.resetAllMocks();
    medplum.readResource.mockResolvedValue({
      resourceType: 'ServiceRequest',
      id: 'lab-1',
      status: 'active',
      intent: 'order',
      category: [{ coding: [{ code: 'laboratory' }] }],
      subject: { reference: 'Patient/patient-1' },
      extension: [
        {
          url: 'http://hospital-ehr.local/fhir/StructureDefinition/hospital',
          valueReference: { reference: 'Organization/hospital-a' },
        },
      ],
    });
    medplum.updateResource.mockImplementation(async (resource) => resource);
    service = new LaboratoryService({ getClient: () => medplum } as never);
  });

  it("hides another hospital's order", async () => {
    await expect(
      service.updateOrderStatus('lab-1', 'revoked', 'hospital-b'),
    ).rejects.toThrow(NotFoundException);
    expect(medplum.updateResource).not.toHaveBeenCalled();
  });

  it('requires a hospital', async () => {
    await expect(
      service.updateOrderStatus('lab-1', 'revoked', ''),
    ).rejects.toThrow(BadRequestException);
  });

  it("updates the owning hospital's order", async () => {
    await expect(
      service.updateOrderStatus('lab-1', 'revoked', 'hospital-a'),
    ).resolves.toMatchObject({ status: 'revoked', hospitalId: 'hospital-a' });
  });
});
