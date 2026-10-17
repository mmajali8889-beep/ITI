import { RadiologyService } from './radiology.service';

describe('RadiologyService RIS workflow', () => {
  const workflowUrl = 'http://hospital-ehr.local/fhir/StructureDefinition/radiology-workflow-status';
  let order: any;
  const medplum = { readResource: jest.fn(), updateResource: jest.fn() };
  const imagingStudies = { getByOrder: jest.fn() };
  let service: RadiologyService;

  beforeEach(() => {
    jest.resetAllMocks();
    order = { resourceType: 'ServiceRequest', id: 'rad-1', status: 'active', intent: 'order',
      category: [{ coding: [{ system: 'http://snomed.info/sct', code: '363679005' }] }],
      code: { text: 'CT Brain' }, subject: { reference: 'Patient/patient-1' }, encounter: { reference: 'Encounter/encounter-1' },
      extension: [{ url: workflowUrl, valueCode: 'exam-started' }] };
    medplum.readResource.mockImplementation(async () => order);
    medplum.updateResource.mockImplementation(async (resource) => { order = resource; return resource; });
    // By default the PACS sync has linked a study to the order.
    imagingStudies.getByOrder.mockResolvedValue({ orderId: 'rad-1', studies: [{ id: 'study-1' }] });
    service = new RadiologyService({ getClient: () => medplum } as never, {} as never, imagingStudies as never);
  });

  it('advances acquisition through preliminary reporting to final', async () => {
    await expect(service.updateWorkflowStatus('rad-1', 'acquired')).resolves.toMatchObject({ workflowStatus: 'acquired' });
    await expect(service.updateWorkflowStatus('rad-1', 'reporting')).resolves.toMatchObject({ workflowStatus: 'reporting' });
    await expect(service.updateWorkflowStatus('rad-1', 'preliminary')).resolves.toMatchObject({ workflowStatus: 'preliminary' });
    await expect(service.updateWorkflowStatus('rad-1', 'final')).resolves.toMatchObject({ workflowStatus: 'final', status: 'completed' });
  });

  it('does not regress an advanced radiology workflow', async () => {
    order.extension = [{ url: workflowUrl, valueCode: 'preliminary' }];
    await expect(service.updateWorkflowStatus('rad-1', 'arrived')).resolves.toMatchObject({ workflowStatus: 'preliminary' });
    expect(medplum.updateResource).not.toHaveBeenCalled();
  });

  it('only lets the owning hospital change the order status', async () => {
    order.extension.push({ url: 'http://hospital-ehr.local/fhir/StructureDefinition/hospital', valueReference: { reference: 'Organization/hospital-a' } });
    await expect(service.updateOrderStatus('rad-1', 'revoked', 'hospital-b')).rejects.toThrow('Radiology order not found');
    await expect(service.updateOrderStatus('rad-1', 'revoked', '')).rejects.toThrow('hospitalId is required.');
    expect(medplum.updateResource).not.toHaveBeenCalled();
    await expect(service.updateOrderStatus('rad-1', 'revoked', 'hospital-a')).resolves.toMatchObject({ status: 'revoked' });
  });

  it('refuses images-available and later steps until the PACS has the study (26.1)', async () => {
    imagingStudies.getByOrder.mockResolvedValue({ orderId: 'rad-1', studies: [] });
    order.identifier = [{ system: 'http://hospital-ehr.local/fhir/NamingSystem/radiology-accession', value: 'RAD-ACC-1' }];
    // Acquisition is not gated: the modality may not have sent the images yet.
    await expect(service.updateWorkflowStatus('rad-1', 'acquired')).resolves.toMatchObject({ workflowStatus: 'acquired' });
    medplum.updateResource.mockClear();
    for (const step of ['images-available', 'reporting', 'preliminary', 'final'] as const) {
      const error = await service.updateWorkflowStatus('rad-1', step).catch((e: { getResponse(): unknown }) => e.getResponse());
      expect(error).toMatchObject({ code: 'IMAGES_NOT_IN_PACS' });
    }
    expect(medplum.updateResource).not.toHaveBeenCalled();
  });

  it('allows images-available once the PACS sync has linked a study', async () => {
    order.extension = [{ url: workflowUrl, valueCode: 'acquired' }];
    await expect(service.updateWorkflowStatus('rad-1', 'images-available')).resolves.toMatchObject({ workflowStatus: 'images-available' });
    expect(imagingStudies.getByOrder).toHaveBeenCalledWith('rad-1');
  });
});
