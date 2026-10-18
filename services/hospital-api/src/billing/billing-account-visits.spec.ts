import { BillingService } from './billing.service';

// Billing staff have no clinical permission, so the patient account carries
// the patient's visits for them to charge and invoice.
describe('BillingService patient account visits', () => {
  it("lists the patient's visits at this hospital only", async () => {
    const medplum = {
      searchResources: jest.fn(async (type: string) =>
        type === 'Encounter'
          ? [
              {
                resourceType: 'Encounter',
                id: 'e1',
                status: 'finished',
                identifier: [{ value: 'VIS-1' }],
                type: [{ text: 'Outpatient' }],
                period: { start: '2026-10-18T09:00:00Z' },
                serviceProvider: { reference: 'Organization/h1' },
              },
              {
                resourceType: 'Encounter',
                id: 'e2',
                status: 'finished',
                serviceProvider: { reference: 'Organization/h2' },
              },
            ]
          : [],
      ),
    };
    const service = new BillingService({ getClient: () => medplum } as never);
    const account = await service.patientAccount('p1', 'h1');
    expect(account.encounters).toEqual([
      {
        id: 'e1',
        visitNumber: 'VIS-1',
        type: 'Outpatient',
        status: 'finished',
        start: '2026-10-18T09:00:00Z',
        end: undefined,
      },
    ]);
    expect(medplum.searchResources).toHaveBeenCalledWith(
      'Encounter',
      expect.objectContaining({
        subject: 'Patient/p1',
        'service-provider': 'Organization/h1',
      }),
    );
  });
});
