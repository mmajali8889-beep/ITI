// Seeds a TRAINING environment (roadmap 30.3) with role accounts and fictional
// patients, so staff can practise without touching real records.
//
//   node --env-file=<training.env> scripts/seed-training.mjs --training-environment
//
// Env:
//   TRAINING_API_URL        e.g. https://training.localhost:8449 (the training EHR address)
//   TRAINING_HOSPITAL_CODE  hospital to train on (default HOSP-01)
//   TRAINING_ACCOUNTS_FILE  where to write the account sheet for trainers
//                           (outside the repository; it holds the shared password)
//   TRAINING_INSECURE_TLS   "1" to accept the training proxy's internal CA
//   MEDPLUM_BASE_URL        the training Medplum, as reached from this machine
//   MEDPLUM_CLIENT_ID / MEDPLUM_CLIENT_SECRET              the API's ClientApplication
//   MEDPLUM_PROVISIONING_EMAIL / MEDPLUM_PROVISIONING_PASSWORD  to create the first admin
//
// Safe to re-run: existing accounts, patients and appointments are kept. All
// training accounts share one password, generated on the first run and kept in
// the account sheet. Never run it against production.
import { randomInt } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { MedplumClient } from '@medplum/core';

if (!process.argv.includes('--training-environment')) {
  console.error('Refusing to run: this creates training accounts and fictional patients.\n' +
    'Pass --training-environment to confirm the target is a training environment.');
  process.exit(2);
}
const need = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const API = need('TRAINING_API_URL').replace(/\/+$/, '');
const HOSPITAL_CODE = process.env.TRAINING_HOSPITAL_CODE ?? 'HOSP-01';
const ACCOUNTS_FILE = need('TRAINING_ACCOUNTS_FILE');
const INSECURE = process.env.TRAINING_INSECURE_TLS === '1';

const BASE = 'https://hospital-ehr.local/fhir/StructureDefinition';
const HOSPITAL_EXT = `${BASE}/admin-hospital`;
const KIND_EXT = `${BASE}/admin-kind`;
const PERMISSIONS_EXT = `${BASE}/rbac-permissions`;
const ROLE_SYSTEM = 'https://hospital-ehr.local/CodeSystem/security-role';
const ORG_CODE_SYSTEM = 'https://hospital-ehr.local/organization-code';

// One account per job role (codes as in the API's default roles).
const ROLES = [
  ['receptionist', 'Reception'],
  ['nurse', 'Nurse'],
  ['doctor', 'Doctor'],
  ['consultant', 'Consultant'],
  ['lab-technician', 'Laboratory Technician'],
  ['lab-supervisor', 'Laboratory Supervisor'],
  ['radiology-technician', 'Radiology Technician'],
  ['radiologist', 'Radiologist'],
  ['pharmacist', 'Pharmacist'],
  ['cashier', 'Cashier'],
  ['insurance-officer', 'Insurance Officer'],
  ['medical-records', 'Medical Records'],
  ['supply-chain-officer', 'Supply Chain'],
  ['administrator', 'Administrator'],
];

// Fictional patients for the exercises. National IDs start with 999 so they
// can never match a real person.
const PATIENTS = [
  { key: 'A', nationalId: '9990000101', firstNameAr: 'سارة', familyNameAr: 'التدريب', firstNameEn: 'Sara', familyNameEn: 'Training', gender: 'female', birthDate: '1988-04-12', phone: '0790000101', scenario: 'Outpatient visit with lab and radiology, cash payment' },
  { key: 'B', nationalId: '9990000102', firstNameAr: 'خالد', familyNameAr: 'التدريب', firstNameEn: 'Khaled', familyNameEn: 'Training', gender: 'male', birthDate: '1975-09-30', phone: '0790000102', scenario: 'Insured outpatient: eligibility, claim and adjudication', insured: true },
  { key: 'C', nationalId: '9990000103', firstNameAr: 'ليلى', familyNameAr: 'التدريب', firstNameEn: 'Layla', familyNameEn: 'Training', gender: 'female', birthDate: '2016-02-03', phone: '0790000103', scenario: 'Child with a penicillin allergy: allergy alerts when prescribing', allergy: true },
  { key: 'D', nationalId: '9990000104', firstNameAr: 'يوسف', familyNameAr: 'التدريب', firstNameEn: 'Yousef', familyNameEn: 'Training', gender: 'male', birthDate: '1952-11-21', phone: '0790000104', scenario: 'Emergency arrival, triage, then admission to a ward bed' },
  { key: 'E', nationalId: '9990000105', firstNameAr: 'منى', familyNameAr: 'التدريب', firstNameEn: 'Mona', familyNameEn: 'Training', gender: 'female', birthDate: '1995-07-08', phone: '0790000105', scenario: 'Pharmacy: verify and dispense a prescription' },
  { key: 'F', nationalId: '9990000106', firstNameAr: 'عمر', familyNameAr: 'التدريب', firstNameEn: 'Omar', familyNameEn: 'Training', gender: 'male', birthDate: '1983-01-17', phone: '0790000106', scenario: 'Medical records: deficiency, close, lock and amend' },
  { key: 'G', nationalId: '9990000107', firstNameAr: 'هدى', familyNameAr: 'التدريب', firstNameEn: 'Huda', familyNameEn: 'Training', gender: 'female', birthDate: '1990-05-25', phone: '0790000107', scenario: 'Patient portal: create a login and sign in as the patient', portal: true },
  { key: 'H', nationalId: '9990000108', firstNameAr: 'سامي', familyNameAr: 'التدريب', firstNameEn: 'Sami', familyNameEn: 'Training', gender: 'male', birthDate: '1968-12-02', phone: '0790000108', scenario: 'Booked appointment: check in at reception' },
];

const strongPassword = () => {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ', lower = 'abcdefghijkmnpqrstuvwxyz', digits = '23456789';
  const all = upper + lower + digits;
  const pick = (set) => set[randomInt(set.length)];
  const chars = [pick(upper), pick(lower), pick(digits)];
  for (let i = 0; i < 9; i++) chars.push(pick(all));
  return chars.sort(() => randomInt(3) - 1).join('');
};

// ---- HTTP to the training API (cookie session) --------------------------------
// *.localhost names are loopback; Node on Windows does not resolve them itself.
function request(cookie, method, path, { body, query } = {}) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const client = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.request({
      hostname: url.hostname, port: url.port, path: url.pathname + url.search, method,
      rejectUnauthorized: !INSECURE,
      ...(url.hostname.endsWith('.localhost') && {
        lookup: (h, o, cb) => (o?.all ? cb(null, [{ address: '127.0.0.1', family: 4 }]) : cb(null, '127.0.0.1', 4)),
      }),
      headers: {
        'content-type': 'application/json',
        ...(cookie ? { cookie } : {}),
        ...(payload ? { 'content-length': Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (text += chunk));
      res.on('end', () => {
        let data;
        try { data = text ? JSON.parse(text) : undefined; } catch { data = text; }
        const set = [].concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith('unitech_ehr_session='));
        resolve({ status: res.statusCode, data, cookie: set?.split(';')[0] });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
const must = (r, what) => {
  if (r.status >= 300) throw new Error(`${what}: HTTP ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
  return r.data;
};

// ---- Account sheet (shared password survives re-runs) ---------------------------
let password = strongPassword();
if (existsSync(ACCOUNTS_FILE)) {
  const kept = /^Password: `([^`]+)`/m.exec(readFileSync(ACCOUNTS_FILE, 'utf8'))?.[1];
  if (kept) password = kept;
}

// ---- 1. Training administrator, created in Medplum (the API has none yet) -------
const hospitals = must(await request(null, 'GET', '/api/hospitals'), 'hospitals');
const hospital = hospitals.find((h) => h.code === HOSPITAL_CODE);
if (!hospital) throw new Error(`${HOSPITAL_CODE} not found at ${API}`);
if (!hospital.signInEnabled) throw new Error(`${HOSPITAL_CODE} is not enabled for sign-in (ENABLED_HOSPITAL_CODES)`);
const H = hospital.id;
console.log(`Training environment ${API}, hospital ${HOSPITAL_CODE} (${hospital.name})`);

const service = new MedplumClient({ baseUrl: need('MEDPLUM_BASE_URL') });
await service.startClientLogin(need('MEDPLUM_CLIENT_ID'), need('MEDPLUM_CLIENT_SECRET'));
const projectId = service.getProject()?.id;
const [org] = await service.searchResources('Organization', { identifier: `${ORG_CODE_SYSTEM}|${HOSPITAL_CODE}` });
if (!org || org.id !== H) throw new Error('The API and MEDPLUM_BASE_URL do not point at the same environment');

const ADMIN_EMAIL = 'train.admin@unitech.local';
const [existingAdmin] = await service.searchResources('Practitioner', { email: ADMIN_EMAIL });
if (existingAdmin) {
  console.log('  kept     train.admin');
} else {
  const provisioning = new MedplumClient({ baseUrl: need('MEDPLUM_BASE_URL') });
  const login = await provisioning.startLogin({
    email: need('MEDPLUM_PROVISIONING_EMAIL'), password: need('MEDPLUM_PROVISIONING_PASSWORD'), scope: 'openid profile',
  });
  await provisioning.processCode(login.code);
  const membership = await provisioning.invite(projectId, {
    resourceType: 'Practitioner', firstName: 'Training', lastName: 'System Administrator',
    email: ADMIN_EMAIL, password, sendEmail: false, membership: { admin: true },
  });
  const practitionerId = membership.profile.reference.split('/')[1];
  const practitioner = await service.readResource('Practitioner', practitionerId);
  await service.updateResource({
    ...practitioner,
    active: true,
    identifier: [{ system: `https://hospital-ehr.local/practitioner/${H}`, value: 'TRN-ADMIN' }],
    name: [{ text: 'Training System Administrator', family: 'System Administrator', given: ['Training'] }],
    telecom: [{ system: 'email', value: ADMIN_EMAIL, use: 'work' }],
    extension: [
      { url: HOSPITAL_EXT, valueReference: { reference: `Organization/${H}` } },
      { url: KIND_EXT, valueCode: 'practitioners' },
    ],
  });
  await service.createResource({
    resourceType: 'PractitionerRole',
    active: true,
    practitioner: { reference: `Practitioner/${practitionerId}`, display: 'Training System Administrator' },
    organization: { reference: `Organization/${H}` },
    code: [{ coding: [{ system: ROLE_SYSTEM, code: 'system-administrator', display: 'System Administrator' }] }],
    extension: [
      { url: HOSPITAL_EXT, valueReference: { reference: `Organization/${H}` } },
      { url: PERMISSIONS_EXT, valueString: JSON.stringify(['*']) },
    ],
  });
  console.log('  created  train.admin');
}

const adminLogin = await request(null, 'POST', '/api/auth/login', { body: { hospitalId: H, username: 'train.admin', password } });
if (adminLogin.status !== 201)
  throw new Error(`train.admin cannot sign in (HTTP ${adminLogin.status}); if the account sheet was lost, reset its password in Medplum`);
const admin = adminLogin.cookie;

// ---- 2. One account per role, through the API -----------------------------------
const existingUsers = must(await request(admin, 'GET', '/api/administration/users', { query: { hospitalId: H } }), 'users').items;
const accounts = [{ username: 'train.admin', role: 'system-administrator', label: 'System Administrator' }];
let doctor;
for (const [role, label] of ROLES) {
  const username = `train.${role.replace(/-/g, '.')}`;
  let user = existingUsers.find((u) => u.username === username);
  if (user) {
    console.log(`  kept     ${username}`);
  } else {
    user = must(await request(admin, 'POST', '/api/administration/users', {
      body: {
        hospitalId: H, name: `Training ${label}`, identifier: `TRN-${role.toUpperCase()}`,
        username, password, roles: [role], permissions: [],
      },
    }), `create ${username}`);
    console.log(`  created  ${username}`);
  }
  if (role === 'doctor') doctor = user;
  accounts.push({ username, role, label });
}

// ---- 3. Fictional patients ------------------------------------------------------
const patients = [];
for (const p of PATIENTS) {
  const found = must(await request(admin, 'GET', '/api/patients', { query: { hospitalId: H, nationalId: p.nationalId } }), 'search');
  let patient = (found.patients ?? found.items ?? found)[0];
  if (patient) {
    console.log(`  kept     patient ${p.key} ${p.firstNameEn}`);
  } else {
    const created = must(await request(admin, 'POST', '/api/patients', {
      body: {
        hospitalId: H, hospitalCode: HOSPITAL_CODE,
        nationalId: p.nationalId, firstNameAr: p.firstNameAr, familyNameAr: p.familyNameAr,
        firstNameEn: p.firstNameEn, familyNameEn: p.familyNameEn, gender: p.gender, birthDate: p.birthDate,
        phone: p.phone, preferredLanguage: 'ar', city: 'Training City', country: 'Training',
        ...(p.allergy && { knownAllergies: [{ substance: 'Penicillin', criticality: 'high', reaction: 'Rash and wheeze' }] }),
        registrationConfirmed: true,
      },
    }), `register ${p.firstNameEn}`);
    patient = created.patient ?? created;
    console.log(`  created  patient ${p.key} ${p.firstNameEn}`);
  }
  patients.push({ ...p, id: patient.id, mrn: patient.hospitalMrn ?? patient.mrn });
}

// ---- 4. Appointments for tomorrow (reception check-in practice) ----------------
const tomorrow = new Date(Date.now() + 24 * 3600_000);
const at = (hour) => new Date(Date.UTC(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth(), tomorrow.getUTCDate(), hour - 3, 0)).toISOString();
const existingAppointments = must(await request(admin, 'GET', '/api/appointments', { query: { hospitalId: H } }), 'appointments');
const booked = (existingAppointments.items ?? existingAppointments.appointments ?? existingAppointments ?? []);
for (const [key, hour] of [['H', 9], ['A', 10], ['B', 11]]) {
  const p = patients.find((x) => x.key === key);
  if (booked.some((a) => a.patientId === p.id && a.status !== 'cancelled')) {
    console.log(`  kept     appointment for ${p.firstNameEn}`);
    continue;
  }
  const r = await request(admin, 'POST', '/api/appointments', {
    body: {
      hospitalId: H, patientId: p.id, practitionerId: doctor?.id, practitionerName: 'Training Doctor',
      department: 'Outpatient Department', serviceType: 'Consultation', reason: p.scenario,
      start: at(hour), durationMinutes: 20, priority: 'routine',
    },
  });
  console.log(`  ${r.status < 300 ? 'created ' : 'skipped '} appointment for ${p.firstNameEn}${r.status < 300 ? '' : ` (HTTP ${r.status})`}`);
}

// ---- 5. Account sheet for trainers ------------------------------------------------
const sheet = `# UNITECH-EHR training environment

Address: ${API}
Hospital: ${HOSPITAL_CODE} (${hospital.name})
Password: \`${password}\`

Every training account uses this password. Fictional data only: never enter a
real patient here, and never use these accounts anywhere else.

## Accounts

| Username | Role |
|---|---|
${accounts.map((a) => `| \`${a.username}\` | ${a.label} |`).join('\n')}

## Patients for the exercises

| | Patient | National ID | MRN | Exercise |
|---|---|---|---|---|
${patients.map((p) => `| ${p.key} | ${p.firstNameEn} ${p.familyNameEn} (${p.firstNameAr} ${p.familyNameAr}) | ${p.nationalId} | ${p.mrn ?? ''} | ${p.scenario} |`).join('\n')}

Generated ${new Date().toISOString()} by services/hospital-api/scripts/seed-training.mjs.
`;
writeFileSync(ACCOUNTS_FILE, sheet);
await request(admin, 'POST', '/api/auth/logout');
console.log(`\nDone. Account sheet: ${ACCOUNTS_FILE} (holds the shared training password).`);
