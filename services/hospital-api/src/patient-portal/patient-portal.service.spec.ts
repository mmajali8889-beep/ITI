import { PatientPortalService } from './patient-portal.service';
describe('PatientPortalService', () => {
  const hospital = {
      url: 'x',
      valueReference: { reference: 'Organization/h1' },
    },
    other = { url: 'x', valueReference: { reference: 'Organization/h2' } };
  const medplum = { readResource: jest.fn(), searchResources: jest.fn() };
  let service: PatientPortalService;
  beforeEach(() => {
    jest.resetAllMocks();
    medplum.readResource.mockResolvedValue({
      resourceType: 'Patient',
      id: 'p1',
      name: [{ text: 'Portal Patient' }],
      identifier: [
        { system: 'https://hospital-ehr.local/mrn/HOSP-A', value: 'MRN-1' },
      ],
    });
    medplum.searchResources.mockImplementation(async (type: string) =>
      type === 'Encounter'
        ? [
            {
              resourceType: 'Encounter',
              id: 'e1',
              status: 'finished',
              subject: { reference: 'Patient/p1' },
              serviceProvider: { reference: 'Organization/h1' },
            },
          ]
        : [],
    );
    service = new PatientPortalService({ getClient: () => medplum } as never);
  });
  it('exposes only released results from the authenticated hospital encounters', async () => {
    medplum.searchResources.mockImplementation(async (type: string) =>
      type === 'Encounter'
        ? [
            {
              resourceType: 'Encounter',
              id: 'e1',
              serviceProvider: { reference: 'Organization/h1' },
            },
            {
              resourceType: 'Encounter',
              id: 'e2',
              serviceProvider: { reference: 'Organization/h2' },
            },
          ]
        : type === 'DiagnosticReport'
          ? [
              {
                resourceType: 'DiagnosticReport',
                id: 'released',
                status: 'final',
                subject: { reference: 'Patient/p1' },
                encounter: { reference: 'Encounter/e1' },
                category: [{ coding: [{ code: 'LAB' }] }],
                code: { text: 'CBC' },
              },
              {
                resourceType: 'DiagnosticReport',
                id: 'draft',
                status: 'preliminary',
                subject: { reference: 'Patient/p1' },
                encounter: { reference: 'Encounter/e1' },
                category: [{ coding: [{ code: 'LAB' }] }],
              },
              {
                resourceType: 'DiagnosticReport',
                id: 'foreign',
                status: 'final',
                subject: { reference: 'Patient/p1' },
                encounter: { reference: 'Encounter/e2' },
                category: [{ coding: [{ code: 'LAB' }] }],
              },
            ]
          : [],
    );
    const r = await service.get('p1', 'h1');
    expect(r.labResults).toHaveLength(1);
    expect(r.labResults[0]).toMatchObject({ id: 'released', title: 'CBC' });
  });
  it('filters appointments, invoices and coverage by hospital', async () => {
    medplum.searchResources.mockImplementation(async (type: string) =>
      type === 'Encounter'
        ? []
        : type === 'Appointment'
          ? [
              {
                resourceType: 'Appointment',
                id: 'a1',
                status: 'booked',
                participant: [],
                extension: [hospital],
              },
              {
                resourceType: 'Appointment',
                id: 'a2',
                status: 'booked',
                participant: [],
                extension: [other],
              },
            ]
          : type === 'Invoice'
            ? [
                {
                  resourceType: 'Invoice',
                  id: 'i1',
                  status: 'issued',
                  extension: [hospital],
                },
                {
                  resourceType: 'Invoice',
                  id: 'i2',
                  status: 'issued',
                  extension: [other],
                },
              ]
            : type === 'Coverage'
              ? [
                  {
                    resourceType: 'Coverage',
                    id: 'c1',
                    status: 'active',
                    beneficiary: { reference: 'Patient/p1' },
                    payor: [],
                    extension: [hospital],
                  },
                ]
              : [],
    );
    const r = await service.get('p1', 'h1');
    expect(r.appointments.map((x) => x.id)).toEqual(['a1']);
    expect(r.bills.map((x) => x.id)).toEqual(['i1']);
    expect(r.insurance.map((x) => x.id)).toEqual(['c1']);
  });
});
