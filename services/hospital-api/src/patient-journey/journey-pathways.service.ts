import { BadRequestException, Injectable } from '@nestjs/common';
import type { Basic } from '@medplum/fhirtypes';
import { MedplumService } from '../medplum/medplum.service';
import {
  JOURNEY_MILESTONES,
  JOURNEY_PATHWAYS,
  LOCKED_MILESTONES,
  PATHWAY_CODES,
  type PathwayCode,
} from './journey-pathways';

const CONFIG_SYSTEM = 'https://hospital-ehr.local/CodeSystem/configuration';
const CONFIG_IDENTIFIER = 'https://hospital-ehr.local/journey-pathways';
const CONFIG_URL =
  'https://hospital-ehr.local/fhir/StructureDefinition/journey-pathways';

export type PathwayOverrides = Partial<Record<PathwayCode, string[]>>;

export interface ResolvedPathway {
  code: PathwayCode;
  label: string;
  required: string[];
  source: 'default' | 'hospital';
}

/** Per-hospital mandatory milestones for each care pathway (27.3). */
@Injectable()
export class JourneyPathwaysService {
  constructor(private readonly medplumService: MedplumService) {}

  /** A journey never fails over its configuration: unreadable means defaults. */
  async resolve(
    hospitalId: string,
    code: PathwayCode,
  ): Promise<ResolvedPathway> {
    const overrides = await this.overrides(hospitalId).catch(
      (): PathwayOverrides => ({}),
    );
    const custom = overrides[code];
    return {
      code,
      label: JOURNEY_PATHWAYS[code].label,
      required: custom ?? [...JOURNEY_PATHWAYS[code].required],
      source: custom ? 'hospital' : 'default',
    };
  }

  async list(hospitalId: string) {
    this.requireHospital(hospitalId);
    const overrides = await this.overrides(hospitalId);
    return {
      hospitalId,
      milestones: JOURNEY_MILESTONES.map((m) => ({
        key: m.key,
        label: m.label,
        locked: LOCKED_MILESTONES.includes(m.key),
      })),
      pathways: PATHWAY_CODES.map((code) => ({
        code,
        label: JOURNEY_PATHWAYS[code].label,
        required: overrides[code] ?? [...JOURNEY_PATHWAYS[code].required],
        defaults: [...JOURNEY_PATHWAYS[code].required],
        customized: Boolean(overrides[code]),
      })),
    };
  }

  /**
   * Replaces the hospital's overrides. A pathway left out (or set to null)
   * goes back to its default; locked milestones are always mandatory.
   */
  async save(hospitalId: string, input: Record<string, unknown> | undefined) {
    this.requireHospital(hospitalId);
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new BadRequestException('pathways must be an object');
    const known = new Set<string>(JOURNEY_MILESTONES.map((m) => m.key));
    const overrides: PathwayOverrides = {};
    for (const [code, value] of Object.entries(input)) {
      if (!PATHWAY_CODES.includes(code as PathwayCode))
        throw new BadRequestException(`Unknown pathway: ${code}`);
      if (value === null || value === undefined) continue;
      if (!Array.isArray(value) || value.some((v) => typeof v !== 'string'))
        throw new BadRequestException(`${code} must list milestone keys`);
      const unknown = (value as string[]).filter((v) => !known.has(v));
      if (unknown.length)
        throw new BadRequestException(
          `Unknown milestone: ${unknown.join(', ')}`,
        );
      const chosen = new Set([...LOCKED_MILESTONES, ...(value as string[])]);
      // Kept in journey order, so the stored record is stable.
      overrides[code as PathwayCode] = JOURNEY_MILESTONES.map(
        (m) => m.key as string,
      ).filter((k) => chosen.has(k));
    }
    const record: Basic = {
      resourceType: 'Basic',
      code: {
        coding: [
          {
            system: CONFIG_SYSTEM,
            code: 'journey-pathways',
            display: 'Patient journey pathways',
          },
        ],
      },
      subject: { reference: `Organization/${hospitalId}` },
      identifier: [{ system: CONFIG_IDENTIFIER, value: hospitalId }],
      extension: [{ url: CONFIG_URL, valueString: JSON.stringify(overrides) }],
    };
    await this.medplumService
      .getClient()
      .upsertResource<Basic>(
        record,
        `identifier=${encodeURIComponent(CONFIG_IDENTIFIER)}|${encodeURIComponent(hospitalId)}`,
      );
    return this.list(hospitalId);
  }

  private async overrides(hospitalId: string): Promise<PathwayOverrides> {
    const [record] = await this.medplumService
      .getClient()
      .searchResources('Basic', {
        identifier: `${CONFIG_IDENTIFIER}|${hospitalId}`,
        _count: '1',
      });
    const raw = record?.extension?.find(
      (e) => e.url === CONFIG_URL,
    )?.valueString;
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw) as PathwayOverrides;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  private requireHospital(hospitalId: string) {
    if (!hospitalId?.trim())
      throw new BadRequestException('Hospital ID is required');
  }
}
