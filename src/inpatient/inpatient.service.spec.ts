import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { MedplumService } from '../medplum/medplum.service';
import { InpatientService } from './inpatient.service';
import { BedManagementService } from '../bed-management/bed-management.service';

describe('InpatientService ADT and bed management', () => {
  let service: InpatientService;
  const bed = { resourceType: 'Location', id: 'bed-1', status: 'active', name: 'Medical · 101 · A',
    identifier: [{ value: 'A' }], managingOrganization: { reference: 'Organization/hospital-a' },
    physicalType: { coding: [{ code: 'bd' }] }, extension: [
      { url: 'https://hospital-ehr.local/fhir/StructureDefinition/ward-code', valueString: 'MED' },
      { url: 'https://hospital-ehr.local/fhir/StructureDefinition/ward-name', valueString: 'Medical Ward' },
      { url: 'https://hospital-ehr.local/fhir/StructureDefinition/room-number', valueString: '101' },
    ] };
  const encounter = { resourceType: 'Encounter', id: 'encounter-1', status: 'triaged', subject: { reference: 'Patient/patient-1' },
    serviceProvider: { reference: 'Organization/hospital-a' }, location: [] };
  const admission = { resourceType:'Task', id:'admission-1', status:'ready', code:{coding:[{code:'inpatient-admission'}]}, for:{reference:'Patient/patient-1'}, encounter:{reference:'Encounter/encounter-1'}, extension:[{url:'https://hospital-ehr.local/fhir/StructureDefinition/admission-hospital',valueReference:{reference:'Organization/hospital-a'}},{url:'https://hospital-ehr.local/fhir/StructureDefinition/bed-request',valueString:'{"preferredWard":"MED"}'}] };
  const medplum = { readResource: jest.fn(), searchResources: jest.fn(), createResource: jest.fn(), updateResource: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    medplum.readResource.mockImplementation(async (type: string) => type === 'Encounter' ? { ...encounter, location: [] } : type === 'Task' ? { ...admission, extension:[...admission.extension] } : { ...bed });
    medplum.searchResources.mockResolvedValue([]);
    medplum.updateResource.mockImplementation(async (resource) => resource);
    medplum.createResource.mockImplementation(async (resource) => ({ ...resource, id: 'bed-new' }));
    const module: TestingModule = await Test.createTestingModule({ providers: [InpatientService,
      { provide: MedplumService, useValue: { getClient: () => medplum } },
      { provide: BedManagementService, useValue: { updateState: jest.fn().mockResolvedValue({}), markDirty: jest.fn().mockResolvedValue({}) } }] }).compile();
    service = module.get(InpatientService);
  });

  it('admits the patient and activates the selected bed location', async () => {
    const result = await service.admit({ hospitalId: 'hospital-a', encounterId: 'encounter-1', patientId: 'patient-1', bedId: 'bed-1', admissionRequestId:'admission-1', admissionReason: 'Requires monitoring' });
    expect(result).toMatchObject({ encounterId: 'encounter-1', bed: { id: 'bed-1' } });
    expect(medplum.updateResource).toHaveBeenCalledWith(expect.objectContaining({ class: expect.objectContaining({ code: 'IMP' }),
      location: expect.arrayContaining([expect.objectContaining({ status: 'active', location: { reference: 'Location/bed-1', display: bed.name } })]) }));
  });

  it('prevents two encounters from occupying the same bed', async () => {
    medplum.searchResources.mockResolvedValue([{ resourceType: 'Encounter', id: 'other', status: 'in-progress', serviceProvider: { reference: 'Organization/hospital-a' },
      location: [{ status: 'active', location: { reference: 'Location/bed-1' } }] }]);
    await expect(service.admit({ hospitalId: 'hospital-a', encounterId: 'encounter-1', patientId: 'patient-1', bedId: 'bed-1', admissionRequestId:'admission-1', admissionReason: 'Monitoring' }))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects a bed belonging to another hospital', async () => {
    medplum.readResource.mockImplementation(async (type: string) => type === 'Encounter' ? encounter : type === 'Task' ? admission : { ...bed, managingOrganization: { reference: 'Organization/hospital-b' } });
    await expect(service.admit({ hospitalId: 'hospital-a', encounterId: 'encounter-1', patientId: 'patient-1', bedId: 'bed-1', admissionRequestId:'admission-1', admissionReason: 'Monitoring' }))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it('calculates ward occupancy from active encounter locations', async () => {
    medplum.searchResources.mockImplementation(async (type: string) => type === 'Location' ? [bed] : [{ ...encounter, status: 'in-progress',
      location: [{ status: 'active', location: { reference: 'Location/bed-1' } }] }]);
    await expect(service.census('hospital-a')).resolves.toMatchObject({ totalBeds: 1, occupied: 1, available: 0, occupancyRate: 100,
      wards: [{ wardCode: 'MED', occupied: 1 }] });
  });

  it('requires office approval and authorization before a bed request', async () => {
    let task:any={...admission,status:'requested',extension:[admission.extension[0]]};
    medplum.readResource.mockImplementation(async(type:string)=>type==='Task'?task:encounter);
    medplum.updateResource.mockImplementation(async(resource:any)=>{task=resource;return resource;});
    await expect(service.reviewAdmission('admission-1',{hospitalId:'hospital-a',decision:'approved',admissionOfficerName:'Admission Officer'})).resolves.toMatchObject({status:'accepted'});
    await expect(service.authorizeAdmission('admission-1',{hospitalId:'hospital-a',status:'approved',authorizationNumber:'AUTH-1',authorizedBy:'Payer Portal'})).resolves.toMatchObject({authorization:expect.objectContaining({status:'approved'})});
    await expect(service.requestBed('admission-1',{hospitalId:'hospital-a',preferredWard:'MED'})).resolves.toMatchObject({status:'ready',bedRequest:expect.objectContaining({preferredWard:'MED'})});
  });
});
