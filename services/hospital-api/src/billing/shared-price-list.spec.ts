import { BadRequestException, ConflictException } from '@nestjs/common';
import { AdministrationService } from '../administration/administration.service';
import { BillingService } from './billing.service';

// Administration → Price Lists and Billing → Tariffs are one price list: an
// item made in either screen is listed in both, and charge capture can use it.
const SD = 'https://hospital-ehr.local/fhir/StructureDefinition';
const adminHospital = (h: string) => ({
  url: `${SD}/admin-hospital`,
  valueReference: { reference: `Organization/${h}` },
});
const billingHospital = (h: string) => ({
  url: `${SD}/billing-hospital`,
  valueReference: { reference: `Organization/${h}` },
});
const price = (value: number) => [
  { priceComponent: [{ type: 'base', amount: { value, currency: 'SAR' } }] },
];

describe('Shared price list (Administration and Billing)', () => {
  const medplum = {
    searchResources: jest.fn(),
    createResource: jest.fn(),
    readResource: jest.fn(),
    updateResource: jest.fn(),
  };
  const medplumService = { getClient: () => medplum } as never;
  let admin: AdministrationService;
  let billing: BillingService;
  beforeEach(() => {
    jest.resetAllMocks();
    medplum.searchResources.mockResolvedValue([]);
    medplum.createResource.mockImplementation(async (r: object) => ({
      ...r,
      id: 'made-1',
    }));
    admin = new AdministrationService(medplumService);
    billing = new BillingService(medplumService);
  });

  it('an Administration price item is a billing tariff with its category', async () => {
    await admin.createCatalog({
      hospitalId: 'h1',
      kind: 'price-lists',
      code: 'CONS-GP',
      name: 'GP consultation',
      price: 25,
      category: 'consultation',
    });
    const created = medplum.createResource.mock.calls[0][0] as {
      extension: Array<{ url: string; valueString?: string }>;
    };
    expect(created.extension).toEqual(
      expect.arrayContaining([
        adminHospital('h1'),
        billingHospital('h1'),
        { url: `${SD}/tariff-category`, valueString: 'consultation' },
      ]),
    );
  });

  it('Administration requires a valid category and a free code', async () => {
    await expect(
      admin.createCatalog({
        hospitalId: 'h1',
        kind: 'price-lists',
        code: 'X',
        name: 'X',
        price: 5,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    medplum.searchResources.mockResolvedValue([
      {
        resourceType: 'ChargeItemDefinition',
        id: 't1',
        status: 'active',
        code: { coding: [{ code: 'CONS-GP' }] },
        extension: [billingHospital('h1')],
      },
    ]);
    await expect(
      admin.createCatalog({
        hospitalId: 'h1',
        kind: 'price-lists',
        code: 'CONS-GP',
        name: 'GP',
        price: 5,
        category: 'consultation',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('a Billing tariff is listed under Administration, and the reverse', async () => {
    await billing.createTariff({
      hospitalId: 'h1',
      category: 'laboratory',
      code: 'CBC',
      description: 'Complete blood count',
      unitPrice: 12,
    });
    const created = medplum.createResource.mock.calls[0][0] as {
      extension: Array<{ url: string; valueCode?: string }>;
    };
    expect(created.extension).toEqual(
      expect.arrayContaining([
        adminHospital('h1'),
        { url: `${SD}/admin-kind`, valueCode: 'price-lists' },
      ]),
    );

    medplum.searchResources.mockResolvedValue([
      {
        resourceType: 'ChargeItemDefinition',
        id: 'from-admin',
        status: 'active',
        title: 'GP consultation',
        code: { coding: [{ code: 'CONS-GP' }] },
        propertyGroup: price(25),
        extension: [
          adminHospital('h1'),
          { url: `${SD}/admin-kind`, valueCode: 'price-lists' },
        ],
      },
      {
        resourceType: 'ChargeItemDefinition',
        id: 'old-billing',
        status: 'active',
        title: 'X-ray',
        code: { coding: [{ code: 'XR' }] },
        propertyGroup: price(40),
        extension: [
          billingHospital('h1'),
          { url: `${SD}/tariff-category`, valueString: 'radiology' },
        ],
      },
      {
        resourceType: 'ChargeItemDefinition',
        id: 'other-hospital',
        status: 'active',
        code: { coding: [{ code: 'Z' }] },
        extension: [adminHospital('h2')],
      },
    ]);
    expect((await billing.tariffs('h1')).items.map((t) => t.id)).toEqual([
      'from-admin',
      'old-billing',
    ]);
    const listed = (await admin.catalog('h1', 'price-lists')).items;
    expect(listed.map((i) => i.id)).toEqual(['from-admin', 'old-billing']);
    expect(listed.find((i) => i.id === 'old-billing')).toMatchObject({
      category: 'radiology',
      price: 40,
    });
  });
});
