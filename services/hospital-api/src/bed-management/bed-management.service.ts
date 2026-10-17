import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Encounter, Location } from '@medplum/fhirtypes';
import { MedplumService } from '../medplum/medplum.service';
import { BedState, UpdateBedStateDto } from './dto/bed-management.dto';
const BASE = 'https://hospital-ehr.local/fhir/StructureDefinition',
  STATE = `${BASE}/bed-state`,
  HISTORY = `${BASE}/bed-state-history`,
  ORG = (id: string) => `Organization/${id}`;
const ext = (b: Location, s: string) =>
  b.extension?.find((e) => e.url === `${BASE}/${s}`)?.valueString;
const FLOW: Record<BedState, BedState[]> = {
  available: ['occupied', 'reserved', 'blocked', 'maintenance', 'isolation'],
  reserved: ['available', 'occupied'],
  occupied: ['dirty'],
  dirty: ['cleaning'],
  cleaning: ['available'],
  blocked: ['available'],
  maintenance: ['available'],
  isolation: ['available', 'occupied'],
};
@Injectable()
export class BedManagementService {
  constructor(private readonly medplumService: MedplumService) {}
  async board(hospitalId: string) {
    if (!hospitalId) throw new BadRequestException('Hospital ID is required');
    const client = this.medplumService.getClient(),
      [locations, encounters] = await Promise.all([
        client.searchResources('Location', {
          organization: hospitalId,
          status: 'active',
          _count: '1000',
        }),
        client.searchResources('Encounter', {
          status: 'in-progress,onleave',
          _count: '500',
        }),
      ]);
    const beds = locations
      .filter(
        (l) =>
          l.managingOrganization?.reference === ORG(hospitalId) &&
          l.physicalType?.coding?.some((c) => c.code === 'bd'),
      )
      .map((b) => {
        const occupant = encounters.find(
          (e) =>
            e.serviceProvider?.reference === ORG(hospitalId) &&
            e.location?.some(
              (l) =>
                l.status === 'active' &&
                l.location.reference === `Location/${b.id}`,
            ),
        );
        return this.map(b, occupant);
      });
    const hierarchy = [...new Set(beds.map((b) => b.floorCode))]
      .sort()
      .map((floorCode) => ({
        floorCode,
        floorName: beds.find((b) => b.floorCode === floorCode)?.floorName,
        wards: [
          ...new Set(
            beds
              .filter((b) => b.floorCode === floorCode)
              .map((b) => b.wardCode),
          ),
        ]
          .sort()
          .map((wardCode) => ({
            wardCode,
            wardName: beds.find((b) => b.wardCode === wardCode)?.wardName,
            rooms: [
              ...new Set(
                beds
                  .filter((b) => b.wardCode === wardCode)
                  .map((b) => b.roomNumber),
              ),
            ]
              .sort()
              .map((roomNumber) => ({
                roomNumber,
                beds: beds.filter(
                  (b) => b.wardCode === wardCode && b.roomNumber === roomNumber,
                ),
              })),
          })),
      }));
    const counts = Object.fromEntries(
      [
        'available',
        'occupied',
        'reserved',
        'cleaning',
        'dirty',
        'blocked',
        'maintenance',
        'isolation',
      ].map((s) => [s, beds.filter((b) => b.state === s).length]),
    );
    return { hospitalId, total: beds.length, counts, hierarchy, beds };
  }
  async updateState(id: string, dto: UpdateBedStateDto) {
    if (!dto.hospitalId || !dto.actorName?.trim() || !dto.state)
      throw new BadRequestException('Hospital, state and actor are required');
    const bed = await this.read(id, dto.hospitalId),
      current = this.state(bed);
    if (!FLOW[current]?.includes(dto.state))
      throw new ConflictException({
        message: `Bed cannot move from ${current} to ${dto.state}`,
        allowed: FLOW[current],
      });
    if (dto.state === 'occupied' && (!dto.patientId || !dto.encounterId))
      throw new BadRequestException(
        'Patient and encounter are required for occupancy',
      );
    return this.setState(
      bed,
      dto.state,
      dto.actorName,
      dto.reason,
      dto.patientId,
      dto.encounterId,
    );
  }
  async markDirty(
    id: string,
    hospitalId: string,
    actor: string,
    reason: string,
  ) {
    const bed = await this.read(id, hospitalId);
    return this.setState(bed, 'dirty', actor, reason);
  }
  private async setState(
    bed: Location,
    state: BedState,
    actor: string,
    reason?: string,
    patientId?: string,
    encounterId?: string,
  ) {
    let history: Array<Record<string, unknown>> = [];
    try {
      history = JSON.parse(
        bed.extension?.find((e) => e.url === HISTORY)?.valueString ?? '[]',
      );
    } catch {}
    history.push({
      from: this.state(bed),
      to: state,
      actor,
      reason,
      patientId,
      encounterId,
      at: new Date().toISOString(),
    });
    bed.extension = [
      ...(bed.extension ?? []).filter((e) => ![STATE, HISTORY].includes(e.url)),
      { url: STATE, valueString: state },
      { url: HISTORY, valueString: JSON.stringify(history) },
    ];
    bed.operationalStatus = {
      system: 'http://terminology.hl7.org/CodeSystem/v2-0116',
      code:
        state === 'available'
          ? 'U'
          : state === 'cleaning'
            ? 'H'
            : state === 'dirty'
              ? 'C'
              : 'O',
      display: state,
    };
    // Guarded so two requests cannot both move the same bed (e.g. two admissions).
    return this.map(await this.medplumService.updateIfUnchanged(bed));
  }
  private async read(id: string, hospitalId: string) {
    let b: Location;
    try {
      b = await this.medplumService.getClient().readResource('Location', id);
    } catch {
      throw new NotFoundException('Bed not found');
    }
    if (
      b.managingOrganization?.reference !== ORG(hospitalId) ||
      !b.physicalType?.coding?.some((c) => c.code === 'bd')
    )
      throw new NotFoundException('Bed not found');
    return b;
  }
  private state(b: Location) {
    return (ext(b, 'bed-state') ??
      (b.operationalStatus?.code === 'U'
        ? 'available'
        : 'occupied')) as BedState;
  }
  private map(b: Location, e?: Encounter) {
    return {
      id: b.id,
      code: b.identifier?.[0]?.value,
      name: b.name,
      state: e ? 'occupied' : this.state(b),
      floorCode: ext(b, 'floor-code') ?? 'MAIN',
      floorName: ext(b, 'floor-name') ?? 'Main Floor',
      wardCode: ext(b, 'ward-code') ?? 'UNASSIGNED',
      wardName: ext(b, 'ward-name'),
      roomNumber: ext(b, 'room-number'),
      patientId: e?.subject?.reference?.replace('Patient/', ''),
      patientName: e?.subject?.display,
      encounterId: e?.id,
    };
  }
}
