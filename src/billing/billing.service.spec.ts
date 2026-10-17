import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { BillingService } from './billing.service';

describe('BillingService', () => {
  const medplum = { readResource: jest.fn(), searchResources: jest.fn(), createResource: jest.fn(), updateResource: jest.fn() };
  let service: BillingService;
  const billingHospital = { url: 'https://hospital-ehr.local/fhir/StructureDefinition/billing-hospital', valueReference: { reference: 'Organization/hospital-a' } };
  const encounter = { resourceType: 'Encounter', id: 'encounter-1', status: 'in-progress', subject: { reference: 'Patient/patient-1' }, serviceProvider: { reference: 'Organization/hospital-a' }, extension: [{ url: 'https://hospital-ehr.local/fhir/StructureDefinition/encounter-financial-class', valueCode: 'insurance' }] };
  const charge = { resourceType: 'ChargeItem', id: 'charge-1', status: 'billable', code: { coding: [{ code: 'CONSULT' }], text: 'Consultation' }, subject: { reference: 'Patient/patient-1' }, context: { reference: 'Encounter/encounter-1' }, quantity: { value: 1 }, priceOverride: { value: 250, currency: 'SAR' }, extension: [billingHospital] };
  const invoice = { resourceType: 'Invoice', id: 'invoice-1', status: 'issued', subject: { reference: 'Patient/patient-1' }, totalGross: { value: 250, currency: 'SAR' }, extension: [billingHospital, { url: 'https://hospital-ehr.local/fhir/StructureDefinition/billing-encounter', valueString: 'encounter-1' }, { url: 'https://hospital-ehr.local/fhir/StructureDefinition/invoice-paid', valueMoney: { value: 0, currency: 'SAR' } }, { url: 'https://hospital-ehr.local/fhir/StructureDefinition/invoice-balance', valueMoney: { value: 250, currency: 'SAR' } }], lineItem: [{ sequence: 1, chargeItemReference: { reference: 'ChargeItem/charge-1' } }] };
  const coverage = { resourceType: 'Coverage', id: 'coverage-1', status: 'active', beneficiary: { reference: 'Patient/patient-1' }, payor: [{ reference: 'Organization/payer-1' }], extension: [{ url: 'financial-hospital', valueReference: { reference: 'Organization/hospital-a' } }] };

  beforeEach(() => {
    jest.resetAllMocks(); medplum.searchResources.mockResolvedValue([]);
    medplum.readResource.mockImplementation(async (type: string) => type === 'Encounter' ? encounter : type === 'Invoice' ? structuredClone(invoice) : type === 'Coverage' ? coverage : { resourceType: 'Claim', id: 'claim-1', status: 'active', patient: { reference: 'Patient/patient-1' }, provider: { reference: 'Organization/hospital-a' }, insurance: [{ coverage: { reference: 'Coverage/coverage-1' } }], type: { text: 'Professional' }, use: 'claim', total: { value: 250, currency: 'SAR' }, extension: [billingHospital, { url: 'https://hospital-ehr.local/fhir/StructureDefinition/claim-invoice', valueString: 'invoice-1' }] });
    medplum.createResource.mockImplementation(async (resource) => ({ ...resource, id: `${resource.resourceType.toLowerCase()}-1` }));
    medplum.updateResource.mockImplementation(async (resource) => resource);
    service = new BillingService({ getClient: () => medplum } as never);
  });

  it('captures a priced charge only after financial classification', async () => {
    await expect(service.createCharge({ hospitalId: 'hospital-a', patientId: 'patient-1', encounterId: 'encounter-1', code: 'CONSULT', description: 'Consultation', quantity: 1, unitPrice: 250 })).resolves.toMatchObject({ hospitalId: 'hospital-a', total: 250, status: 'billable' });
  });

  it('blocks billing before financial classification', async () => {
    medplum.readResource.mockResolvedValueOnce({ ...encounter, extension: [] });
    await expect(service.createCharge({ hospitalId: 'hospital-a', patientId: 'patient-1', encounterId: 'encounter-1', code: 'X', description: 'Test', quantity: 1, unitPrice: 1 })).rejects.toThrow(ConflictException);
  });

  it('creates an invoice and marks included charges billed', async () => {
    medplum.searchResources.mockResolvedValueOnce([]).mockResolvedValueOnce([charge]);
    await expect(service.createInvoice({ hospitalId: 'hospital-a', patientId: 'patient-1', encounterId: 'encounter-1' })).resolves.toMatchObject({ total: 250, balance: 250, status: 'issued' });
    expect(medplum.updateResource).toHaveBeenCalledWith(expect.objectContaining({ status: 'billed' }));
  });

  it('prevents overpayment', async () => {
    await expect(service.recordPayment('invoice-1', { hospitalId: 'hospital-a', amount: 251, method: 'cash', reference: 'PAY-1' })).rejects.toThrow(ConflictException);
  });

  it('records payment and balances a fully paid invoice', async () => {
    const result = await service.recordPayment('invoice-1', { hospitalId: 'hospital-a', amount: 250, method: 'card', reference: 'POS-1' });
    expect(result.invoice).toMatchObject({ status: 'balanced', paid: 250, balance: 0 });
    expect(medplum.createResource).toHaveBeenCalledWith(expect.objectContaining({ resourceType: 'PaymentReconciliation' }));
  });

  it('rejects coverage whose payer differs from the claim payer', async () => {
    await expect(service.submitClaim({ hospitalId: 'hospital-a', patientId: 'patient-1', encounterId: 'encounter-1', invoiceId: 'invoice-1', coverageId: 'coverage-1', payerId: 'payer-2' })).rejects.toThrow(BadRequestException);
  });

  it('submits an insurance claim linked to invoice, coverage, and payer', async () => {
    const result = await service.submitClaim({ hospitalId: 'hospital-a', patientId: 'patient-1', encounterId: 'encounter-1', invoiceId: 'invoice-1', coverageId: 'coverage-1', payerId: 'payer-1', authorizationNumber: 'AUTH-1' });
    expect(result).toMatchObject({ hospitalId: 'hospital-a', patientId: 'patient-1', invoiceId: 'invoice-1', coverageId: 'coverage-1', payerId: 'payer-1', amount: 250 });
    expect(medplum.createResource).toHaveBeenCalledWith(expect.objectContaining({ resourceType: 'Claim', insurance: [expect.objectContaining({ preAuthRef: ['AUTH-1'] })] }));
  });

  it('records an adjudication and requires a reason for denial', async () => {
    await expect(service.adjudicate('claim-1', { hospitalId: 'hospital-a', outcome: 'error', approvedAmount: 0, adjudicationReference: 'ADJ-1' })).rejects.toThrow(BadRequestException);
    await expect(service.adjudicate('claim-1', { hospitalId: 'hospital-a', outcome: 'complete', approvedAmount: 200, adjudicationReference: 'ADJ-2' })).resolves.toMatchObject({ outcome: 'complete', approvedAmount: 200 });
  });

  it('lets an adjudication be retried after the insurer payment fails', async () => {
    const dto = { hospitalId: 'hospital-a', outcome: 'complete' as const, approvedAmount: 200, adjudicationReference: 'ADJ-3' };
    medplum.createResource.mockImplementation(async (resource) => {
      if (resource.resourceType === 'PaymentReconciliation') throw new Error('Too Many Requests');
      return { ...resource, id: `${resource.resourceType.toLowerCase()}-1` };
    });
    await expect(service.adjudicate('claim-1', dto)).rejects.toThrow('Too Many Requests');
    expect(medplum.updateResource).not.toHaveBeenCalledWith(expect.objectContaining({ resourceType: 'Claim' }));

    const savedResponse = medplum.createResource.mock.calls.map(([resource]) => resource).find((resource) => resource.resourceType === 'ClaimResponse');
    medplum.createResource.mockReset();
    medplum.createResource.mockImplementation(async (resource) => ({ ...resource, id: `${resource.resourceType.toLowerCase()}-1` }));
    medplum.searchResources.mockImplementation(async (type: string) => type === 'ClaimResponse' ? [{ ...savedResponse, id: 'claimresponse-1' }] : []);
    const result = await service.adjudicate('claim-1', dto);
    expect(result).toMatchObject({ responseId: 'claimresponse-1', invoice: { paid: 200, balance: 50 } });
    expect(medplum.createResource).not.toHaveBeenCalledWith(expect.objectContaining({ resourceType: 'ClaimResponse' }));
    expect(medplum.updateResource).toHaveBeenCalledWith(expect.objectContaining({ resourceType: 'Claim', extension: expect.arrayContaining([expect.objectContaining({ url: 'https://hospital-ehr.local/fhir/StructureDefinition/claim-outcome' })]) }));
  });

  it('rejects a retry whose details differ from the unfinished adjudication', async () => {
    medplum.searchResources.mockImplementation(async (type: string) => type === 'ClaimResponse' ? [{ resourceType: 'ClaimResponse', id: 'cr-1', outcome: 'complete', preAuthRef: 'ADJ-4', total: [{ amount: { value: 100 } }], extension: [billingHospital] }] : []);
    await expect(service.adjudicate('claim-1', { hospitalId: 'hospital-a', outcome: 'complete', approvedAmount: 200, adjudicationReference: 'ADJ-4' })).rejects.toThrow(ConflictException);
  });

  it('does not post the insurer payment twice when the invoice update was interrupted', async () => {
    medplum.searchResources.mockImplementation(async (type: string) => type === 'PaymentReconciliation' ? [{ resourceType: 'PaymentReconciliation', status: 'active', paymentIdentifier: { value: 'ADJ-5' }, paymentAmount: { value: 250, currency: 'SAR' }, extension: [{ url: 'https://hospital-ehr.local/fhir/StructureDefinition/payment-method', valueCode: 'insurance' }, { url: 'https://hospital-ehr.local/fhir/StructureDefinition/payment-invoice', valueReference: { reference: 'Invoice/invoice-1' } }] }] : []);
    const result = await service.adjudicate('claim-1', { hospitalId: 'hospital-a', outcome: 'complete', approvedAmount: 250, adjudicationReference: 'ADJ-5' });
    expect(result.invoice).toMatchObject({ status: 'balanced', paid: 250, balance: 0 });
    expect(medplum.createResource).not.toHaveBeenCalledWith(expect.objectContaining({ resourceType: 'PaymentReconciliation' }));
  });

  it('hides an invoice owned by another hospital', async () => {
    medplum.readResource.mockResolvedValueOnce({ ...invoice, extension: [{ ...billingHospital, valueReference: { reference: 'Organization/hospital-b' } }] });
    await expect(service.recordPayment('invoice-1', { hospitalId: 'hospital-a', amount: 10, method: 'cash', reference: 'PAY-2' })).rejects.toThrow(NotFoundException);
  });

  it('captures billable clinical events once using the tariff catalog', async () => {
    const tariff = { resourceType: 'ChargeItemDefinition', id: 'tariff-1', status: 'active', title: 'Lab tariff', code: { coding: [{ code: 'LAB' }] }, propertyGroup: [{ priceComponent: [{ amount: { value: 40, currency: 'SAR' } }] }], extension: [billingHospital, { url: 'https://hospital-ehr.local/fhir/StructureDefinition/tariff-category', valueString: 'laboratory' }] };
    const lab = { resourceType: 'ServiceRequest', id: 'lab-1', status: 'completed', category: [{ coding: [{ code: 'laboratory' }] }], code: { text: 'CBC' } };
    medplum.searchResources.mockImplementation(async (type: string) => type === 'ChargeItemDefinition' ? [tariff] : type === 'ServiceRequest' ? [lab] : []);
    const result = await service.capture('encounter-1', { hospitalId: 'hospital-a' });
    expect(result.captured).toEqual([expect.objectContaining({ description: 'CBC', total: 40 })]);
    expect(result.skipped).toEqual(expect.arrayContaining([expect.objectContaining({ source: 'Encounter/encounter-1', reason: 'missing-consultation-tariff' })]));
  });
});
