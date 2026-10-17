import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AppointmentsService } from './appointments.service';

describe('AppointmentsService', () => {
  const medplum = { readResource: jest.fn(), searchResources: jest.fn(), createResource: jest.fn(), updateResource: jest.fn() };
  const encounters = { create: jest.fn() };
  const scheduling = { reserve: jest.fn(), mark: jest.fn(), slot: jest.fn() };
  let service: AppointmentsService;
  const dto = () => ({ hospitalId: 'hospital-a', patientId: 'patient-1', practitionerName: 'Dr Sara', department: 'Cardiology',
    serviceType: 'Consultation', reason: 'Clinical follow-up', start: new Date(Date.now() + 86_400_000).toISOString(), durationMinutes: 30, priority: 'routine' as const });

  beforeEach(() => {
    jest.resetAllMocks();
    medplum.readResource.mockResolvedValue({ resourceType: 'Patient', id: 'patient-1', managingOrganization: { reference: 'Organization/hospital-a' }, name: [{ text: 'Test Patient' }] });
    medplum.searchResources.mockResolvedValue([]);
    medplum.createResource.mockImplementation(async (resource) => ({ ...resource, id: 'appointment-1' }));
    medplum.updateResource.mockImplementation(async (resource) => resource);
    encounters.create.mockResolvedValue({ id: 'encounter-1' });
    scheduling.mark.mockResolvedValue(undefined);
    service = new AppointmentsService({ getClient: () => medplum } as never, encounters as never, scheduling as never);
  });

  it('creates a hospital-scoped FHIR appointment', async () => {
    await expect(service.create(dto())).resolves.toMatchObject({ id: 'appointment-1', hospitalId: 'hospital-a', status: 'booked' });
    expect(medplum.createResource).toHaveBeenCalledWith(expect.objectContaining({ resourceType: 'Appointment', status: 'booked', participant: expect.any(Array) }));
    expect(medplum.createResource).toHaveBeenCalledWith(expect.objectContaining({ resourceType: 'Communication', status: 'completed' }));
  });

  it('books a selected free slot and marks it busy',async()=>{
    const slot={resourceType:'Slot',id:'slot-1',status:'free',start:new Date(Date.now()+86400000).toISOString(),end:new Date(Date.now()+88200000).toISOString(),schedule:{reference:'Schedule/schedule-1'}};scheduling.reserve.mockResolvedValueOnce(slot);
    await service.create({...dto(),slotId:'slot-1'});expect(scheduling.mark).toHaveBeenCalledWith(slot,'busy');expect(medplum.createResource).toHaveBeenCalledWith(expect.objectContaining({resourceType:'Appointment',slot:[{reference:'Slot/slot-1'}]}));
  });

  it('supports BOOKED to CONFIRMED without inventing a non-FHIR Appointment status',async()=>{
    medplum.readResource.mockResolvedValueOnce({resourceType:'Appointment',id:'appointment-1',status:'booked',extension:[{url:'https://hospital-ehr.local/fhir/StructureDefinition/appointment-hospital',valueReference:{reference:'Organization/hospital-a'}},{url:'https://hospital-ehr.local/fhir/StructureDefinition/appointment-workflow-status',valueCode:'booked'}],participant:[]});
    const result=await service.updateStatus('appointment-1',{hospitalId:'hospital-a',status:'confirmed'});expect(result).toMatchObject({status:'confirmed',fhirStatus:'booked'});
  });

  it('reschedules onto a new slot and releases the previous slot',async()=>{
    const oldSlot={resourceType:'Slot',id:'old-slot',status:'busy',start:'2026-10-01T08:00:00Z',end:'2026-10-01T08:30:00Z',schedule:{reference:'Schedule/s1'}};const newSlot={...oldSlot,id:'new-slot',status:'free',start:'2026-10-02T09:00:00Z',end:'2026-10-02T09:30:00Z'};
    medplum.readResource.mockResolvedValueOnce({resourceType:'Appointment',id:'appointment-1',status:'booked',slot:[{reference:'Slot/old-slot'}],extension:[{url:'https://hospital-ehr.local/fhir/StructureDefinition/appointment-hospital',valueReference:{reference:'Organization/hospital-a'}}],participant:[]});scheduling.reserve.mockResolvedValueOnce(newSlot);scheduling.slot.mockResolvedValueOnce(oldSlot);
    await expect(service.reschedule('appointment-1',{hospitalId:'hospital-a',slotId:'new-slot',reason:'Patient request'})).resolves.toMatchObject({status:'rescheduled',slotId:'new-slot'});expect(scheduling.mark).toHaveBeenCalledWith(newSlot,'busy');expect(scheduling.mark).toHaveBeenCalledWith(oldSlot,'free');
  });

  it('rejects a patient from another hospital', async () => {
    medplum.readResource.mockResolvedValueOnce({ resourceType: 'Patient', id: 'patient-1', managingOrganization: { reference: 'Organization/hospital-b' } });
    await expect(service.create(dto())).rejects.toThrow(NotFoundException);
  });

  it('blocks overlapping patient or practitioner appointments', async () => {
    const input = dto();
    medplum.searchResources.mockResolvedValueOnce([{ resourceType: 'Appointment', id: 'existing', status: 'booked', start: input.start,
      end: new Date(new Date(input.start).getTime() + 3_600_000).toISOString(), extension: [{ url: 'https://hospital-ehr.local/fhir/StructureDefinition/appointment-hospital', valueReference: { reference: 'Organization/hospital-a' } }],
      participant: [{ actor: { reference: 'Patient/patient-1' }, status: 'accepted' }] }]);
    await expect(service.create(input)).rejects.toThrow(ConflictException);
  });

  it('requires a reason when cancelling', async () => {
    medplum.readResource.mockResolvedValueOnce({ resourceType: 'Appointment', id: 'appointment-1', status: 'booked', extension: [{ url: 'https://hospital-ehr.local/fhir/StructureDefinition/appointment-hospital', valueReference: { reference: 'Organization/hospital-a' } }], participant: [] });
    await expect(service.updateStatus('appointment-1', { hospitalId: 'hospital-a', status: 'cancelled' })).rejects.toThrow(BadRequestException);
  });

  it('checks in a booked appointment and creates a linked encounter', async () => {
    medplum.readResource.mockResolvedValueOnce({ resourceType: 'Appointment', id: 'appointment-1', status: 'booked', description: 'Follow-up',
      extension: [{ url: 'https://hospital-ehr.local/fhir/StructureDefinition/appointment-hospital', valueReference: { reference: 'Organization/hospital-a' } },
        { url: 'https://hospital-ehr.local/fhir/StructureDefinition/appointment-department', valueString: 'Cardiology' }],
      participant: [{ actor: { reference: 'Patient/patient-1' }, status: 'accepted' }, { actor: { display: 'Dr Sara' }, status: 'accepted' }] });
    await expect(service.checkIn('appointment-1', { hospitalId: 'hospital-a' })).resolves.toMatchObject({ encounter: { id: 'encounter-1' } });
    expect(encounters.create).toHaveBeenCalledWith(expect.objectContaining({ appointmentId: 'appointment-1', arrivalMode: 'appointment' }));
  });
});
