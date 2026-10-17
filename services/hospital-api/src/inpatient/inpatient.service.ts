import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Encounter, Location, Task } from '@medplum/fhirtypes';
import { MedplumService } from '../medplum/medplum.service';
import { AssignBedDto, CreateAdmissionRequestDto, CreateBedDto, CreateBedRequestDto, RecordAdmissionAuthorizationDto, ReviewAdmissionRequestDto, TransferBedDto } from './dto/inpatient.dto';
import { randomUUID } from 'node:crypto';
import { BedManagementService } from '../bed-management/bed-management.service';

const ORG = (id: string) => `Organization/${id}`;
const BASE = 'https://hospital-ehr.local/fhir/StructureDefinition';
const ADMISSION_HOSPITAL = `${BASE}/admission-hospital`, OFFICE_DECISION = `${BASE}/admission-office-decision`, AUTHORIZATION = `${BASE}/admission-authorization`, BED_REQUEST = `${BASE}/bed-request`;
const extension = (location: Location, suffix: string) => location.extension?.find((item) => item.url === `https://hospital-ehr.local/fhir/StructureDefinition/${suffix}`)?.valueString;

@Injectable()
export class InpatientService {
  constructor(private readonly medplumService: MedplumService, private readonly bedManagement: BedManagementService) {}

  async requestAdmission(dto: CreateAdmissionRequestDto) {
    for (const key of ['hospitalId','patientId','encounterId','admissionReason','requestingPhysicianName'] as const) if (!String(dto[key] ?? '').trim()) throw new BadRequestException(`${key} is required`);
    if (!['routine','urgent','emergency'].includes(dto.acuity)) throw new BadRequestException('Invalid admission acuity');
    const medplum=this.medplumService.getClient(); let encounter:Encounter;
    try{encounter=await medplum.readResource('Encounter',dto.encounterId);}catch{throw new NotFoundException('Encounter not found');}
    if(encounter.serviceProvider?.reference!==ORG(dto.hospitalId)||encounter.subject?.reference!==`Patient/${dto.patientId}`)throw new NotFoundException('Encounter not found');
    const existing=await medplum.searchResources('Task',{encounter:`Encounter/${dto.encounterId}`,status:'requested,accepted,ready,in-progress',_count:'20'});
    if(existing.some(item=>item.code?.coding?.some(code=>code.code==='inpatient-admission')))throw new ConflictException('An active admission request already exists');
    const task:Task={resourceType:'Task',status:'requested',intent:'order',priority:dto.acuity==='emergency'?'stat':dto.acuity==='urgent'?'urgent':'routine',identifier:[{system:`https://hospital-ehr.local/admission/${dto.hospitalId}`,value:`ADM-${randomUUID().slice(0,8).toUpperCase()}`}],code:{coding:[{system:'https://hospital-ehr.local/CodeSystem/workflow-task',code:'inpatient-admission',display:'Inpatient admission request'}]},for:{reference:`Patient/${dto.patientId}`},encounter:{reference:`Encounter/${dto.encounterId}`},authoredOn:new Date().toISOString(),requester:dto.requestingPhysicianId?{reference:`Practitioner/${dto.requestingPhysicianId}`,display:dto.requestingPhysicianName.trim()}:{display:dto.requestingPhysicianName.trim()},description:dto.admissionReason.trim(),extension:[{url:ADMISSION_HOSPITAL,valueReference:{reference:ORG(dto.hospitalId)}},...(dto.requestedWard?[{url:`${BASE}/requested-ward`,valueString:dto.requestedWard.trim()}]:[])]};
    return this.mapAdmissionRequest(await medplum.createResource<Task>(task));
  }

  async reviewAdmission(id:string,dto:ReviewAdmissionRequestDto){const task=await this.readAdmissionRequest(id,dto.hospitalId);if(!dto.admissionOfficerName?.trim()||!['approved','rejected'].includes(dto.decision))throw new BadRequestException('Admission officer and valid decision are required');if(task.status!=='requested')throw new ConflictException('Admission request is not awaiting office review');const record={decision:dto.decision,officerId:dto.admissionOfficerId,officerName:dto.admissionOfficerName.trim(),note:dto.note?.trim(),at:new Date().toISOString()};task.status=dto.decision==='approved'?'accepted':'rejected';task.extension=[...(task.extension??[]).filter(e=>e.url!==OFFICE_DECISION),{url:OFFICE_DECISION,valueString:JSON.stringify(record)}];return this.mapAdmissionRequest(await this.medplumService.getClient().updateResource(task));}

  async authorizeAdmission(id:string,dto:RecordAdmissionAuthorizationDto){const task=await this.readAdmissionRequest(id,dto.hospitalId);if(task.status!=='accepted')throw new ConflictException('Admission office approval is required before authorization');if(!['approved','denied','not-required'].includes(dto.status)||!dto.authorizedBy?.trim())throw new BadRequestException('Authorization status and authorizer are required');if(dto.status==='approved'&&!dto.authorizationNumber?.trim())throw new BadRequestException('Authorization number is required');const record={status:dto.status,authorizationNumber:dto.authorizationNumber?.trim(),authorizedBy:dto.authorizedBy.trim(),note:dto.note?.trim(),at:new Date().toISOString()};task.status=dto.status==='denied'?'rejected':'accepted';task.extension=[...(task.extension??[]).filter(e=>e.url!==AUTHORIZATION),{url:AUTHORIZATION,valueString:JSON.stringify(record)}];return this.mapAdmissionRequest(await this.medplumService.getClient().updateResource(task));}

  async requestBed(id:string,dto:CreateBedRequestDto){const task=await this.readAdmissionRequest(id,dto.hospitalId);const auth=this.jsonExtension(task,AUTHORIZATION);if(task.status!=='accepted'||!['approved','not-required'].includes(String(auth?.status)))throw new ConflictException('Approved or not-required insurance authorization is required before bed request');const record={preferredWard:dto.preferredWard?.trim(),isolationRequired:dto.isolationRequired??false,bedType:dto.bedType?.trim(),note:dto.note?.trim(),requestedAt:new Date().toISOString()};task.status='ready';task.extension=[...(task.extension??[]).filter(e=>e.url!==BED_REQUEST),{url:BED_REQUEST,valueString:JSON.stringify(record)}];return this.mapAdmissionRequest(await this.medplumService.getClient().updateResource(task));}

  async createBed(dto: CreateBedDto) {
    for (const key of ['hospitalId', 'wardCode', 'wardName', 'roomNumber', 'bedCode'] as const) {
      dto[key] = dto[key]?.trim();
      if (!dto[key]) throw new BadRequestException(`${key} is required`);
    }
    const medplum = this.medplumService.getClient();
    const system = `https://hospital-ehr.local/bed/${dto.hospitalId}`;
    const existing = await medplum.searchResources('Location', { identifier: `${system}|${dto.bedCode.toUpperCase()}` });
    if (existing.length) throw new ConflictException('Bed code already exists');
    const wardSystem=`https://hospital-ehr.local/ward/${dto.hospitalId}`;
    const roomSystem=`https://hospital-ehr.local/room/${dto.hospitalId}`;
    const floorSystem=`https://hospital-ehr.local/floor/${dto.hospitalId}`;
    const floorCode=dto.floorCode?.trim().toUpperCase()||'MAIN',floorName=dto.floorName?.trim()||'Main Floor';
    const floorExisting=await medplum.searchResources('Location',{identifier:`${floorSystem}|${floorCode}`});
    const floor=floorExisting[0]??await medplum.createResource<Location>({resourceType:'Location',status:'active',mode:'instance',name:floorName,identifier:[{system:floorSystem,value:floorCode}],managingOrganization:{reference:ORG(dto.hospitalId)},physicalType:{coding:[{system:'http://terminology.hl7.org/CodeSystem/location-physical-type',code:'lvl',display:'Level'}]}});
    const wardExisting=await medplum.searchResources('Location',{identifier:`${wardSystem}|${dto.wardCode.toUpperCase()}`});
    const ward=wardExisting[0]??await medplum.createResource<Location>({resourceType:'Location',status:'active',mode:'instance',name:dto.wardName,identifier:[{system:wardSystem,value:dto.wardCode.toUpperCase()}],managingOrganization:{reference:ORG(dto.hospitalId)},partOf:{reference:`Location/${floor.id}`,display:floor.name},physicalType:{coding:[{system:'http://terminology.hl7.org/CodeSystem/location-physical-type',code:'wa',display:'Ward'}]}});
    const roomKey=`${dto.wardCode.toUpperCase()}-${dto.roomNumber.toUpperCase()}`;
    const roomExisting=await medplum.searchResources('Location',{identifier:`${roomSystem}|${roomKey}`});
    const room=roomExisting[0]??await medplum.createResource<Location>({resourceType:'Location',status:'active',mode:'instance',name:`${dto.wardName} · Room ${dto.roomNumber}`,identifier:[{system:roomSystem,value:roomKey}],managingOrganization:{reference:ORG(dto.hospitalId)},partOf:{reference:`Location/${ward.id}`,display:ward.name},physicalType:{coding:[{system:'http://terminology.hl7.org/CodeSystem/location-physical-type',code:'ro',display:'Room'}]}});
    const bed = await medplum.createResource<Location>({
      resourceType: 'Location', status: 'active', mode: 'instance', name: `${dto.wardName} · ${dto.roomNumber} · ${dto.bedCode}`,
      identifier: [{ system, value: dto.bedCode.toUpperCase() }], managingOrganization: { reference: ORG(dto.hospitalId) },
      partOf: { reference: `Location/${room.id}`, display: room.name },
      physicalType: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/location-physical-type', code: 'bd', display: 'Bed' }], text: 'Bed' },
      operationalStatus: { system: 'http://terminology.hl7.org/CodeSystem/v2-0116', code: 'U', display: 'Unoccupied' },
      extension: [
        { url: 'https://hospital-ehr.local/fhir/StructureDefinition/floor-code', valueString: floorCode },
        { url: 'https://hospital-ehr.local/fhir/StructureDefinition/floor-name', valueString: floorName },
        { url: 'https://hospital-ehr.local/fhir/StructureDefinition/ward-code', valueString: dto.wardCode.toUpperCase() },
        { url: 'https://hospital-ehr.local/fhir/StructureDefinition/ward-name', valueString: dto.wardName },
        { url: 'https://hospital-ehr.local/fhir/StructureDefinition/room-number', valueString: dto.roomNumber },
        { url: 'https://hospital-ehr.local/fhir/StructureDefinition/bed-state', valueString: 'available' },
      ],
    });
    return this.mapBed(bed);
  }

  async census(hospitalId: string) {
    if (!hospitalId) throw new BadRequestException('Hospital ID is required');
    const medplum = this.medplumService.getClient();
    const [locations, encounters] = await Promise.all([
      medplum.searchResources('Location', { organization: hospitalId, status: 'active', _count: '500' }),
      medplum.searchResources('Encounter', { status: 'in-progress,triaged,onleave', _count: '500' }),
    ]);
    const beds = locations.filter((item) => item.physicalType?.coding?.some((coding) => coding.code === 'bd') && item.managingOrganization?.reference === ORG(hospitalId));
    const occupants = new Map<string, Encounter>();
    for (const encounter of encounters) {
      if (encounter.serviceProvider?.reference !== ORG(hospitalId)) continue;
      const active = encounter.location?.find((item) => item.status === 'active' && item.location.reference?.startsWith('Location/'));
      if (active?.location.reference) occupants.set(active.location.reference.replace('Location/', ''), encounter);
    }
    const mapped = beds.map((bed) => this.mapBed(bed, occupants.get(bed.id ?? '')));
    const wards = [...new Set(mapped.map((bed) => bed.wardCode))].sort().map((wardCode) => {
      const wardBeds = mapped.filter((bed) => bed.wardCode === wardCode);
      return { wardCode, wardName: wardBeds[0]?.wardName, total: wardBeds.length, occupied: wardBeds.filter((bed) => bed.occupied).length,
        available: wardBeds.filter((bed) => !bed.occupied).length, beds: wardBeds };
    });
    return { totalBeds: mapped.length, occupied: mapped.filter((bed) => bed.occupied).length,
      available: mapped.filter((bed) => !bed.occupied).length, occupancyRate: mapped.length ? Math.round(mapped.filter((bed) => bed.occupied).length / mapped.length * 100) : 0, wards };
  }

  async admit(dto: AssignBedDto) {
    if (!dto.admissionRequestId) throw new BadRequestException('Admission request is required');
    const admissionRequest = await this.readAdmissionRequest(dto.admissionRequestId, dto.hospitalId);
    if (admissionRequest.status !== 'ready' || !this.jsonExtension(admissionRequest, BED_REQUEST)) throw new ConflictException('Admission workflow and bed request must be completed before assignment');
    if (admissionRequest.for?.reference !== `Patient/${dto.patientId}` || admissionRequest.encounter?.reference !== `Encounter/${dto.encounterId}`) throw new NotFoundException('Admission request not found');
    const { medplum, encounter, bed } = await this.validateAssignment(dto.hospitalId, dto.encounterId, dto.bedId, dto.patientId);
    if (!dto.admissionReason?.trim()) throw new BadRequestException('Admission reason is required');
    await this.assertBedAvailable(dto.hospitalId, dto.bedId, dto.encounterId);
    // Occupy the bed first: its guarded update lets only one of two racing
    // admissions win, and the loser leaves the encounter untouched.
    await this.bedManagement.updateState(dto.bedId, { hospitalId: dto.hospitalId, state: 'occupied', actorName: 'Admission Office', reason: dto.admissionReason, patientId: dto.patientId, encounterId: dto.encounterId });
    this.closeActiveLocations(encounter);
    encounter.status = 'in-progress';
    encounter.class = { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'IMP', display: 'Inpatient Encounter' };
    encounter.location = [...(encounter.location ?? []), { location: { reference: `Location/${dto.bedId}`, display: bed.name }, status: 'active', period: { start: new Date().toISOString() } }];
    encounter.hospitalization = { ...encounter.hospitalization, admitSource: { text: dto.admissionReason.trim() } };
    const admitted = await medplum.updateResource<Encounter>(encounter);
    admissionRequest.status = 'completed';
    admissionRequest.output = [{ type: { text: 'Assigned bed' }, valueReference: { reference: `Location/${dto.bedId}`, display: bed.name } }];
    await medplum.updateResource(admissionRequest);
    return this.mapAdmission(admitted, bed);
  }

  async transfer(dto: TransferBedDto) {
    if (!dto.reason?.trim()) throw new BadRequestException('Transfer reason is required');
    const { medplum, encounter, bed } = await this.validateAssignment(dto.hospitalId, dto.encounterId, dto.targetBedId);
    await this.assertBedAvailable(dto.hospitalId, dto.targetBedId, dto.encounterId);
    const previousBedId = encounter.location?.find((item) => item.status === 'active')?.location.reference?.replace('Location/', '');
    const patientId = encounter.subject?.reference?.replace('Patient/', '');
    // Occupy the target bed first so a rejected occupancy leaves the encounter untouched.
    await this.bedManagement.updateState(dto.targetBedId, { hospitalId: dto.hospitalId, state: 'occupied', actorName: 'Bed Management', reason: dto.reason, patientId, encounterId: dto.encounterId });
    this.closeActiveLocations(encounter);
    encounter.location = [...(encounter.location ?? []), { location: { reference: `Location/${dto.targetBedId}`, display: bed.name }, status: 'active', period: { start: new Date().toISOString() }, extension: [{ url: 'https://hospital-ehr.local/fhir/StructureDefinition/transfer-reason', valueString: dto.reason.trim() }] }];
    const moved = await medplum.updateResource<Encounter>(encounter);
    if (previousBedId) await this.bedManagement.markDirty(previousBedId, dto.hospitalId, 'Bed Management', `Transfer: ${dto.reason}`);
    return this.mapAdmission(moved, bed);
  }

  private async validateAssignment(hospitalId: string, encounterId: string, bedId: string, patientId?: string) {
    if (!hospitalId || !encounterId || !bedId) throw new BadRequestException('Hospital, encounter and bed are required');
    const medplum = this.medplumService.getClient();
    let encounter: Encounter; let bed: Location;
    try { [encounter, bed] = await Promise.all([medplum.readResource('Encounter', encounterId), medplum.readResource('Location', bedId)]); }
    catch { throw new NotFoundException('Encounter or bed not found'); }
    if (encounter.serviceProvider?.reference !== ORG(hospitalId) || bed.managingOrganization?.reference !== ORG(hospitalId)) throw new NotFoundException('Encounter or bed not found');
    if (patientId && encounter.subject?.reference !== `Patient/${patientId}`) throw new BadRequestException('Encounter does not belong to this patient');
    if (!bed.physicalType?.coding?.some((coding) => coding.code === 'bd') || bed.status !== 'active') throw new BadRequestException('Selected location is not an active bed');
    return { medplum, encounter, bed };
  }

  private async readAdmissionRequest(id:string,hospitalId:string){if(!id||!hospitalId)throw new BadRequestException('Admission request and hospital are required');let task:Task;try{task=await this.medplumService.getClient().readResource('Task',id);}catch{throw new NotFoundException('Admission request not found');}if(task.extension?.find(e=>e.url===ADMISSION_HOSPITAL)?.valueReference?.reference!==ORG(hospitalId)||!task.code?.coding?.some(code=>code.code==='inpatient-admission'))throw new NotFoundException('Admission request not found');return task;}
  private jsonExtension(task:Task,url:string){try{return JSON.parse(task.extension?.find(e=>e.url===url)?.valueString??'null') as Record<string,unknown>|null;}catch{return null;}}
  private mapAdmissionRequest(task:Task){return{id:task.id,identifier:task.identifier?.[0]?.value,status:task.status,priority:task.priority,patientId:task.for?.reference?.replace('Patient/',''),encounterId:task.encounter?.reference?.replace('Encounter/',''),reason:task.description,requestedWard:task.extension?.find(e=>e.url===`${BASE}/requested-ward`)?.valueString,officeDecision:this.jsonExtension(task,OFFICE_DECISION),authorization:this.jsonExtension(task,AUTHORIZATION),bedRequest:this.jsonExtension(task,BED_REQUEST),assignedBedId:task.output?.[0]?.valueReference?.reference?.replace('Location/',''),authoredOn:task.authoredOn};}

  private async assertBedAvailable(hospitalId: string, bedId: string, encounterId: string) {
    const encounters = await this.medplumService.getClient().searchResources('Encounter', { status: 'in-progress,triaged,onleave', _count: '500' });
    const occupied = encounters.some((item) => item.id !== encounterId && item.serviceProvider?.reference === ORG(hospitalId) && item.location?.some((location) => location.status === 'active' && location.location.reference === `Location/${bedId}`));
    if (occupied) throw new ConflictException({ message: 'Bed is already occupied', code: 'BED_OCCUPIED', bedId });
  }

  private closeActiveLocations(encounter: Encounter) {
    const now = new Date().toISOString();
    encounter.location = encounter.location?.map((item) => item.status === 'active' ? { ...item, status: 'completed', period: { ...item.period, end: now } } : item);
  }

  private mapBed(bed: Location, encounter?: Encounter) { return { id: bed.id, code: bed.identifier?.[0]?.value, name: bed.name,
    wardCode: extension(bed, 'ward-code') ?? 'UNASSIGNED', wardName: extension(bed, 'ward-name') ?? 'Unassigned Ward', roomNumber: extension(bed, 'room-number'),
    occupied: Boolean(encounter), encounterId: encounter?.id, patientId: encounter?.subject?.reference?.replace('Patient/', ''), patientName: encounter?.subject?.display } }
  private mapAdmission(encounter: Encounter, bed: Location) { return { encounterId: encounter.id, patientId: encounter.subject?.reference?.replace('Patient/', ''), status: encounter.status, bed: this.mapBed(bed) }; }
}
