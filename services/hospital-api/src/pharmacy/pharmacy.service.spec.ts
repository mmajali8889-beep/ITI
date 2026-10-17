import { ConflictException, NotFoundException } from '@nestjs/common';
import { PharmacyService } from './pharmacy.service';

describe('PharmacyService', () => {
  const medplum = { searchResources: jest.fn(), readResource: jest.fn(), createResource: jest.fn(), updateResource: jest.fn() };
  let service: PharmacyService;
  beforeEach(() => { jest.resetAllMocks(); medplum.searchResources.mockResolvedValue([]); medplum.createResource.mockImplementation(async r => ({ ...r, id: 'created-1' })); medplum.updateResource.mockImplementation(async r => r); service = new PharmacyService({ getClient: () => medplum } as never); });

  it('receives a hospital-scoped medication batch', async () => {
    const result = await service.receive({ hospitalId:'hospital-a', medicationCode:'AMOX500', medicationName:'Amoxicillin', form:'Capsule', unit:'capsule', lotNumber:'LOT-1', expirationDate:'2999-01-01', quantity:100, reorderLevel:20 });
    expect(result).toMatchObject({ medicationCode:'AMOX500', lotNumber:'LOT-1', quantity:100 });
    expect(medplum.createResource).toHaveBeenCalledWith(expect.objectContaining({ resourceType:'Medication', batch:expect.objectContaining({ lotNumber:'LOT-1' }) }));
  });

  it('blocks duplicate lot numbers within the hospital', async () => {
    medplum.searchResources.mockResolvedValueOnce([{ resourceType:'Medication', code:{ coding:[{ code:'AMOX500' }] }, batch:{ lotNumber:'LOT-1' }, extension:[{ url:'https://hospital-ehr.local/fhir/StructureDefinition/pharmacy-hospital', valueReference:{ reference:'Organization/hospital-a' } }] }]);
    await expect(service.receive({ hospitalId:'hospital-a', medicationCode:'AMOX500', medicationName:'Amoxicillin', form:'Capsule', unit:'capsule', lotNumber:'LOT-1', expirationDate:'2999-01-01', quantity:100, reorderLevel:20 })).rejects.toThrow(ConflictException);
  });

  it('rejects a prescription outside the hospital boundary', async () => {
    medplum.readResource.mockResolvedValueOnce({ resourceType:'MedicationRequest', id:'rx-1', status:'active', extension:[{ url:'https://hospital-ehr.local/fhir/StructureDefinition/medication-hospital', valueReference:{ reference:'Organization/hospital-b' } }] });
    await expect(service.dispense({ hospitalId:'hospital-a', medicationRequestId:'rx-1', quantity:1, pharmacistName:'Pharmacist', counselingProvided:true })).rejects.toThrow(NotFoundException);
  });

  it('blocks dispensing when stock is insufficient', async () => {
    const rx={ resourceType:'MedicationRequest', id:'rx-1', status:'active', medicationCodeableConcept:{ coding:[{ code:'AMOX500' }], text:'Amoxicillin' }, subject:{ reference:'Patient/p1' }, dispenseRequest:{ quantity:{ value:10, unit:'capsule' } }, extension:[{ url:'https://hospital-ehr.local/fhir/StructureDefinition/medication-hospital', valueReference:{ reference:'Organization/hospital-a' } },{url:'https://hospital-ehr.local/fhir/StructureDefinition/pharmacy-verification',valueString:JSON.stringify({decision:'approved'})}] };
    medplum.readResource.mockResolvedValueOnce(rx);
    medplum.searchResources.mockImplementation(async (type:string) => type==='MedicationRequest' ? [rx] : []);
    await expect(service.dispense({ hospitalId:'hospital-a', medicationRequestId:'rx-1', quantity:10, pharmacistName:'Pharmacist', counselingProvided:true })).rejects.toThrow(ConflictException);
  });

  it('uses available stock and completes a fully dispensed prescription', async () => {
    const hospitalExtension = { url:'https://hospital-ehr.local/fhir/StructureDefinition/pharmacy-hospital', valueReference:{ reference:'Organization/hospital-a' } };
    const rx = { resourceType:'MedicationRequest', id:'rx-1', status:'active', medicationCodeableConcept:{ coding:[{ code:'AMOX500' }], text:'Amoxicillin' }, subject:{ reference:'Patient/p1' }, dispenseRequest:{ quantity:{ value:10, unit:'capsule' } }, extension:[{ url:'https://hospital-ehr.local/fhir/StructureDefinition/medication-hospital', valueReference:{ reference:'Organization/hospital-a' } },{url:'https://hospital-ehr.local/fhir/StructureDefinition/pharmacy-verification',valueString:JSON.stringify({decision:'approved'})}] };
    const stock = { resourceType:'Medication', id:'stock-1', status:'active', code:{ coding:[{ code:'AMOX500' }] }, batch:{ lotNumber:'LOT-1', expirationDate:'2999-01-01' }, extension:[hospitalExtension,{ url:'https://hospital-ehr.local/fhir/StructureDefinition/stock-quantity', valueInteger:20 }] };
    medplum.readResource.mockResolvedValueOnce(rx);
    medplum.searchResources.mockImplementation(async (type:string) => type==='MedicationRequest'?[rx]:type==='Medication'?[stock]:[]);
    await service.dispense({ hospitalId:'hospital-a', medicationRequestId:'rx-1', quantity:10, pharmacistName:'Pharmacist', counselingProvided:true });
    expect((stock.extension.find(item=>item.url.endsWith('stock-quantity')) as { valueInteger?: number } | undefined)?.valueInteger).toBe(10);
    expect(rx.status).toBe('completed');
  });

  it('requires all four clinical checks before pharmacist approval', async () => {
    const rx={resourceType:'MedicationRequest',id:'rx-1',status:'active',extension:[{url:'https://hospital-ehr.local/fhir/StructureDefinition/medication-hospital',valueReference:{reference:'Organization/hospital-a'}}]};
    medplum.readResource.mockResolvedValue(rx);
    await expect(service.verifyPrescription('rx-1',{hospitalId:'hospital-a',pharmacistName:'Pharmacist',allergyChecked:true,interactionChecked:false,doseChecked:true,stockChecked:true,decision:'approved'})).rejects.toThrow('Allergy, interaction, dose and stock checks are required');
  });
});
