import { RadiologyService } from './radiology.service';

describe('RadiologyService RIS workflow', () => {
  const workflowUrl = 'http://hospital-ehr.local/fhir/StructureDefinition/radiology-workflow-status';
  let order: any;
  const medplum = { readResource: jest.fn(), updateResource: jest.fn() };
  let service: RadiologyService;

  beforeEach(() => {
    jest.resetAllMocks();
    order = { resourceType: 'ServiceRequest', id: 'rad-1', status: 'active', intent: 'order',
      category: [{ coding: [{ system: 'http://snomed.info/sct', code: '363679005' }] }],
      code: { text: 'CT Brain' }, subject: { reference: 'Patient/patient-1' }, encounter: { reference: 'Encounter/encounter-1' },
      extension: [{ url: workflowUrl, valueCode: 'exam-started' }] };
    medplum.readResource.mockImplementation(async () => order);
    medplum.updateResource.mockImplementation(async (resource) => { order = resource; return resource; });
    service = new RadiologyService({ getClient: () => medplum } as never, {} as never);
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
});
