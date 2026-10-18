import { BadRequestException } from '@nestjs/common';
import { JourneyPathwaysService } from './journey-pathways.service';

describe('JourneyPathwaysService', () => {
  const medplum = { searchResources: jest.fn(), upsertResource: jest.fn() };
  let service: JourneyPathwaysService;
  beforeEach(() => {
    jest.resetAllMocks();
    medplum.searchResources.mockResolvedValue([]);
    medplum.upsertResource.mockImplementation(async (r: unknown) => r);
    service = new JourneyPathwaysService({
      getClient: () => medplum,
    } as never);
  });

  it('lists the default pathways and the locked milestones', async () => {
    const r = await service.list('h1');
    expect(r.pathways.map((p) => p.code)).toEqual([
      'outpatient',
      'emergency',
      'inpatient',
      'day-case',
      'diagnostic',
      'procedure',
    ]);
    expect(r.pathways.every((p) => !p.customized)).toBe(true);
    expect(r.milestones.filter((m) => m.locked).map((m) => m.key)).toEqual([
      'mpi',
      'entry',
      'encounter',
    ]);
  });

  it('stores one record per hospital, keeps locked milestones and journey order', async () => {
    await service.save('h1', {
      emergency: ['billing', 'triage'],
      outpatient: null,
    });
    expect(medplum.upsertResource).toHaveBeenCalledTimes(1);
    const [record, query] = medplum.upsertResource.mock.calls[0] as [
      { subject: unknown; extension: Array<{ valueString: string }> },
      string,
    ];
    expect(query).toBe(
      `identifier=${encodeURIComponent('https://hospital-ehr.local/journey-pathways')}|h1`,
    );
    expect(record.subject).toEqual({ reference: 'Organization/h1' });
    expect(JSON.parse(record.extension[0].valueString)).toEqual({
      emergency: ['mpi', 'entry', 'encounter', 'triage', 'billing'],
    });
  });

  it('rejects unknown pathways and milestones', async () => {
    await expect(
      service.save('h1', { maternity: ['mpi'] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.save('h1', { emergency: ['teleport'] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.save('h1', { emergency: 'triage' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.save('', {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(medplum.upsertResource).not.toHaveBeenCalled();
  });

  it('reports a customised pathway', async () => {
    medplum.searchResources.mockResolvedValue([
      {
        extension: [
          {
            url: 'https://hospital-ehr.local/fhir/StructureDefinition/journey-pathways',
            valueString: JSON.stringify({ emergency: ['mpi', 'triage'] }),
          },
        ],
      },
    ]);
    const r = await service.list('h1');
    const emergency = r.pathways.find((p) => p.code === 'emergency');
    expect(emergency).toMatchObject({
      customized: true,
      required: ['mpi', 'triage'],
    });
    expect(emergency?.defaults).toContain('assessment');
  });
});
