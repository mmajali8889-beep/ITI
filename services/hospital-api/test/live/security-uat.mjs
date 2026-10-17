// Security acceptance checks against the running hospital-api, scoped to the
// dedicated UAT hospital (HOSP-01 by default). Non-destructive: it only reads,
// creates role-limited UAT users once (passwords generated here and stored in
// the git-ignored test/live/uat-users.local.json), and sends requests that must
// be refused.
//
// Usage: node test/live/security-uat.mjs
// Env:   HP1_API_URL, HP1_HOSPITAL_CODE (HOSP-01), HP1_FOREIGN_RUN (a live-UAT
//        result JSON from another hospital, used for cross-hospital probes)

import { randomBytes } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const API = process.env.HP1_API_URL ?? 'http://localhost:4000/api';
const HOSPITAL_CODE = process.env.HP1_HOSPITAL_CODE ?? 'HOSP-01';
const USERS_FILE = resolve(here, 'uat-users.local.json');
const ROLES = ['receptionist', 'cashier', 'lab-technician', 'nurse'];
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function record(area, name, ok, detail, severity = 'high') {
  results.push({ area, name, status: ok ? 'PASS' : 'FAIL', severity: ok ? undefined : severity, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  [${area}] ${name}${ok ? '' : `  (${severity})`}${detail && !ok ? `\n        ${detail}` : ''}`);
}

class Actor {
  constructor(name) { this.name = name; this.cookie = ''; }
  async request(method, path, { body, query, headers, raw } = {}) {
    await pause(150);
    const url = new URL(API + path);
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
    const response = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json', ...(this.cookie ? { cookie: this.cookie } : {}), ...headers },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie && setCookie.startsWith('unitech_ehr_session=')) {
      this.cookie = setCookie.split(';')[0];
      this.setCookieHeader = setCookie;
    }
    const text = await response.text();
    let data; try { data = text ? JSON.parse(text) : undefined; } catch { data = text; }
    return { status: response.status, data, headers: response.headers };
  }
  get token() { return this.cookie.split('=')[1]; }
}

const latestRun = (predicate) => readdirSync(here)
  .filter((f) => /^hp1-live-uat-\d+\.json$/.test(f)).sort().reverse()
  .map((f) => JSON.parse(readFileSync(resolve(here, f), 'utf8'))).find(predicate);

async function main() {
  const hospitals = await new Actor('anon').request('GET', '/hospitals');
  const hospital = hospitals.data.find((h) => h.code === HOSPITAL_CODE);
  if (!hospital) throw new Error(`${HOSPITAL_CODE} not found`);
  const H = hospital.id;
  const otherHospital = hospitals.data.find((h) => h.id !== H && h.code === 'HOSP-02') ?? hospitals.data.find((h) => h.id !== H);
  const own = latestRun((r) => r.hospitalCode === HOSPITAL_CODE && r.ids?.patientId);
  const foreign = process.env.HP1_FOREIGN_RUN
    ? JSON.parse(readFileSync(resolve(here, process.env.HP1_FOREIGN_RUN), 'utf8'))
    : latestRun((r) => r.hospitalCode !== HOSPITAL_CODE && r.ids?.patientId);
  if (!own) throw new Error(`run hp1-live-uat.mjs against ${HOSPITAL_CODE} first`);
  console.log(`Security UAT against ${API}, hospital ${HOSPITAL_CODE}${foreign ? `, foreign data from ${foreign.hospitalCode}` : ''}\n`);

  // ---- Admin session and UAT role users ------------------------------------
  const admin = new Actor('admin');
  const adminLogin = await admin.request('POST', '/auth/login', { body: {
    hospitalId: H, username: process.env.DEV_ADMIN_USERNAME ?? 'admin', password: process.env.DEV_ADMIN_PASSWORD ?? 'admin', remember: false,
  } });
  if (adminLogin.status !== 201 && adminLogin.status !== 200) throw new Error(`admin login failed: ${adminLogin.status} ${JSON.stringify(adminLogin.data)}`);

  let users = existsSync(USERS_FILE) ? JSON.parse(readFileSync(USERS_FILE, 'utf8')) : {};
  users = users[H] ? users : { ...users, [H]: {} };
  for (const role of ROLES) {
    if (users[H][role]) continue;
    const suffix = randomBytes(3).toString('hex');
    const password = `Uat-${randomBytes(9).toString('base64url')}9a`;
    const username = `uat-${role}-${suffix}`;
    const created = await admin.request('POST', '/administration/users', { body: {
      hospitalId: H, name: `UAT ${role}`, identifier: `UAT-${role.toUpperCase()}-${suffix}`, username, password, roles: [role], permissions: [],
    } });
    if (created.status >= 300) throw new Error(`creating ${role} user failed: ${created.status} ${JSON.stringify(created.data).slice(0, 300)}`);
    users[H][role] = { username, password };
    writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  }
  const actors = {};
  for (const role of ROLES) {
    const actor = new Actor(role);
    const login = await actor.request('POST', '/auth/login', { body: { hospitalId: H, ...users[H][role], remember: false } });
    if (login.status >= 300) throw new Error(`${role} login failed: ${login.status} ${JSON.stringify(login.data).slice(0, 200)}`);
    actors[role] = actor;
  }
  const pid = own.ids.patientId, eid = own.ids.encounterId;

  // ---- 1. Authentication -----------------------------------------------------
  console.log('Authentication');
  const anon = new Actor('anon');
  for (const [method, path, query] of [
    ['GET', '/patients', { hospitalId: H }], ['GET', `/patients/${pid}`, { hospitalId: H }], ['GET', '/analytics/overview', { hospitalId: H }],
    ['GET', `/patient-portal/${pid}`, { hospitalId: H }], ['POST', '/billing/charges', undefined], ['GET', '/audit/events', { hospitalId: H }],
  ]) {
    const r = await anon.request(method, path, { query, body: method === 'POST' ? { hospitalId: H } : undefined });
    record('authn', `Unauthenticated ${method} ${path.replace(pid, ':patientId')} is refused`, r.status === 401, `got ${r.status}`, 'critical');
  }
  const [payload, signature] = admin.token.split('.');
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
  const forged = Buffer.from(JSON.stringify({ ...claims, hospitalId: otherHospital.id })).toString('base64url');
  for (const [label, token] of [['forged payload (hospital swapped)', `${forged}.${signature}`], ['random token', randomBytes(24).toString('base64url')], ['token with extra segment', `${admin.token}.x`], ['unsigned payload', `${payload}.`]]) {
    const probe = new Actor('probe'); probe.cookie = `unitech_ehr_session=${token}`;
    const r = await probe.request('GET', '/patients', { query: { hospitalId: H } });
    record('authn', `Rejects ${label}`, r.status === 401, `got ${r.status}`, 'critical');
  }
  const expired = Buffer.from(JSON.stringify({ ...claims, expiresAt: Date.now() - 1000 })).toString('base64url');
  { const probe = new Actor('probe'); probe.cookie = `unitech_ehr_session=${expired}.${signature}`;
    const r = await probe.request('GET', '/patients', { query: { hospitalId: H } });
    record('authn', 'Rejects expired claims with reused signature', r.status === 401, `got ${r.status}`, 'critical'); }

  const cookieHeader = admin.setCookieHeader ?? '';
  record('authn', 'Session cookie is HttpOnly', /HttpOnly/i.test(cookieHeader), cookieHeader.replace(/=[^;]+/, '=<redacted>'), 'high');
  record('authn', 'Session cookie is SameSite', /SameSite=(Lax|Strict)/i.test(cookieHeader), cookieHeader.replace(/=[^;]+/, '=<redacted>'), 'medium');

  // Logout must revoke the token.
  { const temp = new Actor('temp');
    await temp.request('POST', '/auth/login', { body: { hospitalId: H, ...users[H].receptionist, remember: false } });
    const token = temp.cookie;
    await temp.request('POST', '/auth/logout');
    const replay = new Actor('replay'); replay.cookie = token;
    const r = await replay.request('GET', '/patients', { query: { hospitalId: H } });
    record('authn', 'Logged-out session token cannot be replayed', r.status === 401, `got ${r.status}`, 'high'); }


  // ---- 2. Hospital isolation -------------------------------------------------
  console.log('\nHospital isolation');
  { const r = await admin.request('GET', '/patients', { query: { hospitalId: otherHospital.id } });
    record('isolation', `Query naming another hospital (${otherHospital.code}) is refused`, r.status === 403, `got ${r.status}`, 'critical'); }
  if (foreign) {
    const fp = foreign.ids.patientId, fe = foreign.ids.encounterId;
    const probes = [
      ['GET', `/patients/${fp}`, { hospitalId: H }], ['GET', `/patients/${fp}`, undefined],
      ['GET', `/encounters/${fe}`, { hospitalId: H }], ['GET', `/encounters/${fe}`, undefined],
      ['GET', `/patient-portal/${fp}`, { hospitalId: H }], ['GET', `/patient-journey/${fp}/encounters/${fe}`, { hospitalId: H }],
      ['GET', `/billing/accounts/${fp}`, { hospitalId: H }], ['GET', `/billing/encounters/${fe}`, { hospitalId: H }],
      ['GET', `/clinical-notes/patient/${fp}`, { hospitalId: H }], ['GET', `/clinical-notes/patient/${fp}`, undefined],
      ['GET', `/laboratory/patient/${fp}`, { hospitalId: H }], ['GET', `/laboratory/patient/${fp}`, undefined],
      ['GET', `/radiology/patient/${fp}`, undefined], ['GET', `/medications/patient/${fp}`, undefined],
      ['GET', `/vitals`, { patientId: fp }], ['GET', `/conditions/patient/${fp}`, undefined],
      ['GET', `/vitals`, { encounterId: fe }], ['GET', `/radiology/encounter/${fe}`, undefined],
      ['GET', `/medications`, { encounterId: fe }], ['GET', `/conditions`, { encounterId: fe, hospitalId: H }],
      ['GET', `/clinical-notes`, { encounterId: fe, hospitalId: H }], ['GET', `/laboratory/encounter/${fe}`, { hospitalId: H }],
      ['GET', `/allergies/patient/${fp}`, undefined], ['GET', `/allergies/patient/${fp}`, { hospitalId: H }],
      ['GET', `/medical-records/encounters/${fe}`, { hospitalId: H }],
    ];
    for (const [method, path, query] of probes) {
      const r = await admin.request(method, path, { query });
      const body = JSON.stringify(r.data ?? '');
      // Leaked = a success response that carries the foreign record's ids or its
      // synthetic patient name (every UAT name contains `Run<runId>`).
      // A success response leaks if it carries any records: a non-empty array of
      // objects, a non-zero total, or the foreign patient's synthetic name. A bare
      // echo of the requested id with empty lists and zero totals is not a leak.
      const hasRecords = (value) => Array.isArray(value)
        ? value.some((item) => item && typeof item === 'object') || value.some(hasRecords)
        : value && typeof value === 'object'
          ? Object.entries(value).some(([key, v]) => (key === 'total' && typeof v === 'number' && v > 0) || hasRecords(v))
          : false;
      const leaked = r.status < 300 && (hasRecords(r.data) || body.includes(`Run${foreign.run}`));
      record('isolation', `${foreign.hospitalCode} record not readable: ${method} ${path.replace(fp, ':foreignPatient').replace(fe, ':foreignEncounter')}${query?.hospitalId ? '?hospitalId=own' : ''}`,
        !leaked, `got ${r.status}: ${body.slice(0, 140)}`, 'critical');
    }
  }

  // ---- 3. Role-based access -------------------------------------------------
  console.log('\nRole-based access');
  const expectations = [
    ['receptionist', 'GET', '/patients', { hospitalId: H }, true],
    ['receptionist', 'POST', '/billing/charges', { hospitalId: H }, false],
    ['receptionist', 'GET', `/laboratory/patient/${pid}`, { hospitalId: H }, false],
    ['receptionist', 'GET', `/clinical-notes/patient/${pid}`, { hospitalId: H }, false],
    ['receptionist', 'GET', '/administration/users', { hospitalId: H }, false],
    ['receptionist', 'GET', '/audit/events', { hospitalId: H }, false],
    ['receptionist', 'GET', '/analytics/overview', { hospitalId: H }, false],
    ['receptionist', 'GET', `/patient-portal/${pid}`, { hospitalId: H }, false],
    ['receptionist', 'POST', '/administration/role-assignments', { hospitalId: H }, false],
    ['cashier', 'GET', `/billing/accounts/${pid}`, { hospitalId: H }, true],
    ['cashier', 'GET', `/laboratory/patient/${pid}`, { hospitalId: H }, false],
    ['cashier', 'POST', '/clinical-notes', { hospitalId: H }, false],
    ['cashier', 'GET', `/patient-journey/${pid}/encounters/${eid}`, { hospitalId: H }, false],
    ['lab-technician', 'GET', `/laboratory/patient/${pid}`, { hospitalId: H }, true],
    ['lab-technician', 'GET', `/billing/accounts/${pid}`, { hospitalId: H }, false],
    ['lab-technician', 'POST', '/pharmacy/dispense', { hospitalId: H }, false],
    ['lab-technician', 'PATCH', `/encounters/${eid}/finish`, { hospitalId: H }, false],
    ['nurse', 'GET', '/administration/overview', { hospitalId: H }, false],
    ['nurse', 'POST', '/billing/invoices', { hospitalId: H }, false],
    ['nurse', 'GET', `/vitals`, { patientId: pid, hospitalId: H }, true],
  ];
  for (const [role, method, path, scope, allowed] of expectations) {
    const isWrite = method !== 'GET';
    const r = await actors[role].request(method, path, { query: isWrite ? undefined : scope, body: isWrite ? scope : undefined });
    const granted = isWrite ? r.status !== 401 && r.status !== 403 : r.status < 300;
    const ok = allowed ? granted : r.status === 403;
    record('rbac', `${role} ${allowed ? 'can' : 'cannot'} ${method} ${path.replace(pid, ':patientId').replace(eid, ':encounterId')}`, ok, `got ${r.status}`, allowed ? 'medium' : 'high');
  }
  { const r = await actors.receptionist.request('POST', '/administration/users', { body: { hospitalId: H, name: 'escalate', identifier: 'X', username: `uat-escalate-${randomBytes(3).toString('hex')}`, password: 'Escalate123', roles: ['system-administrator'], permissions: ['*'] } });
    record('rbac', 'receptionist cannot create a system-administrator', r.status === 403, `got ${r.status}`, 'critical'); }

  // ---- 4. Input handling and transport --------------------------------------
  console.log('\nInput handling and headers');
  for (const search of ['x&_id=1', 'a,b|c', "' OR 1=1 --", '<script>alert(1)</script>', '%00', '../../Project']) {
    const r = await admin.request('GET', '/patients', { query: { hospitalId: H, search } });
    record('input', `Patient search tolerates ${JSON.stringify(search)}`, r.status < 500, `got ${r.status}`, 'medium');
  }
  for (const path of ['/patients/..%2F..%2FProject', '/patients/%2e%2e', `/encounters/${'a'.repeat(300)}`]) {
    const r = await admin.request('GET', path, { query: { hospitalId: H } });
    record('input', `Malformed id ${path.slice(0, 40)} is rejected cleanly`, r.status >= 400 && r.status < 500, `got ${r.status}`, 'medium');
  }
  { const r = await admin.request('POST', '/patients', { raw: true, body: '{"hospitalId":' });
    record('input', 'Malformed JSON gets 400, not 500', r.status === 400, `got ${r.status}`, 'low'); }
  { const big = JSON.stringify({ hospitalId: H, photoBase64: 'A'.repeat(3 * 1024 * 1024) });
    const r = await admin.request('POST', '/patients', { raw: true, body: big });
    record('input', 'Oversized body (3 MB) is refused', r.status === 413 || r.status === 400, `got ${r.status}`, 'medium'); }

  { const r = await anon.request('GET', '/hospitals', { headers: { origin: 'https://evil.example' } });
    const allow = r.headers.get('access-control-allow-origin');
    record('headers', 'CORS does not allow arbitrary origins', allow !== 'https://evil.example' && allow !== '*', `allow-origin=${allow}`, 'high');
    record('headers', 'X-Powered-By is not disclosed', !r.headers.get('x-powered-by'), `x-powered-by=${r.headers.get('x-powered-by')}`, 'low');
    record('headers', 'X-Content-Type-Options: nosniff is set', r.headers.get('x-content-type-options') === 'nosniff', `got ${r.headers.get('x-content-type-options')}`, 'low'); }
  { const r = await anon.request('GET', '/hospitals');
    record('info', 'Hospital list is public (needed before login)', r.status === 200, 'informational', 'low'); }

  // ---- 5. Brute force (last: tripping Medplum's per-address sign-in throttle
  // blocks every further login from this machine for a while) ----------------
  console.log('\nBrute force');
  // A random, nonexistent username: the lockout applies to any name (no account
  // enumeration) and no real test account gets locked.
  { const attacker = new Actor('attacker'); const statuses = []; const probeUser = `uat-bruteforce-${randomBytes(4).toString('hex')}`;
    for (let i = 0; i < 40; i += 1) {
      const r = await attacker.request('POST', '/auth/login', { body: { hospitalId: H, username: probeUser, password: `wrong-${i}`, remember: false } });
      statuses.push(r.status);
      if (r.status === 429 || r.status === 423) break;
    }
    // 423 = the API's per-account lockout; 429 = Medplum's per-address throttle.
    const throttledAt = statuses.findIndex((s) => s === 423 || s === 429);
    record('authn', 'Repeated failed sign-ins are throttled', throttledAt >= 0, `${statuses.length} attempts -> ${[...new Set(statuses)].join(',')}${throttledAt >= 0 ? ` (${statuses[throttledAt]} after ${throttledAt} failures)` : ''}`, 'medium');
    record('authn', 'Lockout/throttling is reported as 423/429, not as a wrong password', throttledAt >= 0, 'throttled sign-ins must not say "invalid username or password"', 'medium'); }

  // ---- Summary -----------------------------------------------------------------
  const fails = results.filter((r) => r.status === 'FAIL');
  const bySeverity = ['critical', 'high', 'medium', 'low'].map((s) => `${fails.filter((f) => f.severity === s).length} ${s}`).join(', ');
  console.log(`\n${results.length - fails.length} PASS, ${fails.length} FAIL (${bySeverity})`);
  const out = resolve(here, `security-uat-${new Date().toISOString().replace(/\D/g, '').slice(2, 14)}.json`);
  writeFileSync(out, JSON.stringify({ api: API, hospitalCode: HOSPITAL_CODE, results }, null, 2));
  console.log(`Results written to ${out}`);
  process.exitCode = fails.some((f) => f.severity === 'critical') ? 1 : 0;
}

main().catch((error) => { console.error(error); process.exitCode = 2; });
