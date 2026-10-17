import { ConflictException, NotFoundException } from '@nestjs/common';
import { SchedulingService } from './scheduling.service';

describe('SchedulingService', () => {
  const medplum = {
    readResource: jest.fn(),
    searchResources: jest.fn(),
    createResource: jest.fn(),
    updateResource: jest.fn(),
  };
  let service: SchedulingService;
  const hospital = {
    url: 'https://hospital-ehr.local/fhir/StructureDefinition/schedule-hospital',
    valueReference: { reference: 'Organization/hospital-a' },
  };
  beforeEach(() => {
    jest.resetAllMocks();
    medplum.searchResources.mockResolvedValue([]);
    medplum.createResource.mockImplementation(async (resource) => ({
      ...resource,
      id: resource.resourceType === 'Schedule' ? 'schedule-1' : 'slot-1',
    }));
    medplum.updateResource.mockImplementation(async (resource) => resource);
    service = new SchedulingService({ getClient: () => medplum } as never);
  });
  it('creates a practitioner schedule scoped to one hospital', async () => {
    const start = new Date(Date.now() + 86400000),
      end = new Date(start.getTime() + 28800000);
    await expect(
      service.createSchedule({
        hospitalId: 'hospital-a',
        practitionerId: 'doctor-1',
        practitionerName: 'Dr UAT',
        specialty: 'Cardiology',
        serviceType: 'Consultation',
        start: start.toISOString(),
        end: end.toISOString(),
      }),
    ).resolves.toMatchObject({ id: 'schedule-1', hospitalId: 'hospital-a' });
  });
  it('generates free non-overlapping slots', async () => {
    const start = new Date(Date.now() + 86400000),
      end = new Date(start.getTime() + 3600000);
    medplum.readResource.mockResolvedValueOnce({
      resourceType: 'Schedule',
      id: 'schedule-1',
      active: true,
      actor: [],
      planningHorizon: { start: start.toISOString(), end: end.toISOString() },
      extension: [hospital],
    });
    const result = await service.generateSlots('schedule-1', {
      hospitalId: 'hospital-a',
      start: start.toISOString(),
      end: end.toISOString(),
      durationMinutes: 30,
    });
    expect(result.total).toBe(2);
  });
  it('rejects a slot outside the hospital boundary', async () => {
    medplum.readResource.mockResolvedValueOnce({
      resourceType: 'Slot',
      id: 'slot-1',
      status: 'free',
      start: '2026-01-01',
      end: '2026-01-02',
      schedule: { reference: 'Schedule/schedule-1' },
      extension: [
        {
          ...hospital,
          valueReference: { reference: 'Organization/hospital-b' },
        },
      ],
    });
    await expect(service.reserve('slot-1', 'hospital-a')).rejects.toThrow(
      NotFoundException,
    );
  });
  it('prevents double booking a busy slot', async () => {
    medplum.readResource.mockResolvedValueOnce({
      resourceType: 'Slot',
      id: 'slot-1',
      status: 'busy',
      start: '2026-01-01',
      end: '2026-01-02',
      schedule: { reference: 'Schedule/schedule-1' },
      extension: [hospital],
    });
    await expect(service.reserve('slot-1', 'hospital-a')).rejects.toThrow(
      ConflictException,
    );
  });
});
