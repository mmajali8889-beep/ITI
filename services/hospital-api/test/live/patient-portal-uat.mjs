// Patient portal acceptance (roadmap 27.2) against the running hospital-api,
// scoped to the UAT hospital (HOSP-01 by default). A real patient login signs
// in, sees its own portal, and is refused everything else. Non-destructive: it
// only reads, and creates one portal login once (linked to the UAT patient,
// password generated here and stored in the git-ignored uat-users.local.json).
//
// Usage: node --env-file=.env test/live/patient-portal-uat.mjs
// Env:   HP1_API_URL, HP1_HOSPITAL_CODE (HOSP-01); from .env: MEDPLUM_BASE_URL,
//        MEDPLUM_CLIENT_ID/SECRET, MEDPLUM_PROVISIONING_EMAIL/PASSWORD,
//        DEV_ADMIN_USERNAME/PASSWORD

import { randomBytes } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MedplumClient } from '@medplum/core';

const here = dirname(fileURLToPath(import.meta.url));
const API = process.env.HP1_API_URL ?? 'http://localhost:4000/api';
const HOSPITAL_CODE = process.env.HP1_HOSPITAL_CODE ?? 'HOSP-01';
const USERS_FILE = resolve(here, 'uat-users.local.json');
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function record(area, name, ok, detail, severity = 'high') {
  results.push({ area, name, status: ok ? 'PASS' : 'FAIL', severity: ok ? undefined : severity, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  [${area}] ${name}${ok ? '' : `  (${severity})`}${detail && !ok ? `\n        ${detail}` : ''}`);
}

class Actor {
  constructor() { this.cookie = ''; }
  async request(method, path, { body, query } = {}) {
    await pause(50);
    const url = new URL(API + path);
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
    const response = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json', ...(this.cookie ? { cookie: this.cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie?.startsWith('unitech_ehr_session=')) this.cookie = setCookie.split(';')[0];
    const text = await response.text();
    let data; try { data = text ? JSON.parse(text) : undefined; } catch { data = text; }
    return { status: response.status, data };
  }
}

const latestRun = (predicate) => readdirSync(here)
  .filter((f) => /^hp1-live-uat-\d+\.json$/.test(f)).sort().reverse()
  .map((f) => JSON.parse(readFileSync(resolve(here, f), 'utf8'))).find(predicate);

/** Every route the API declares, from its controllers. */
function apiRoutes() {
  const routes = [];
  const walk = (dir) => readdirSync(dir).forEach((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return walk(p);
    if (!f.endsWith('.controller.ts')) return;
    const source = readFileSync(p, 'utf8');
    const prefix = source.match(/@Controller\('([^']*)'\)/)?.[1] ?? '';
    for (const m of source.matchAll(/@(Get|Post|Patch|Put|Delete)\(\s*(?:'([^']*)')?\s*\)/g)) {
      routes.push([m[1].toUpperCase(), `/${prefix}/${m[2] ?? ''}`.replace(/\/+/g, '/').replace(/\/$/, '')]);
    }
  });
  walk(resolve(here, '../../src'));
  return routes;
}

/** Links a Medplum login to an existing patient, as the hospital would. */
async function provisionPortalLogin(patientId) {
  const service = new MedplumClient({ baseUrl: process.env.MEDPLUM_BASE_URL });
  await service.startClientLogin(process.env.MEDPLUM_CLIENT_ID, process.env.MEDPLUM_CLIENT_SECRET);
  const projectId = service.getProject()?.id;
  const provisioning = new MedplumClient({ baseUrl: process.env.MEDPLUM_BASE_URL });
  const login = await provisioning.startLogin({
    email: process.env.MEDPLUM_PROVISIONING_EMAIL, password: process.env.MEDPLUM_PROVISIONING_PASSWORD, scope: 'openid profile',
  });
  await provisioning.processCode(login.code);
  const email = `uat-portal-${randomBytes(3).toString('hex')}@unitech.local`;
  const password = `Uat-${randomBytes(12).toString('base64url')}9a`;
  const membership = await provisioning.invite(projectId, {
    resourceType: 'Patient', firstName: 'UAT', lastName: 'Portal', email, password, sendEmail: false,
    membership: { profile: { reference: `Patient/${patientId}` } },
  });
  if (!membership.accessPolicy) console.log('  NOTE  the project has no default patient access policy');
  return { username: email, password, patientId };
}

async function main() {
  const hospitals = (await new Actor().request('GET', '/hospitals')).data;
  const hospital = hospitals.find((h) => h.code === HOSPITAL_CODE);
  if (!hospital) throw new Error(`${HOSPITAL_CODE} not found`);
  const H = hospital.id;
  const otherHospital = hospitals.find((h) => h.id !== H && h.signInEnabled) ?? hospitals.find((h) => h.id !== H);
  const own = latestRun((r) => r.hospitalCode === HOSPITAL_CODE && r.ids?.patientId);
  if (!own) throw new Error(`run hp1-live-uat.mjs against ${HOSPITAL_CODE} first`);
  console.log(`Patient portal UAT against ${API}, hospital ${HOSPITAL_CODE}\n`);

  const admin = new Actor();
  const adminLogin = await admin.request('POST', '/auth/login', { body: {
    hospitalId: H, username: process.env.DEV_ADMIN_USERNAME ?? 'admin', password: process.env.DEV_ADMIN_PASSWORD ?? 'admin',
  } });
  if (adminLogin.status >= 300) throw new Error(`admin login failed: ${adminLogin.status}`);
  const pid = own.ids.patientId;
  const others = (await admin.request('GET', '/patients', { query: { hospitalId: H } })).data?.patients ?? [];
  const otherPatient = others.find((p) => p.id !== pid)?.id;

  let users = existsSync(USERS_FILE) ? JSON.parse(readFileSync(USERS_FILE, 'utf8')) : {};
  users[H] ??= {};
  if (users[H].patient?.patientId !== pid) {
    users[H].patient = await provisionPortalLogin(pid);
    writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  }
  const credentials = { username: users[H].patient.username, password: users[H].patient.password };

  // ---- 1. Sign-in --------------------------------------------------------------
  console.log('Sign-in');
  const patient = new Actor();
  const login = await patient.request('POST', '/auth/login', { body: { hospitalId: H, ...credentials } });
  record('signin', 'Patient signs in to their hospital', login.status === 201, `got ${login.status} ${JSON.stringify(login.data).slice(0, 160)}`, 'critical');
  if (login.status !== 201) return;
  record('signin', 'Session is a Patient session for the linked record', login.data.user?.resourceType === 'Patient' && login.data.user?.id === pid,
    JSON.stringify(login.data.user).slice(0, 160), 'critical');
  record('signin', 'Patient session has no staff roles or permissions',
    !login.data.user?.roles?.length && !login.data.user?.permissions?.length, JSON.stringify(login.data.user?.permissions), 'critical');
  { const r = await new Actor().request('POST', '/auth/login', { body: { hospitalId: otherHospital.id, ...credentials } });
    record('signin', `Patient cannot sign in to another hospital (${otherHospital.code})`, r.status === 401, `got ${r.status}`, 'critical'); }

  // ---- 2. Own portal -------------------------------------------------------------
  console.log('\nOwn portal');
  const portal = await patient.request('GET', `/patient-portal/${pid}`, { query: { hospitalId: H } });
  record('portal', 'Own portal loads', portal.status === 200, `got ${portal.status}`, 'critical');
  record('portal', 'Portal shows the signed-in patient', portal.data?.patient?.id === pid, JSON.stringify(portal.data?.patient ?? {}).slice(0, 120));
  record('portal', 'Portal is scoped to this hospital', portal.data?.hospitalId === H, `hospitalId ${portal.data?.hospitalId}`);

  // ---- 3. Everything else is refused ---------------------------------------------
  console.log('\nBoundaries');
  if (otherPatient) {
    const r = await patient.request('GET', `/patient-portal/${otherPatient}`, { query: { hospitalId: H } });
    record('boundary', "Another patient's portal is refused", r.status === 403 || r.status === 404, `got ${r.status}`, 'critical');
  }
  { const r = await patient.request('GET', `/patient-portal/${pid}`, { query: { hospitalId: otherHospital.id } });
    record('boundary', 'Own portal under another hospital is refused', r.status === 403, `got ${r.status}`, 'critical'); }
  const allowed = new Set(['/api/auth/session', '/api/patient-portal/:patientId', '/api/hospitals', '/api/health', '/api/health/live', '']);
  const leaks = [];
  let swept = 0;
  for (const [method, route] of apiRoutes()) {
    if (route.startsWith('/api/auth/') && method !== 'GET') continue; // login and logout
    const path = route.replace(/^\/api/, '').replace(/:patientId/g, pid).replace(/:hospitalId/g, H)
      .replace(/:[A-Za-z]+/g, '00000000-0000-4000-8000-000000000000');
    const r = await patient.request(method, path, {
      query: { hospitalId: H, patientId: pid },
      body: method === 'GET' ? undefined : { hospitalId: H, patientId: pid },
    });
    swept++;
    if (r.status < 400 && !allowed.has(route)) leaks.push(`${r.status} ${method} ${route}`);
  }
  record('boundary', `No staff endpoint answers a patient session (${swept} routes, own ids)`, leaks.length === 0, leaks.join('; '), 'critical');

  // ---- 4. Sign-out -------------------------------------------------------------------
  console.log('\nSign-out');
  const token = patient.cookie;
  await patient.request('POST', '/auth/logout');
  const replay = new Actor(); replay.cookie = token;
  const r = await replay.request('GET', `/patient-portal/${pid}`, { query: { hospitalId: H } });
  record('signout', 'Signed-out patient session cannot be replayed', r.status === 401, `got ${r.status}`, 'high');
}

main()
  .catch((error) => record('run', 'Script completed', false, String(error?.stack ?? error), 'critical'))
  .finally(() => {
    const stamp = new Date().toISOString().replace(/\D/g, '').slice(2, 14);
    const out = resolve(here, `patient-portal-uat-${stamp}.json`);
    writeFileSync(out, JSON.stringify({ api: API, hospitalCode: HOSPITAL_CODE, results }, null, 2));
    const failed = results.filter((x) => x.status === 'FAIL').length;
    console.log(`\n${results.length - failed}/${results.length} passed. Results: ${out}`);
    process.exitCode = failed ? 1 : 0;
  });
