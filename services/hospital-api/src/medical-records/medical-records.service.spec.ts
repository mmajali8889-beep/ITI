import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { MedicalRecordsService } from './medical-records.service';

describe('MedicalRecordsService', () => {
  const medplum = { readResource: jest.fn(), searchResources: jest.fn(), createResource: jest.fn(), updateResource: jest.fn() };
  let service: MedicalRecordsService;
  const encounter = { resourceType: 'Encounter', id: 'encounter-1', status: 'finished', subject: { reference: 'Patient/patient-1' }, serviceProvider: { reference: 'Organization/hospital-a' } };
  const diagnosis = { resourceType: 'Condition', extension: [{ url: 'https://hospital-ehr.local/fhir/StructureDefinition/diagnosis-rank', valueCode: 'primary' }] };
  const note = { resourceType: 'DocumentReference', content: [{ attachment: { data: Buffer.from(JSON.stringify({ status: 'signed' })).toString('base64') } }] };
  const invoice = { resourceType: 'Invoice', id: 'invoice-1', status: 'balanced', subject: { reference: 'Patient/patient-1' }, extension: [{ url: 'https://hospital-ehr.local/fhir/StructureDefinition/billing-hospital', valueReference: { reference: 'Organization/hospital-a' } }, { url: 'https://hospital-ehr.local/fhir/StructureDefinition/billing-encounter', valueString: 'encounter-1' }] };

  beforeEach(() => {
    jest.resetAllMocks(); medplum.readResource.mockResolvedValue(encounter);
    medplum.searchResources.mockImplementation(async (type: string) => type === 'Condition' ? [diagnosis] : type === 'DocumentReference' ? [note] : type === 'Invoice' ? [invoice] : []);
    medplum.createResource.mockImplementation(async (resource) => ({ ...resource, id: resource.resourceType === 'Task' ? 'task-1' : 'record-1' })); medplum.updateResource.mockImplementation(async (resource) => resource);
    service = new MedicalRecordsService({ getClient: () => medplum } as never);
  });

  it('assesses a complete record without deficiencies', async () => {
    await expect(service.assess('encounter-1', { hospitalId: 'hospital-a' })).resolves.toMatchObject({ complete: true, deficiencyCount: 0 });
  });

  it('creates owned deficiency tasks for missing requirements', async () => {
    medplum.searchResources.mockImplementation(async (type: string) => type === 'Task' ? [] : []);
    const result = await service.assess('encounter-1', { hospitalId: 'hospital-a', ownerId: 'him-1', ownerName: 'HIM Officer' });
    expect(result.complete).toBe(false); expect(result.deficiencyCount).toBeGreaterThan(1);
    expect(medplum.createResource).toHaveBeenCalledWith(expect.objectContaining({ resourceType: 'Task', owner: expect.objectContaining({ reference: 'Practitioner/him-1' }) }));
  });

  it('closes and locks a complete finished record', async () => {
    await expect(service.close('encounter-1', { hospitalId: 'hospital-a', practitionerId: 'doctor-1', practitionerName: 'Dr UAT', confirmation: true })).resolves.toMatchObject({ id: 'record-1', status: 'final', hospitalId: 'hospital-a' });
    expect(medplum.createResource).toHaveBeenCalledWith(expect.objectContaining({ resourceType: 'Provenance', target: [{ reference: 'Composition/record-1' }], signature: expect.any(Array) }));
  });

  it('locks a signed record and then archives it with retention metadata', async () => {
    const signed = { resourceType: 'Composition', id: 'record-1', status: 'final', author: [{ reference: 'Practitioner/doctor-1' }], extension: [{ url: 'https://hospital-ehr.local/fhir/StructureDefinition/medical-record-hospital', valueReference: { reference: 'Organization/hospital-a' } }, { url: 'https://hospital-ehr.local/fhir/StructureDefinition/record-status', valueCode: 'signed' }] };
    medplum.readResource.mockResolvedValueOnce(signed);
    const locked = await service.lock('record-1', { hospitalId: 'hospital-a', himOfficerId: 'him-1', himOfficerName: 'HIM Officer', confirmation: true });
    expect(locked.workflowStatus).toBe('locked');
    medplum.readResource.mockResolvedValueOnce({ ...signed, extension: [...signed.extension.slice(0, 1), { url: 'https://hospital-ehr.local/fhir/StructureDefinition/record-status', valueCode: 'locked' }] });
    const archived = await service.archive('record-1', { hospitalId: 'hospital-a', archivistId: 'him-1', archivistName: 'HIM Officer', retentionUntil: '2036-01-01', confirmation: true });
    expect(archived).toMatchObject({ workflowStatus: 'archived', retentionUntil: '2036-01-01' });
  });

  it('prevents archiving an unlocked record', async () => {
    medplum.readResource.mockResolvedValueOnce({ resourceType: 'Composition', id: 'record-1', status: 'final', author: [{}], extension: [{ url: 'https://hospital-ehr.local/fhir/StructureDefinition/medical-record-hospital', valueReference: { reference: 'Organization/hospital-a' } }, { url: 'https://hospital-ehr.local/fhir/StructureDefinition/record-status', valueCode: 'signed' }] });
    await expect(service.archive('record-1', { hospitalId: 'hospital-a', archivistId: 'him-1', archivistName: 'HIM Officer', confirmation: true })).rejects.toThrow(ConflictException);
  });

  it('builds a hospital-isolated HIM queue', async () => {
    medplum.searchResources.mockImplementation(async (type: string) => type === 'Encounter' ? [encounter, { ...encounter, id: 'other', serviceProvider: { reference: 'Organization/hospital-b' } }] : []);
    await expect(service.queue('hospital-a')).resolves.toMatchObject({ total: 1, items: [{ encounterId: 'encounter-1', workflowStatus: 'pending-review' }] });
  });

  it('refuses closure when the encounter is not finished', async () => {
    medplum.readResource.mockResolvedValueOnce({ ...encounter, status: 'in-progress' });
    await expect(service.close('encounter-1', { hospitalId: 'hospital-a', practitionerId: 'doctor-1', practitionerName: 'Dr UAT', confirmation: true })).rejects.toThrow(ConflictException);
  });

  it('hides records from another hospital', async () => {
    medplum.readResource.mockResolvedValueOnce({ ...encounter, serviceProvider: { reference: 'Organization/hospital-b' } });
    await expect(service.get('encounter-1', 'hospital-a')).rejects.toThrow(NotFoundException);
  });

  it('requires a meaningful authorized amendment', async () => {
    await expect(service.amend('record-1', { hospitalId: 'hospital-a', practitionerId: 'doctor-1', practitionerName: 'Dr UAT', reason: 'Correction', note: 'short' })).rejects.toThrow(BadRequestException);
  });
});
