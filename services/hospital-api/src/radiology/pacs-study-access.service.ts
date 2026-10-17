import { Injectable } from '@nestjs/common';
import type { ImagingStudy, Patient } from '@medplum/fhirtypes';
import { MedplumService } from '../medplum/medplum.service';

const UID_SYSTEM = 'urn:dicom:uid';
const POSITIVE_TTL_MS = 60_000;
// Short, so a study linked by the 15-second PACS sync appears quickly.
const NEGATIVE_TTL_MS = 15_000;
const SEARCH_BATCH = 40;

/**
 * Decides whether a DICOM study belongs to a hospital. A study is visible only
 * when it is linked to an order (a FHIR ImagingStudy created by the PACS sync)
 * whose patient is managed by that hospital. Unlinked studies stay hidden.
 *
 * Decisions are cached briefly because OHIF requests frames continuously, and
 * a Medplum lookup per request would hit Medplum's rate limit.
 */
@Injectable()
export class PacsStudyAccessService {
  private readonly decisions = new Map<string, { allowed: boolean; until: number }>();
  private readonly patientHospital = new Map<string, { hospital?: string; until: number }>();

  constructor(private readonly medplumService: MedplumService) {}

  async isAllowed(studyInstanceUid: string, hospitalId: string): Promise<boolean> {
    return (await this.allowedUids([studyInstanceUid], hospitalId)).has(studyInstanceUid);
  }

  async allowedUids(studyInstanceUids: string[], hospitalId: string): Promise<Set<string>> {
    const now = Date.now();
    const allowed = new Set<string>();
    const unknown: string[] = [];
    for (const uid of new Set(studyInstanceUids.filter(Boolean))) {
      const cached = this.decisions.get(`${hospitalId}|${uid}`);
      if (cached && cached.until > now) {
        if (cached.allowed) allowed.add(uid);
      } else {
        unknown.push(uid);
      }
    }

    const client = this.medplumService.getClient();
    for (let i = 0; i < unknown.length; i += SEARCH_BATCH) {
      const batch = unknown.slice(i, i + SEARCH_BATCH);
      const studies = await client.searchResources('ImagingStudy', {
        identifier: batch.map((uid) => `${UID_SYSTEM}|urn:oid:${uid}`).join(','),
        _count: String(batch.length * 5),
      }) as ImagingStudy[];
      const owners = new Map<string, Set<string>>();
      for (const study of studies) {
        const uid = study.identifier?.find((id) => id.system === UID_SYSTEM)?.value?.replace(/^urn:oid:/, '');
        const patientId = study.subject?.reference?.replace(/^Patient\//, '');
        if (!uid || !patientId) continue;
        const hospital = await this.hospitalOfPatient(patientId);
        if (hospital) owners.set(uid, (owners.get(uid) ?? new Set()).add(hospital));
      }
      for (const uid of batch) {
        // Allowed only when every linked order belongs to this hospital, so a
        // study shared with another hospital's patient is never exposed.
        const hospitals = owners.get(uid);
        const ok = !!hospitals && hospitals.size === 1 && hospitals.has(hospitalId);
        this.decisions.set(`${hospitalId}|${uid}`, { allowed: ok, until: now + (ok ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS) });
        if (ok) allowed.add(uid);
      }
    }
    return allowed;
  }

  private async hospitalOfPatient(patientId: string): Promise<string | undefined> {
    const now = Date.now();
    const cached = this.patientHospital.get(patientId);
    if (cached && cached.until > now) return cached.hospital;
    const patient = await this.medplumService.getClient().readResource('Patient', patientId).catch(() => undefined) as Patient | undefined;
    const hospital = patient?.managingOrganization?.reference?.replace(/^Organization\//, '');
    this.patientHospital.set(patientId, { hospital, until: now + POSITIVE_TTL_MS });
    return hospital;
  }
}
