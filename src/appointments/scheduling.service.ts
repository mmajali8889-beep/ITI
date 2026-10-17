import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Schedule, Slot } from '@medplum/fhirtypes';
import { MedplumService } from '../medplum/medplum.service';
import { CreateScheduleDto, GenerateSlotsDto } from './dto/appointment.dto';

const HOSPITAL = 'https://hospital-ehr.local/fhir/StructureDefinition/schedule-hospital';
@Injectable()
export class SchedulingService {
  constructor(private readonly medplumService: MedplumService) {}
  async createSchedule(dto: CreateScheduleDto) {
    for (const field of ['hospitalId','practitionerId','practitionerName','specialty','serviceType','start','end'] as const) if (!String(dto[field] ?? '').trim()) throw new BadRequestException(`${field} is required`);
    const start = this.date(dto.start), end = this.date(dto.end); if (end <= start) throw new BadRequestException('Schedule end must follow start');
    const schedule: Schedule = { resourceType: 'Schedule', active: true, actor: [{ reference: `Practitioner/${dto.practitionerId}`, display: dto.practitionerName.trim() }], specialty: [{ text: dto.specialty.trim() }], serviceType: [{ text: dto.serviceType.trim() }], planningHorizon: { start: start.toISOString(), end: end.toISOString() }, extension: [{ url: HOSPITAL, valueReference: { reference: `Organization/${dto.hospitalId}` } }] };
    return this.mapSchedule(await this.medplumService.getClient().createResource<Schedule>(schedule));
  }
  async generateSlots(scheduleId: string, dto: GenerateSlotsDto) {
    const schedule = await this.schedule(scheduleId, dto.hospitalId); const start = this.date(dto.start), end = this.date(dto.end);
    if (!Number.isInteger(dto.durationMinutes) || dto.durationMinutes < 5 || dto.durationMinutes > 480 || end <= start) throw new BadRequestException('Invalid slot range or duration');
    if (schedule.planningHorizon && (start < new Date(schedule.planningHorizon.start!) || end > new Date(schedule.planningHorizon.end!))) throw new BadRequestException('Slots must remain within the schedule horizon');
    const existing = await this.medplumService.getClient().searchResources('Slot', { schedule: `Schedule/${scheduleId}`, _count: '1000' }); const created: Array<Record<string, unknown>> = [];
    for (let cursor = start.getTime(); cursor + dto.durationMinutes * 60000 <= end.getTime(); cursor += dto.durationMinutes * 60000) { const slotEnd = cursor + dto.durationMinutes * 60000; if (existing.some((item) => new Date(item.start).getTime() < slotEnd && new Date(item.end).getTime() > cursor)) continue; const slot: Slot = { resourceType: 'Slot', schedule: { reference: `Schedule/${scheduleId}` }, status: 'free', start: new Date(cursor).toISOString(), end: new Date(slotEnd).toISOString(), serviceType: schedule.serviceType, specialty: schedule.specialty, extension: [{ url: HOSPITAL, valueReference: { reference: `Organization/${dto.hospitalId}` } }] }; created.push(this.mapSlot(await this.medplumService.getClient().createResource<Slot>(slot), schedule)); }
    return { scheduleId, total: created.length, slots: created };
  }
  async available(hospitalId: string, date?: string, practitionerId?: string, specialty?: string) { if (!hospitalId) throw new BadRequestException('Hospital ID is required'); const schedules = (await this.medplumService.getClient().searchResources('Schedule', { _count: '500' })).filter((item) => this.hospitalId(item) === hospitalId && item.active && (!practitionerId || item.actor.some((actor) => actor.reference === `Practitioner/${practitionerId}`)) && (!specialty || item.specialty?.some((value) => value.text?.toLowerCase() === specialty.toLowerCase()))); const ids = new Set(schedules.map((item) => item.id).filter((id): id is string => Boolean(id))); const slots = (await this.medplumService.getClient().searchResources('Slot', { _count: '1000' })).filter((item) => { const scheduleId=item.schedule.reference?.replace('Schedule/',''); return item.status === 'free' && Boolean(scheduleId && ids.has(scheduleId)) && (!date || item.start.slice(0,10) === date); }); return { total: slots.length, slots: slots.map((item) => this.mapSlot(item, schedules.find((schedule) => item.schedule.reference === `Schedule/${schedule.id}`))) }; }
  async reserve(slotId: string, hospitalId: string) { const slot = await this.slot(slotId, hospitalId); if (slot.status !== 'free') throw new ConflictException('Selected slot is no longer available'); return slot; }
  async mark(slot: Slot, status: 'free'|'busy') { slot.status = status; return this.medplumService.getClient().updateResource<Slot>(slot); }
  async slot(id: string, hospitalId: string) { let item: Slot; try { item = await this.medplumService.getClient().readResource('Slot', id); } catch { throw new NotFoundException('Slot not found'); } if (this.hospitalId(item) !== hospitalId) throw new NotFoundException('Slot not found'); return item; }
  private async schedule(id: string, hospitalId: string) { let item: Schedule; try { item = await this.medplumService.getClient().readResource('Schedule', id); } catch { throw new NotFoundException('Schedule not found'); } if (this.hospitalId(item) !== hospitalId || !item.active) throw new NotFoundException('Schedule not found'); return item; }
  private date(value: string) { const date = new Date(value); if (Number.isNaN(date.getTime())) throw new BadRequestException('Invalid date'); return date; }
  private hospitalId(item: Schedule|Slot) { return item.extension?.find((ext) => ext.url === HOSPITAL)?.valueReference?.reference?.replace('Organization/',''); }
  private mapSchedule(item: Schedule) { return { id:item.id,hospitalId:this.hospitalId(item),active:item.active,practitionerId:item.actor[0]?.reference?.replace('Practitioner/',''),practitionerName:item.actor[0]?.display,specialty:item.specialty?.[0]?.text,serviceType:item.serviceType?.[0]?.text,start:item.planningHorizon?.start,end:item.planningHorizon?.end }; }
  private mapSlot(item: Slot, schedule?: Schedule) { return { id:item.id,scheduleId:item.schedule.reference?.replace('Schedule/',''),hospitalId:this.hospitalId(item),status:item.status,start:item.start,end:item.end,practitionerId:schedule?.actor[0]?.reference?.replace('Practitioner/',''),practitionerName:schedule?.actor[0]?.display,specialty:item.specialty?.[0]?.text,serviceType:item.serviceType?.[0]?.text }; }
}
