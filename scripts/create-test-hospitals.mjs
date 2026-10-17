// Creates the dedicated UAT hospitals HOSP-01, HOSP-02 and HOSP-03 (idempotent).
// They sit under the existing EHR Healthcare Group, carry the same departments
// as the production-shaped hospitals, and are tagged `uat` so test data can be
// told apart from real hospitals.
//
// Usage: node create-test-hospitals.mjs   (reads MEDPLUM_* from scripts/.env)

import 'dotenv/config';
import { MedplumClient } from '@medplum/core';

const ORG_CODE_SYSTEM = 'https://hospital-ehr.local/organization-code';
const ORG_TYPE_SYSTEM = 'https://hospital-ehr.local/organization-type';
const LOCATION_CODE_SYSTEM = 'https://hospital-ehr.local/location-code';
const UAT_TAG = { system: 'https://hospital-ehr.local/environment', code: 'uat', display: 'UAT test data' };

const HOSPITALS = [
  ['HOSP-01', 'UAT Test Hospital 01'],
  ['HOSP-02', 'UAT Test Hospital 02'],
  ['HOSP-03', 'UAT Test Hospital 03'],
];
const DEPARTMENTS = [
  ['ED', 'Emergency Department'],
  ['OPD', 'Outpatient Department'],
  ['IPD', 'Inpatient Department'],
  ['ICU', 'Intensive Care Unit'],
  ['LAB', 'Laboratory'],
  ['RAD', 'Radiology'],
  ['PHR', 'Pharmacy'],
  ['OR', 'Operating Room'],
];

const medplum = new MedplumClient({ baseUrl: process.env.MEDPLUM_BASE_URL });
await medplum.startClientLogin(process.env.MEDPLUM_CLIENT_ID, process.env.MEDPLUM_CLIENT_SECRET);

async function upsertOrganization({ code, name, type, parentId }) {
  const [existing] = await medplum.searchResources('Organization', { identifier: `${ORG_CODE_SYSTEM}|${code}` });
  if (existing) {
    console.log(`  exists   ${code}  ${existing.id}`);
    return existing;
  }
  const created = await medplum.createResource({
    resourceType: 'Organization',
    meta: { tag: [UAT_TAG] },
    active: true,
    identifier: [{ system: ORG_CODE_SYSTEM, value: code }],
    type: [{ coding: [{ system: ORG_TYPE_SYSTEM, code: type, display: type }] }],
    name,
    ...(parentId && { partOf: { reference: `Organization/${parentId}` } }),
  });
  console.log(`  created  ${code}  ${created.id}`);
  return created;
}

async function upsertLocation({ code, name, organizationId }) {
  const [existing] = await medplum.searchResources('Location', { identifier: `${LOCATION_CODE_SYSTEM}|${code}` });
  if (existing) return existing;
  return medplum.createResource({
    resourceType: 'Location',
    meta: { tag: [UAT_TAG] },
    status: 'active',
    identifier: [{ system: LOCATION_CODE_SYSTEM, value: code }],
    name,
    managingOrganization: { reference: `Organization/${organizationId}` },
    physicalType: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/location-physical-type', code: 'bu' }] },
  });
}

const [group] = await medplum.searchResources('Organization', { identifier: `${ORG_CODE_SYSTEM}|GROUP-001` });
if (!group) throw new Error('GROUP-001 (EHR Healthcare Group) not found; run create-org.mjs first');

for (const [code, name] of HOSPITALS) {
  console.log(`\n${code}`);
  const hospital = await upsertOrganization({ code, name, type: 'hospital', parentId: group.id });
  for (const [suffix, departmentName] of DEPARTMENTS) {
    await upsertOrganization({ code: `${code}-${suffix}`, name: departmentName, type: 'department', parentId: hospital.id });
  }
  await upsertLocation({ code: `${code}-BUILDING-1`, name: `${name} Main Building`, organizationId: hospital.id });
}
console.log('\nDone.');
