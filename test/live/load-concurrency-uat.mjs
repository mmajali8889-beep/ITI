// Concurrency and performance acceptance against the running hospital-api,
// scoped to the UAT hospital (HOSP-01). Creates synthetic UAT patients only.
//
// Concurrency: races the same operation in parallel and checks the invariant
// still holds (unique MRNs, no double payment / bed / adjudication / visit).
// Performance: measures read latency under modest parallel load, kept below
// Medplum's per-minute rate limit.
//
// Usage: node test/live/load-concurrency-uat.mjs
// Env:   HP1_API_URL, HP1_HOSPITAL_CODE (HOSP-01), HP1_LOAD_REQUESTS (120), HP1_LOAD_CONCURRENCY (6)

import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const API = process.env.HP1_API_URL ?? 'http://localhost:4000/api';
const HOSPITAL_CODE = process.env.HP1_HOSPITAL_CODE ?? 'HOSP-01';
const LOAD_REQUESTS = Number(process.env.HP1_LOAD_REQUESTS ?? 120);
const LOAD_CONCURRENCY = Number(process.env.HP1_LOAD_CONCURRENCY ?? 6);
const RUN = new Date().toISOString().replace(/\D/g, '').slice(2, 14);
const DOCTOR = 'UAT Doctor';
let cookie = '';
let H = '';
let seq = 0;
const results = [];
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, path, body, query) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
  const started = performance.now();
  const response = await fetch(url, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const ms = performance.now() - started;
  const setCookie = response.headers.get('set-cookie');
  if (setCookie?.startsWith('unitech_ehr_session=')) cookie = setCookie.split(';')[0];
  const text = await response.text();
  let data; try { data = text ? JSON.parse(text) : undefined; } catch { data = text; }
  return { status: response.status, data, ms };
}
async function ok(method, path, body, query) {
  await pause(120);
  const r = await call(method, path, body, query);
  if (r.status >= 300) throw new Error(`${method} ${path} -> ${r.status}: ${JSON.stringify(r.data?.message ?? r.data).slice(0, 200)}`);
  return r.data;
}
const idOf = (d, ...keys) => { for (const k of keys) { const v = d?.[k]; if (typeof v === 'string') return v.replace(/^[A-Za-z]+\//, ''); if (v?.id) return v.id; } return d?.id; };
function record(area, name, pass, detail, severity = 'high') {
  results.push({ area, name, status: pass ? 'PASS' : 'FAIL', severity: pass ? undefined : severity, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  [${area}] ${name}${detail ? `\n        ${detail}` : ''}`);
}

async function registerPatient() {
  seq += 1;
  const tag = String(seq).padStart(2, '0');
  const created = await ok('POST', '/patients', {
    hospitalId: H, hospitalCode: HOSPITAL_CODE, firstNameAr: 'مريض', familyNameAr: 'اختبار الحمل', firstNameEn: `UAT-LOAD-${tag}`, familyNameEn: `Run${RUN}`,
    gender: 'female', birthDate: '1985-05-05', nationalId: `3${RUN.slice(-7)}${tag}`, phone: `07${RUN.slice(-6)}${tag}`, preferredLanguage: 'ar', registrationConfirmed: true,
  });
  return { id: idOf(created, 'patient', 'patientId'), mrn: created.hospitalMrn ?? created.patient?.hospitalMrn };
}
const openEncounter = async (patientId, extra = {}) => idOf(await ok('POST', '/encounters', {
  patientId, hospitalId: H, encounterType: 'outpatient', department: 'General Medicine', practitionerName: DOCTOR, reason: 'UAT load test',
  priority: 'routine', arrivalMode: 'walk-in', registrationConfirmed: true, financialClass: 'cash', ...extra,
}), 'encounter', 'encounterId');

function percentile(values, p) { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]; }

async function main() {
  const hospitals = (await call('GET', '/hospitals')).data;
  H = hospitals.find((h) => h.code === HOSPITAL_CODE)?.id;
  if (!H) throw new Error(`${HOSPITAL_CODE} not found`);
  await ok('POST', '/auth/login', { hospitalId: H, username: process.env.DEV_ADMIN_USERNAME ?? 'admin', password: process.env.DEV_ADMIN_PASSWORD ?? 'admin', remember: false });
  console.log(`Concurrency and load UAT ${RUN} against ${API}, ${HOSPITAL_CODE}\n\nConcurrency`);

  // 1. MRN allocation under parallel registration.
  { const settled = await Promise.allSettled(Array.from({ length: 8 }, () => registerPatient()));
    const created = settled.filter((s) => s.status === 'fulfilled').map((s) => s.value);
    const errors = settled.filter((s) => s.status === 'rejected').map((s) => s.reason.message);
    const mrns = created.map((p) => p.mrn).filter(Boolean);
    record('concurrency', '8 parallel registrations all succeed', created.length === 8, errors[0], 'high');
    record('concurrency', 'Parallel registrations get unique MRNs', new Set(mrns).size === mrns.length && mrns.length === created.length,
      `${mrns.length} MRNs, ${new Set(mrns).size} unique${mrns.length < created.length ? ' (MRN missing from response)' : ''}`, 'critical'); }

  // 2. One active visit per patient.
  { const patient = await registerPatient();
    const settled = await Promise.all(Array.from({ length: 4 }, () => call('POST', '/encounters', {
      patientId: patient.id, hospitalId: H, encounterType: 'outpatient', department: 'General Medicine', reason: 'UAT race', practitionerName: DOCTOR, priority: 'routine', arrivalMode: 'walk-in', registrationConfirmed: true, financialClass: 'cash',
    })));
    const okCount = settled.filter((r) => r.status < 300).length;
    record('concurrency', '4 parallel visit openings for one patient create exactly one', okCount === 1, `${okCount} succeeded; statuses ${settled.map((r) => r.status).join(',')}`, 'high'); }

  // 3. Double payment on one invoice.
  { const patient = await registerPatient();
    const encounterId = await openEncounter(patient.id);
    await ok('POST', '/billing/charges', { hospitalId: H, patientId: patient.id, encounterId, code: 'UAT-CONSULT', description: 'UAT consultation', quantity: 1, unitPrice: 250, currency: 'SAR' });
    const invoice = await ok('POST', '/billing/invoices', { hospitalId: H, patientId: patient.id, encounterId });
    const invoiceId = idOf(invoice, 'invoice'); const due = (invoice.invoice ?? invoice).balance ?? (invoice.invoice ?? invoice).total;
    const settled = await Promise.all(Array.from({ length: 3 }, (_, i) => call('POST', `/billing/invoices/${invoiceId}/payments`, { hospitalId: H, amount: due, currency: 'SAR', method: 'cash', reference: `UAT-DUP-${RUN}-${i}` })));
    const accepted = settled.filter((r) => r.status < 300).length;
    const account = await ok('GET', `/billing/encounters/${encounterId}`, undefined, { hospitalId: H });
    const paid = JSON.stringify(account).match(/"paid":\s*([\d.]+)/)?.[1];
    record('concurrency', '3 parallel full payments on one invoice accept only one', accepted === 1 && Number(paid) <= due,
      `${accepted} accepted (statuses ${settled.map((r) => r.status).join(',')}); paid=${paid} of ${due}`, 'critical'); }

  // 4. Two patients racing for one bed.
  { const bedId = idOf(await ok('POST', '/inpatient/beds', { hospitalId: H, floorCode: 'UAT-F9', floorName: 'UAT Load Floor', wardCode: 'UAT-W9', wardName: 'UAT Load Ward', roomNumber: 'L1', bedCode: `UAT-${RUN}-LB` }), 'bed', 'location');
    const admissions = [];
    for (let i = 0; i < 2; i += 1) {
      const patient = await registerPatient();
      const encounterId = await openEncounter(patient.id, { encounterType: 'inpatient' });
      const requestId = idOf(await ok('POST', '/inpatient/admission-requests', { hospitalId: H, patientId: patient.id, encounterId, acuity: 'urgent', admissionReason: 'UAT load', requestingPhysicianName: DOCTOR }), 'request', 'admissionRequest');
      await ok('POST', `/inpatient/admission-requests/${requestId}/review`, { hospitalId: H, decision: 'approved', admissionOfficerName: 'UAT Admission' });
      await ok('POST', `/inpatient/admission-requests/${requestId}/authorization`, { hospitalId: H, status: 'not-required', authorizedBy: 'UAT Admission' });
      await ok('POST', `/inpatient/admission-requests/${requestId}/bed-request`, { hospitalId: H, preferredWard: 'UAT-W9' });
      admissions.push({ hospitalId: H, encounterId, patientId: patient.id, bedId, admissionReason: 'UAT load', admissionRequestId: requestId });
    }
    const settled = await Promise.all(admissions.map((a) => call('POST', '/inpatient/admit', a)));
    const accepted = settled.filter((r) => r.status < 300).length;
    record('concurrency', 'Two parallel admissions to one bed accept only one', accepted === 1, `${accepted} accepted (statuses ${settled.map((r) => r.status).join(',')})`, 'critical'); }

  // 5. Double claim adjudication.
  { const patient = await registerPatient();
    const encounterId = await openEncounter(patient.id, { financialClass: 'insurance' });
    const coverageId = idOf(await ok('POST', '/financial/coverages', { hospitalId: H, patientId: patient.id, payerId: 'uat-payer-1', payerName: 'UAT Insurance', subscriberId: `UAT-L-${RUN}`, validFrom: '2026-01-01', validTo: '2027-12-31' }), 'coverage');
    await ok('POST', '/billing/charges', { hospitalId: H, patientId: patient.id, encounterId, code: 'UAT-CONSULT', description: 'UAT consultation', quantity: 1, unitPrice: 250, currency: 'SAR' });
    const invoiceId = idOf(await ok('POST', '/billing/invoices', { hospitalId: H, patientId: patient.id, encounterId }), 'invoice');
    const claimId = idOf(await ok('POST', '/billing/claims', { hospitalId: H, patientId: patient.id, encounterId, invoiceId, coverageId, payerId: 'uat-payer-1' }), 'claim');
    const settled = await Promise.all(Array.from({ length: 3 }, (_, i) => call('POST', `/billing/claims/${claimId}/adjudications`, { hospitalId: H, outcome: 'complete', approvedAmount: 250, adjudicationReference: `UAT-ADJ-${RUN}-${i}` })));
    const accepted = settled.filter((r) => r.status < 300).length;
    record('concurrency', '3 parallel adjudications of one claim accept only one', accepted === 1, `${accepted} accepted (statuses ${settled.map((r) => r.status).join(',')})`, 'critical'); }

  // ---- Performance --------------------------------------------------------------
  console.log('\nPerformance');
  const sample = await registerPatient();
  const sampleEncounter = await openEncounter(sample.id);
  const reads = [
    ['patient list', '/patients', { hospitalId: H }], ['patient record', `/patients/${sample.id}`, { hospitalId: H }],
    ['encounter', `/encounters/${sampleEncounter}`, { hospitalId: H }], ['patient journey', `/patient-journey/${sample.id}/encounters/${sampleEncounter}`, { hospitalId: H }],
    ['emergency board', '/encounters/emergency/board', { hospitalId: H }], ['bed board', '/bed-management/board', { hospitalId: H }],
    ['analytics overview', '/analytics/overview', { hospitalId: H }], ['billing account', `/billing/accounts/${sample.id}`, { hospitalId: H }],
  ];
  const timings = Object.fromEntries(reads.map(([name]) => [name, []]));
  const statuses = [];
  let next = 0;
  const started = performance.now();
  await Promise.all(Array.from({ length: LOAD_CONCURRENCY }, async () => {
    while (next < LOAD_REQUESTS) {
      const [name, path, query] = reads[next % reads.length]; next += 1;
      const r = await call('GET', path, undefined, query);
      statuses.push(r.status);
      if (r.status < 300) timings[name].push(r.ms);
      await pause(250);
    }
  }));
  const seconds = (performance.now() - started) / 1000;
  const failures = statuses.filter((s) => s >= 400).length;
  console.log(`  ${LOAD_REQUESTS} reads, ${LOAD_CONCURRENCY} in parallel, ${seconds.toFixed(1)} s (${(LOAD_REQUESTS / seconds).toFixed(1)} req/s)`);
  const perf = {};
  for (const [name, values] of Object.entries(timings)) {
    if (!values.length) continue;
    perf[name] = { n: values.length, p50: Math.round(percentile(values, 50)), p95: Math.round(percentile(values, 95)), max: Math.round(Math.max(...values)) };
    console.log(`    ${name.padEnd(20)} p50 ${String(perf[name].p50).padStart(5)} ms   p95 ${String(perf[name].p95).padStart(5)} ms   max ${String(perf[name].max).padStart(5)} ms`);
  }
  record('performance', 'No errors under parallel read load', failures === 0, `${failures} of ${statuses.length} failed (${[...new Set(statuses)].join(',')})`, 'high');
  const slow = Object.entries(perf).filter(([, v]) => v.p95 > 1000).map(([k, v]) => `${k} p95=${v.p95}ms`);
  record('performance', 'Every read p95 under 1 s', slow.length === 0, slow.join('; '), 'medium');

  const fails = results.filter((r) => r.status === 'FAIL');
  console.log(`\n${results.length - fails.length} PASS, ${fails.length} FAIL`);
  const out = resolve(here, `load-concurrency-uat-${RUN}.json`);
  writeFileSync(out, JSON.stringify({ run: RUN, api: API, hospitalCode: HOSPITAL_CODE, load: { requests: LOAD_REQUESTS, concurrency: LOAD_CONCURRENCY, seconds }, perf, results }, null, 2));
  console.log(`Results written to ${out}`);
  process.exitCode = fails.some((f) => f.severity === 'critical') ? 1 : 0;
}

main().catch((error) => { console.error(error); process.exitCode = 2; });
