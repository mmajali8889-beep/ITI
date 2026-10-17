import { AuditAnalyticsService } from './audit-analytics.service';

describe('AuditAnalyticsService', () => {
  const medplum = { createResource: jest.fn(), searchResources: jest.fn() };
  let service: AuditAnalyticsService;
  const hospitalExtension = { url: 'https://hospital-ehr.local/fhir/StructureDefinition/audit-hospital', valueReference: { reference: 'Organization/hospital-a' } };
  beforeEach(() => { jest.resetAllMocks(); medplum.createResource.mockImplementation(async (resource) => ({ ...resource, id: 'audit-1' })); medplum.searchResources.mockResolvedValue([]); service = new AuditAnalyticsService({ getClient: () => medplum } as never); });

  it('records actor, operation, hospital, outcome, and duration without request body data', async () => {
    await service.record({ hospitalId: 'hospital-a', userId: 'doctor-1', userName: 'Dr UAT', method: 'POST', route: '/api/patients', ip: '127.0.0.1', statusCode: 201, durationMs: 12 });
    expect(medplum.createResource).toHaveBeenCalledWith(expect.objectContaining({ resourceType: 'AuditEvent', action: 'C', outcome: '0', agent: [expect.objectContaining({ requestor: true })], extension: expect.arrayContaining([hospitalExtension]) }));
    expect(JSON.stringify(medplum.createResource.mock.calls[0][0])).not.toContain('password');
  });

  it('does not create an unscoped audit event', async () => {
    await service.record({ method: 'POST', route: '/api/test', statusCode: 200, durationMs: 1 });
    expect(medplum.createResource).not.toHaveBeenCalled();
  });

  it('returns only events belonging to the requested hospital', async () => {
    medplum.searchResources.mockResolvedValueOnce([{ resourceType: 'AuditEvent', id: 'a', type: { code: 'rest' }, recorded: '2026-01-01T00:00:00Z', agent: [{ requestor: true }], source: { observer: { reference: 'Organization/hospital-a' } }, extension: [hospitalExtension] }, { resourceType: 'AuditEvent', id: 'b', type: { code: 'rest' }, recorded: '2026-01-02T00:00:00Z', agent: [{ requestor: true }], source: { observer: { reference: 'Organization/hospital-b' } }, extension: [{ ...hospitalExtension, valueReference: { reference: 'Organization/hospital-b' } }] }]);
    await expect(service.events('hospital-a')).resolves.toMatchObject({ total: 1, events: [{ id: 'a' }] });
  });

  it('uses the FHIR Encounter service-provider search parameter', async () => {
    await service.overview('hospital-a');
    expect(medplum.searchResources).toHaveBeenCalledWith('Encounter', {
      'service-provider': 'Organization/hospital-a',
      _count: '1000',
    });
  });

  it('records the patient and encounter as searchable AuditEvent entities (27.1)', async () => {
    await service.record({ hospitalId: 'hospital-a', userId: 'nurse-1', method: 'POST', route: '/api/vitals', statusCode: 201, durationMs: 9, patientId: 'patient-1', encounterId: 'encounter-1' });
    const event = medplum.createResource.mock.calls[0][0];
    expect(event.entity).toEqual(expect.arrayContaining([
      expect.objectContaining({ what: { reference: 'Patient/patient-1' }, role: expect.objectContaining({ code: '1', display: 'Patient' }) }),
      expect.objectContaining({ what: { reference: 'Encounter/encounter-1' } }),
    ]));
  });

  it('writes no patient or encounter entity when the request had none', async () => {
    await service.record({ hospitalId: 'hospital-a', method: 'POST', route: '/api/inventory/items', statusCode: 201, durationMs: 3 });
    expect(medplum.createResource.mock.calls[0][0].entity).toHaveLength(1);
  });

  it('filters events by patient and encounter on the server and returns them', async () => {
    medplum.searchResources.mockResolvedValueOnce([{ resourceType: 'AuditEvent', id: 'a', recorded: '2026-01-01T00:00:00Z', agent: [{ requestor: true }], entity: [{ name: '/api/vitals' }, { what: { reference: 'Patient/patient-1' } }, { what: { reference: 'Encounter/encounter-1' } }], extension: [hospitalExtension] }]);
    await expect(service.events('hospital-a', 50, { patientId: 'patient-1', encounterId: 'encounter-1' })).resolves.toMatchObject({ events: [{ id: 'a', patientId: 'patient-1', encounterId: 'encounter-1' }] });
    expect(medplum.searchResources).toHaveBeenCalledWith('AuditEvent', expect.objectContaining({ source: 'Organization/hospital-a', patient: 'Patient/patient-1', entity: 'Encounter/encounter-1' }));
  });
});
