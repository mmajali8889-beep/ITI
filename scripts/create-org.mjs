import 'dotenv/config';
import { MedplumClient } from '@medplum/core';

const medplum = new MedplumClient({
  baseUrl: process.env.MEDPLUM_BASE_URL,
});

await medplum.startClientLogin(
  process.env.MEDPLUM_CLIENT_ID,
  process.env.MEDPLUM_CLIENT_SECRET
);

console.log('✅ Authenticated successfully');

const ORG_CODE_SYSTEM =
  'https://hospital-ehr.local/organization-code';

const ORG_TYPE_SYSTEM =
  'https://hospital-ehr.local/organization-type';

const LOCATION_CODE_SYSTEM =
  'https://hospital-ehr.local/location-code';


// ======================================================
// ORGANIZATION FUNCTIONS
// ======================================================

async function findOrganizationByCode(code) {
  const result = await medplum.searchResources('Organization', {
    identifier: `${ORG_CODE_SYSTEM}|${code}`,
  });

  return result[0];
}


async function upsertOrganization({
  code,
  name,
  parentId,
  type,
}) {
  const existing = await findOrganizationByCode(code);

  if (existing) {
    console.log(`↪ Organization exists: ${name}`);
    return existing;
  }

  const organization = await medplum.createResource({
    resourceType: 'Organization',

    active: true,

    identifier: [
      {
        system: ORG_CODE_SYSTEM,
        value: code,
      },
    ],

    type: [
      {
        coding: [
          {
            system: ORG_TYPE_SYSTEM,
            code: type,
            display: type,
          },
        ],
      },
    ],

    name,

    ...(parentId && {
      partOf: {
        reference: `Organization/${parentId}`,
      },
    }),
  });

  console.log(`✅ Organization created: ${name}`);

  return organization;
}


// ======================================================
// LOCATION FUNCTIONS
// ======================================================

async function findLocationByCode(code) {
  const result = await medplum.searchResources('Location', {
    identifier: `${LOCATION_CODE_SYSTEM}|${code}`,
  });

  return result[0];
}


async function upsertLocation({
  code,
  name,
  managingOrganizationId,
  parentLocationId,
  physicalTypeCode,
}) {
  const existing = await findLocationByCode(code);

  if (existing) {
    console.log(`↪ Location exists: ${name}`);
    return existing;
  }

  const location = await medplum.createResource({
    resourceType: 'Location',

    status: 'active',

    identifier: [
      {
        system: LOCATION_CODE_SYSTEM,
        value: code,
      },
    ],

    name,

    managingOrganization: {
      reference: `Organization/${managingOrganizationId}`,
    },

    physicalType: {
      coding: [
        {
          system:
            'http://terminology.hl7.org/CodeSystem/location-physical-type',

          code: physicalTypeCode,
        },
      ],
    },

    ...(parentLocationId && {
      partOf: {
        reference: `Location/${parentLocationId}`,
      },
    }),
  });

  console.log(`✅ Location created: ${name}`);

  return location;
}


// ======================================================
// HEALTHCARE GROUP
// ======================================================

console.log('');
console.log('Creating Healthcare Group...');

const group = await upsertOrganization({
  code: 'GROUP-001',
  name: 'EHR Healthcare Group',
  type: 'healthcare-group',
});


// ======================================================
// HOSPITALS
// ======================================================

console.log('');
console.log('Creating Hospitals...');

const hospitalA = await upsertOrganization({
  code: 'HOSP-A',
  name: 'Hospital A',
  type: 'hospital',
  parentId: group.id,
});


const hospitalB = await upsertOrganization({
  code: 'HOSP-B',
  name: 'Hospital B',
  type: 'hospital',
  parentId: group.id,
});


// ======================================================
// HOSPITAL A DEPARTMENTS
// ======================================================

console.log('');
console.log('Creating Hospital A Departments...');

const hospitalADepartments = [
  ['HOSP-A-ED', 'Emergency Department'],
  ['HOSP-A-OPD', 'Outpatient Department'],
  ['HOSP-A-IPD', 'Inpatient Department'],
  ['HOSP-A-ICU', 'Intensive Care Unit'],
  ['HOSP-A-LAB', 'Laboratory'],
  ['HOSP-A-RAD', 'Radiology'],
  ['HOSP-A-PHR', 'Pharmacy'],
  ['HOSP-A-OR', 'Operating Room'],
];


for (const [code, name] of hospitalADepartments) {
  await upsertOrganization({
    code,
    name,
    type: 'department',
    parentId: hospitalA.id,
  });
}


// ======================================================
// HOSPITAL B DEPARTMENTS
// ======================================================

console.log('');
console.log('Creating Hospital B Departments...');

const hospitalBDepartments = [
  ['HOSP-B-ED', 'Emergency Department'],
  ['HOSP-B-OPD', 'Outpatient Department'],
  ['HOSP-B-IPD', 'Inpatient Department'],
  ['HOSP-B-ICU', 'Intensive Care Unit'],
  ['HOSP-B-LAB', 'Laboratory'],
  ['HOSP-B-RAD', 'Radiology'],
  ['HOSP-B-PHR', 'Pharmacy'],
];


for (const [code, name] of hospitalBDepartments) {
  await upsertOrganization({
    code,
    name,
    type: 'department',
    parentId: hospitalB.id,
  });
}


// ======================================================
// HOSPITAL A PHYSICAL LOCATIONS
// ======================================================

console.log('');
console.log('Creating Hospital A Physical Locations...');


// Main Building
const hospitalABuilding = await upsertLocation({
  code: 'HOSP-A-BUILDING-1',

  name: 'Hospital A Main Building',

  managingOrganizationId: hospitalA.id,

  physicalTypeCode: 'bu',
});


// Ground Floor
const hospitalAGroundFloor = await upsertLocation({
  code: 'HOSP-A-FLOOR-G',

  name: 'Hospital A Ground Floor',

  managingOrganizationId: hospitalA.id,

  parentLocationId: hospitalABuilding.id,

  physicalTypeCode: 'lvl',
});


// First Floor
const hospitalAFirstFloor = await upsertLocation({
  code: 'HOSP-A-FLOOR-1',

  name: 'Hospital A First Floor',

  managingOrganizationId: hospitalA.id,

  parentLocationId: hospitalABuilding.id,

  physicalTypeCode: 'lvl',
});


// ======================================================
// EMERGENCY LOCATIONS
// ======================================================

console.log('');
console.log('Creating Emergency Locations...');


await upsertLocation({
  code: 'HOSP-A-ED-RECEPTION',

  name: 'Emergency Reception',

  managingOrganizationId: hospitalA.id,

  parentLocationId: hospitalAGroundFloor.id,

  physicalTypeCode: 'ro',
});


await upsertLocation({
  code: 'HOSP-A-ED-TRIAGE-01',

  name: 'Triage Room 01',

  managingOrganizationId: hospitalA.id,

  parentLocationId: hospitalAGroundFloor.id,

  physicalTypeCode: 'ro',
});


await upsertLocation({
  code: 'HOSP-A-ED-TRIAGE-02',

  name: 'Triage Room 02',

  managingOrganizationId: hospitalA.id,

  parentLocationId: hospitalAGroundFloor.id,

  physicalTypeCode: 'ro',
});


await upsertLocation({
  code: 'HOSP-A-ED-RESUS-01',

  name: 'Resuscitation Room 01',

  managingOrganizationId: hospitalA.id,

  parentLocationId: hospitalAGroundFloor.id,

  physicalTypeCode: 'ro',
});


// ======================================================
// INPATIENT WARD
// ======================================================

console.log('');
console.log('Creating Inpatient Ward...');


const medicalWard = await upsertLocation({
  code: 'HOSP-A-MED-WARD',

  name: 'Medical Ward',

  managingOrganizationId: hospitalA.id,

  parentLocationId: hospitalAFirstFloor.id,

  physicalTypeCode: 'wa',
});


// ======================================================
// ROOM 101
// ======================================================

const room101 = await upsertLocation({
  code: 'HOSP-A-ROOM-101',

  name: 'Room 101',

  managingOrganizationId: hospitalA.id,

  parentLocationId: medicalWard.id,

  physicalTypeCode: 'ro',
});


// ======================================================
// BEDS
// ======================================================

await upsertLocation({
  code: 'HOSP-A-BED-101-A',

  name: 'Bed 101-A',

  managingOrganizationId: hospitalA.id,

  parentLocationId: room101.id,

  physicalTypeCode: 'bd',
});


await upsertLocation({
  code: 'HOSP-A-BED-101-B',

  name: 'Bed 101-B',

  managingOrganizationId: hospitalA.id,

  parentLocationId: room101.id,

  physicalTypeCode: 'bd',
});


// ======================================================
// FINISHED
// ======================================================

console.log('');
console.log('==============================================');
console.log('🎉 Multi-Hospital seed completed successfully');
console.log('==============================================');