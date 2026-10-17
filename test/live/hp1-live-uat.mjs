// Live HP1 UAT scenario: drives the running hospital-api (and through it Medplum)
// through the full patient journey plus the cash / corporate / government /
// emergency / inpatient+transfer / death branches, with synthetic data only.
//
// Usage: node test/live/hp1-live-uat.mjs
// Env:   HP1_API_URL (default http://localhost:4000/api)
//        HP1_HOSPITAL_CODE (default HOSP-A)
//        HP1_STEP_DELAY_MS (default 1000; pause between steps for Medplum rate limits)
//        DEV_ADMIN_USERNAME / DEV_ADMIN_PASSWORD (same defaults as the API's dev admin)

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(resolve(here, '../fixtures/hp1-workflow.acceptance.json'), 'utf8'));
const API = process.env.HP1_API_URL ?? 'http://localhost:4000/api';
const HOSPITAL_CODE = process.env.HP1_HOSPITAL_CODE ?? 'HOSP-A';
const RUN = new Date().toISOString().replace(/\D/g, '').slice(2, 14);
const DOCTOR = { id: 'uat-doctor-1', name: 'UAT Doctor' };
// Pause between steps so a full run stays under Medplum's per-minute rate limit.
const STEP_DELAY_MS = Number(process.env.HP1_STEP_DELAY_MS ?? 1000);

let cookie = '';
const results = [];
const ctx = {};

async function call(method, path, body, query) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
  const response = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : undefined; } catch { data = text; }
  if (!response.ok) {
    const message = typeof data === 'object' ? JSON.stringify(data.message ?? data) : String(data);
    throw new Error(`${method} ${path} -> ${response.status}: ${message.slice(0, 300)}`);
  }
  return data;
}
const get = (p, q) => call('GET', p, undefined, q);
const post = (p, b) => call('POST', p, b);
const patch = (p, b) => call('PATCH', p, b);

// Finds the id of the created resource in the various response shapes the API returns.
function idOf(data, ...keys) {
  if (!data || typeof data !== 'object') return undefined;
  for (const key of keys) {
    const value = key.split('.').reduce((o, k) => o?.[k], data);
    if (typeof value === 'string') return value.replace(/^[A-Za-z]+\//, '');
    if (value && typeof value === 'object' && typeof value.id === 'string') return value.id;
  }
  return typeof data.id === 'string' ? data.id : undefined;
}

async function step(gate, name, fn, needs = []) {
  const missing = needs.filter((key) => !ctx[key]);
  if (missing.length) {
    results.push({ gate, name, status: 'SKIP', detail: `blocked: missing ${missing.join(', ')}` });
    console.log(`  SKIP  [${gate}] ${name} (missing ${missing.join(', ')})`);
    return undefined;
  }
  await new Promise((r) => setTimeout(r, STEP_DELAY_MS));
  try {
    const value = await fn();
    results.push({ gate, name, status: 'PASS' });
    console.log(`  PASS  [${gate}] ${name}`);
    return value;
  } catch (error) {
    results.push({ gate, name, status: 'FAIL', detail: error.message });
    console.log(`  FAIL  [${gate}] ${name}\n        ${error.message}`);
    return undefined;
  }
}

function must(value, label) {
  if (!value) throw new Error(`${label} missing from response`);
  return value;
}

const TAG_DIGITS = { MAIN: 1, CASH: 2, IP: 3, XFER: 4, DEATH: 5, CORP: 6, GOV: 7 };

// Charges, invoices and pays an encounter's invoice in full (balance, not a guessed amount).
async function billAndSettle(patientId, encounterId, method) {
  await post('/billing/charges', { hospitalId: ctx.hospitalId, patientId, encounterId, code: 'UAT-CONSULT', description: 'UAT consultation', quantity: 1, unitPrice: 250, currency: 'SAR' });
  const invoice = await post('/billing/invoices', { hospitalId: ctx.hospitalId, patientId, encounterId });
  const invoiceId = must(idOf(invoice, 'invoice'), 'invoice id');
  const due = (invoice.invoice ?? invoice).balance ?? (invoice.invoice ?? invoice).total;
  if (!(due > 0)) throw new Error('invoice has no amount due: ' + JSON.stringify(invoice).slice(0, 200));
  const paid = await post(`/billing/invoices/${invoiceId}/payments`, { hospitalId: ctx.hospitalId, amount: due, currency: 'SAR', method, reference: `UAT-${method}-${encounterId.slice(0, 8)}` });
  const status = (paid.invoice ?? paid).status;
  if (status && status !== 'balanced') throw new Error(`invoice status after full payment is ${status}`);
}

async function registerPatient(tag) {
  const p = fixture.patient;
  const created = await post('/patients', {
    ...p,
    hospitalId: ctx.hospitalId,
    hospitalCode: ctx.hospitalCode,
    hospitalMrn: `UAT-${RUN}-${tag}`,
    nationalId: `2${RUN.slice(-7)}${String(TAG_DIGITS[tag]).padStart(2, '0')}`,
    firstNameEn: `UAT-${tag}`,
    familyNameEn: `Run${RUN}`,
    phone: `05${RUN.slice(-8)}`,
  });
  return must(idOf(created, 'patient', 'patientId'), 'patient id');
}

async function openEncounter(patientId, overrides = {}) {
  const created = await post('/encounters', {
    ...fixture.encounter,
    patientId,
    hospitalId: ctx.hospitalId,
    practitionerId: DOCTOR.id,
    practitionerName: DOCTOR.name,
    ...overrides,
  });
  return must(idOf(created, 'encounter', 'encounterId'), 'encounter id');
}

async function triage(patientId, encounterId, triageLevel = 4) {
  const t = fixture.triage;
  return post('/vitals', {
    patientId, encounterId, hospitalId: ctx.hospitalId,
    systolic: t.systolicBp, diastolic: t.diastolicBp, pulse: t.heartRateBpm, temperature: t.temperatureC,
    respiratoryRate: t.respiratoryRateBpm, spo2: t.spo2Percent, triageLevel,
    chiefComplaint: 'UAT sore throat and fever', allergyCheck: 'reviewed-no-known', medicationHistory: 'reviewed',
    triageConfirmed: true,
  });
}

async function diagnoseAndSign(patientId, encounterId) {
  const d = fixture.clinical.primaryDiagnosis;
  await post('/conditions', {
    patientId, encounterId, hospitalId: ctx.hospitalId, category: 'encounter-diagnosis', diagnosisRank: 'primary',
    codeSystem: 'ICD-10', diagnosisCode: d.code, description: d.display, clinicalStatus: 'active', verificationStatus: 'confirmed',
  });
  const note = await post('/clinical-notes', {
    patientId, encounterId, hospitalId: ctx.hospitalId, practitionerId: DOCTOR.id, practitionerName: DOCTOR.name,
    noteType: 'initial', chiefComplaint: 'UAT sore throat', historyPresentIllness: 'Two days of sore throat.',
    physicalExamination: 'Mild pharyngeal erythema.', allergyReview: 'reviewed-no-known', medicationReview: 'reviewed',
    previousResultsReviewed: true, assessment: fixture.clinical.signedNoteText, plan: 'Symptomatic treatment.',
  });
  const noteId = must(idOf(note, 'note'), 'note id');
  await post(`/clinical-notes/${noteId}/sign`, { hospitalId: ctx.hospitalId, signatureConfirmed: true });
  return noteId;
}

async function finish(encounterId, disposition, extra = {}) {
  return patch(`/encounters/${encounterId}/finish`, {
    ...fixture.disposition, hospitalId: ctx.hospitalId, disposition,
    // The fixture's follow-up date is fixed and goes stale; always use one a week ahead.
    followUpDate: new Date(Date.now() + 7 * 864e5).toISOString(), ...extra,
  });
}

async function main() {
  console.log(`HP1 live UAT run ${RUN} against ${API}\n`);

  await step(0, 'Login as development admin', async () => {
    const session = await post('/auth/login', {
      hospitalId: (await get('/hospitals')).find((h) => h.code === HOSPITAL_CODE)?.id,
      username: process.env.DEV_ADMIN_USERNAME ?? 'admin',
      password: process.env.DEV_ADMIN_PASSWORD ?? 'admin',
      remember: false,
    });
    ctx.hospitalId = session.hospitalId;
    ctx.hospitalCode = HOSPITAL_CODE;
    ctx.session = true;
  });

  // ---- Main path: insured outpatient -------------------------------------
  console.log('\nMain path: insured outpatient');
  await step(1, 'Duplicate search before registration', () => get('/patients/registration/duplicates', {
    hospitalId: ctx.hospitalId, hospitalCode: ctx.hospitalCode, nationalId: fixture.patient.nationalId,
  }), ['session']);
  ctx.patientId = await step(1, 'Register patient with hospital MRN', () => registerPatient('MAIN'), ['session']);
  ctx.encounterId = await step(2, 'Open outpatient encounter', () => openEncounter(ctx.patientId, { financialClass: 'insurance' }), ['patientId']);

  ctx.coverageId = await step(3, 'Create insurance coverage', async () => must(idOf(await post('/financial/coverages', {
    hospitalId: ctx.hospitalId, patientId: ctx.patientId, payerId: 'uat-payer-1', payerName: 'UAT Insurance Co.',
    subscriberId: fixture.financialClass.memberNumber, planName: 'UAT Gold', relationship: 'self', coveragePercentage: 80,
    currency: 'SAR', validFrom: '2026-01-01', validTo: '2027-12-31',
  }), 'coverage'), 'coverage id'), ['encounterId']);
  // Classification comes before eligibility: classifying resets clearance to pending-eligibility.
  await step(3, 'Classify encounter as insurance', () => post(`/financial/encounters/${ctx.encounterId}/classification`, {
    hospitalId: ctx.hospitalId, patientId: ctx.patientId, financialClass: 'insurance', coverageId: ctx.coverageId,
  }), ['coverageId']);
  ctx.eligibilityId = await step(3, 'Request eligibility check', async () => must(idOf(await post('/financial/eligibility/checks', {
    hospitalId: ctx.hospitalId, patientId: ctx.patientId, coverageId: ctx.coverageId, encounterId: ctx.encounterId,
    serviceCodes: ['consultation'], estimatedAmount: fixture.expectedFinancials.chargeAmount, currency: 'SAR',
  }), 'request', 'eligibilityRequest', 'requestId'), 'eligibility request id'), ['coverageId']);
  await step(3, 'Record eligibility decision (eligible)', () => patch(`/financial/eligibility/${ctx.eligibilityId}/decision`, {
    hospitalId: ctx.hospitalId, eligibility: 'eligible', benefitsVerified: true, networkStatus: 'in-network',
    authorizationRequired: false, coveragePercentage: 80, patientResponsibility: 50,
  }), ['eligibilityId']);
  await step(3, 'Encounter is financially cleared', async () => {
    const encounter = JSON.stringify(await get(`/encounters/${ctx.encounterId}`, { hospitalId: ctx.hospitalId }));
    if (!/"cleared"/.test(encounter)) throw new Error('encounter clearance is not "cleared" after an eligible decision');
  }, ['eligibilityId']);

  await step(4, 'Triage vitals', () => triage(ctx.patientId, ctx.encounterId), ['encounterId']);

  ctx.noteSigned = await step(5, 'Primary diagnosis + signed clinical note', () => diagnoseAndSign(ctx.patientId, ctx.encounterId), ['encounterId']);
  ctx.medicationRequestId = await step(5, 'Prescribe medication', async () => must(idOf(await post('/medications', {
    patientId: ctx.patientId, hospitalId: ctx.hospitalId, encounterId: ctx.encounterId, practitionerId: DOCTOR.id,
    medicationCode: fixture.clinical.medication.code, medicationName: fixture.clinical.medication.display,
    dose: 500, doseUnit: 'mg', route: 'oral', frequency: 'every 8 hours', durationDays: 3, quantity: 9, quantityUnit: 'tablet',
  }), 'medicationRequest'), 'medication request id'), ['encounterId']);

  // Orders, services, pharmacy
  await step(6, 'Receive pharmacy stock', () => post('/pharmacy/inventory/receive', {
    hospitalId: ctx.hospitalId, medicationCode: fixture.clinical.medication.code, medicationName: fixture.clinical.medication.display,
    form: 'tablet', strength: '500 mg', unit: 'tablet', lotNumber: `UAT-LOT-${RUN}`, expirationDate: '2028-12-31',
    quantity: 100, reorderLevel: 10,
  }), ['session']);
  await step(6, 'Pharmacist verifies prescription', () => post(`/pharmacy/prescriptions/${ctx.medicationRequestId}/verify`, {
    hospitalId: ctx.hospitalId, pharmacistName: 'UAT Pharmacist', allergyChecked: true, interactionChecked: true,
    doseChecked: true, stockChecked: true, decision: 'approved',
  }), ['medicationRequestId']);
  await step(6, 'Dispense medication', () => post('/pharmacy/dispense', {
    hospitalId: ctx.hospitalId, medicationRequestId: ctx.medicationRequestId, quantity: 9,
    pharmacistName: 'UAT Pharmacist', counselingProvided: true,
  }), ['medicationRequestId']);

  ctx.labOrderId = await step(6, 'Order laboratory test', async () => must(idOf(await post('/laboratory/orders', {
    patientId: ctx.patientId, encounterId: ctx.encounterId, hospitalId: ctx.hospitalId,
    testCode: fixture.clinical.laboratoryOrder.code, testName: fixture.clinical.laboratoryOrder.display,
    priority: 'routine', practitionerId: DOCTOR.id, practitionerName: DOCTOR.name,
  }), 'order', 'serviceRequest'), 'lab order id'), ['encounterId']);
  ctx.radiologyOrderId = await step(6, 'Order radiology exam', async () => must(idOf(await post('/radiology/orders', {
    patientId: ctx.patientId, encounterId: ctx.encounterId, hospitalId: ctx.hospitalId,
    examCode: fixture.clinical.radiologyOrder.code, examName: fixture.clinical.radiologyOrder.display, modality: 'XR',
    priority: 'routine', clinicalIndication: 'UAT cough', requesterId: DOCTOR.id, requesterName: DOCTOR.name,
  }), 'order', 'serviceRequest'), 'radiology order id'), ['encounterId']);
  ctx.serviceOrderId = await step(6, 'Order other clinical service', async () => must(idOf(await post('/clinical-services/orders', {
    hospitalId: ctx.hospitalId, patientId: ctx.patientId, encounterId: ctx.encounterId,
    serviceType: 'procedure', serviceCode: 'UAT-NEB', serviceName: 'Nebulizer session', priority: 'routine',
    requesterId: DOCTOR.id, requesterName: DOCTOR.name,
  }), 'order', 'serviceRequest'), 'service order id'), ['encounterId']);

  // Results / reporting: laboratory
  console.log('\nResults and reporting');
  ctx.specimenId = await step(7, 'Collect specimen', async () => must(idOf(await post('/laboratory/specimens', {
    orderId: ctx.labOrderId, patientId: ctx.patientId, encounterId: ctx.encounterId, hospitalId: ctx.hospitalId,
    specimenTypeCode: '119297000', specimenTypeName: 'Blood', collectedAt: new Date().toISOString(), collectorName: 'UAT Nurse',
  }), 'specimen'), 'specimen id'), ['labOrderId']);
  await step(7, 'Receive and accept specimen', () => patch(`/laboratory/specimens/${ctx.specimenId}/status`, {
    status: 'available', acceptanceStatus: 'accepted', receivedAt: new Date().toISOString(), receiverName: 'UAT Lab Tech',
  }), ['specimenId']);
  ctx.labResultId = await step(7, 'Enter lab result', async () => must(idOf(await post('/laboratory/results', {
    orderId: ctx.labOrderId, specimenId: ctx.specimenId, patientId: ctx.patientId, encounterId: ctx.encounterId,
    hospitalId: ctx.hospitalId, testCode: fixture.clinical.laboratoryOrder.code, testName: fixture.clinical.laboratoryOrder.display,
    value: 14.2, unit: 'g/dL', referenceLow: 13.5, referenceHigh: 17.5, criticalLow: 7, criticalHigh: 20,
    status: 'preliminary', performerName: 'UAT Lab Tech',
  }), 'result', 'observation'), 'lab result id'), ['specimenId']);
  await step(7, 'Technical validation', () => post(`/laboratory/results/${ctx.labResultId}/technical-validation`, {
    hospitalId: ctx.hospitalId, validatorName: 'UAT Lab Tech',
  }), ['labResultId']);
  await step(7, 'Clinical validation', () => post(`/laboratory/results/${ctx.labResultId}/clinical-validation`, {
    hospitalId: ctx.hospitalId, validatorName: 'UAT Lab Supervisor',
  }), ['labResultId']);
  ctx.labReportId = await step(7, 'Create lab report', async () => must(idOf(await post('/laboratory/reports', {
    orderId: ctx.labOrderId, patientId: ctx.patientId, encounterId: ctx.encounterId, hospitalId: ctx.hospitalId,
    specimenIds: [ctx.specimenId], resultIds: [ctx.labResultId], performerName: 'UAT Lab Supervisor', conclusion: 'Within normal limits.',
  }), 'report', 'diagnosticReport'), 'lab report id'), ['labResultId']);
  await step(7, 'Finalize lab report', () => post(`/laboratory/reports/${ctx.labReportId}/finalize`, {
    verifierName: 'UAT Lab Supervisor', conclusion: 'Within normal limits.',
  }), ['labReportId']);

  // Results / reporting: radiology
  for (const workflowStatus of ['scheduled', 'arrived', 'exam-started', 'acquired', 'images-available', 'reporting']) {
    await step(7, `Radiology workflow -> ${workflowStatus}`, () => patch(`/radiology/orders/${ctx.radiologyOrderId}/workflow`, { workflowStatus }), ['radiologyOrderId']);
  }
  ctx.radiologyReportId = await step(7, 'Create radiology report', async () => must(idOf(await post('/radiology/reports', {
    orderId: ctx.radiologyOrderId, patientId: ctx.patientId, encounterId: ctx.encounterId, hospitalId: ctx.hospitalId,
    radiologistName: 'UAT Radiologist', technique: 'PA view', findings: 'Clear lungs.', impression: 'No acute disease.',
  }), 'report', 'diagnosticReport'), 'radiology report id'), ['radiologyOrderId']);
  await step(7, 'Finalize radiology report', () => post(`/radiology/reports/${ctx.radiologyReportId}/finalize`, {
    verifierName: 'UAT Radiologist', verificationConfirmed: true,
  }), ['radiologyReportId']);

  // Doctor review
  for (const [label, key] of [['lab report', 'labReportId'], ['radiology report', 'radiologyReportId']]) {
    await step(8, `Doctor acknowledges ${label}`, () => post('/result-reviews', {
      hospitalId: ctx.hospitalId, patientId: ctx.patientId, encounterId: ctx.encounterId, targetType: 'DiagnosticReport',
      targetId: ctx[key], practitionerId: DOCTOR.id, practitionerName: DOCTOR.name, decision: 'acknowledged', critical: false,
    }), [key]);
  }

  // Orders still open after their results are final must be completed before discharge.
  await step(6, 'Complete performed clinical service', () => patch(`/clinical-services/orders/${ctx.serviceOrderId}/status`, {
    hospitalId: ctx.hospitalId, status: 'completed', performerName: 'UAT Nurse', completionNote: 'UAT nebulizer given, tolerated well.',
  }), ['serviceOrderId']);
  for (const [label, base, key] of [['laboratory', '/laboratory/orders', 'labOrderId'], ['radiology', '/radiology/orders', 'radiologyOrderId']]) {
    await step(7, `Close ${label} order after final report`, async () => {
      const order = await get(`${base}/${ctx[key]}`, { hospitalId: ctx.hospitalId });
      const status = (order.order ?? order).status;
      if (['draft', 'active', 'on-hold'].includes(status)) {
        ctx.ordersLeftOpen = [...(ctx.ordersLeftOpen ?? []), label];
        await patch(`${base}/${ctx[key]}/status`, { status: 'completed' });
      }
    }, [key]);
  }

  // Disposition
  console.log('\nDisposition, billing, records');
  ctx.finished = await step(9, 'Discharge home with follow-up', () => finish(ctx.encounterId, 'home'), ['encounterId']);

  // Billing / claim
  await step(10, 'Capture encounter charges from tariffs', () => post(`/billing/encounters/${ctx.encounterId}/capture`, { hospitalId: ctx.hospitalId }), ['encounterId']);
  await step(10, 'Post manual consultation charge', () => post('/billing/charges', {
    hospitalId: ctx.hospitalId, patientId: ctx.patientId, encounterId: ctx.encounterId, code: 'UAT-CONSULT',
    description: 'UAT consultation', quantity: 1, unitPrice: fixture.expectedFinancials.chargeAmount, currency: 'SAR',
  }), ['encounterId']);
  ctx.invoiceId = await step(10, 'Generate invoice', async () => must(idOf(await post('/billing/invoices', {
    hospitalId: ctx.hospitalId, patientId: ctx.patientId, encounterId: ctx.encounterId,
  }), 'invoice'), 'invoice id'), ['encounterId']);
  await step(10, 'Record patient co-pay payment', () => post(`/billing/invoices/${ctx.invoiceId}/payments`, {
    hospitalId: ctx.hospitalId, amount: 50, currency: 'SAR', method: 'card', reference: `UAT-PAY-${RUN}`,
  }), ['invoiceId']);
  ctx.claimId = await step(10, 'Submit insurance claim', async () => must(idOf(await post('/billing/claims', {
    hospitalId: ctx.hospitalId, patientId: ctx.patientId, encounterId: ctx.encounterId, invoiceId: ctx.invoiceId,
    coverageId: ctx.coverageId, payerId: 'uat-payer-1',
  }), 'claim'), 'claim id'), ['invoiceId', 'coverageId']);
  await step(10, 'Adjudicate claim', () => post(`/billing/claims/${ctx.claimId}/adjudications`, {
    hospitalId: ctx.hospitalId, outcome: 'complete', approvedAmount: 200, adjudicationReference: `UAT-ADJ-${RUN}`,
  }), ['claimId']);
  await step(10, 'Encounter billing summary', () => get(`/billing/encounters/${ctx.encounterId}`, { hospitalId: ctx.hospitalId }), ['encounterId']);

  // Medical record completion
  const assessment = await step(11, 'Assess record for deficiencies', () => post(`/medical-records/encounters/${ctx.encounterId}/assess`, {
    hospitalId: ctx.hospitalId, ownerId: DOCTOR.id, ownerName: DOCTOR.name,
  }), ['encounterId']);
  if (assessment?.deficiencies?.length) console.log('        deficiencies: ' + assessment.deficiencies.map((d) => d.code ?? d.message).join(', '));
  const view = assessment ? await get(`/medical-records/encounters/${ctx.encounterId}`, { hospitalId: ctx.hospitalId }).catch(() => undefined) : undefined;
  const deficiencies = (view?.deficiencies ?? view?.tasks ?? []).filter((d) => d?.id && !['completed', 'cancelled'].includes(d.status));
  for (const deficiency of deficiencies) {
    await step(11, `Resolve deficiency ${deficiency.code ?? deficiency.id}`, () => patch(`/medical-records/deficiencies/${deficiency.id}/resolve`, {
      hospitalId: ctx.hospitalId, resolutionNote: 'UAT resolved',
    }));
  }
  ctx.recordId = await step(11, 'Close medical record', async () => must(idOf(await post(`/medical-records/encounters/${ctx.encounterId}/close`, {
    hospitalId: ctx.hospitalId, practitionerId: DOCTOR.id, practitionerName: DOCTOR.name, confirmation: true,
  }), 'record', 'composition'), 'record id'), ['encounterId']);
  await step(11, 'HIM locks record', () => post(`/medical-records/${ctx.recordId}/lock`, {
    hospitalId: ctx.hospitalId, himOfficerId: 'uat-him-1', himOfficerName: 'UAT HIM Officer', confirmation: true,
  }), ['recordId']);
  await step(11, 'Authorized amendment after lock', () => post(`/medical-records/${ctx.recordId}/amendments`, {
    hospitalId: ctx.hospitalId, practitionerId: DOCTOR.id, practitionerName: DOCTOR.name, reason: 'UAT correction', note: 'UAT addendum correcting the follow-up instructions.',
  }), ['recordId']);

  // Reporting / audit / analytics
  await step(12, 'Audit events recorded for patient', async () => {
    const events = await get('/audit/events', { hospitalId: ctx.hospitalId, patientId: ctx.patientId });
    const list = Array.isArray(events) ? events : events?.events ?? events?.items ?? [];
    if (!list.length) throw new Error('no audit events returned for the UAT patient');
  }, ['patientId']);
  await step(12, 'Analytics overview', () => get('/analytics/overview', { hospitalId: ctx.hospitalId }), ['session']);
  await step(12, 'Patient journey view', async () => {
    const journey = await get(`/patient-journey/${ctx.patientId}/encounters/${ctx.encounterId}`, { hospitalId: ctx.hospitalId });
    ctx.journeyCompletion = journey?.completion ?? journey?.completionPercentage ?? journey?.progress;
  }, ['encounterId']);

  // ---- Branches ----------------------------------------------------------
  console.log('\nBranch: cash');
  const cashPatient = await step('B-cash', 'Register cash patient', () => registerPatient('CASH'), ['session']);
  if (cashPatient) ctx.cashPatient = cashPatient;
  ctx.cashEncounter = await step('B-cash', 'Open cash encounter', () => openEncounter(ctx.cashPatient, { financialClass: 'cash' }), ['cashPatient']);
  await step('B-cash', 'Classify as cash', () => post(`/financial/encounters/${ctx.cashEncounter}/classification`, {
    hospitalId: ctx.hospitalId, patientId: ctx.cashPatient, financialClass: 'cash',
  }), ['cashEncounter']);
  await step('B-cash', 'Assess, diagnose, sign', async () => { await triage(ctx.cashPatient, ctx.cashEncounter); await diagnoseAndSign(ctx.cashPatient, ctx.cashEncounter); }, ['cashEncounter']);
  await step('B-cash', 'Finish encounter', () => finish(ctx.cashEncounter, 'home'), ['cashEncounter']);
  await step('B-cash', 'Charge, invoice, pay in full in cash', () => billAndSettle(ctx.cashPatient, ctx.cashEncounter, 'cash'), ['cashEncounter']);

  console.log('\nBranch: corporate and government');
  for (const financialClass of ['corporate', 'government']) {
    const key = `${financialClass}Encounter`;
    const pkey = `${financialClass}Patient`;
    const pid = await step(`B-${financialClass}`, `Register ${financialClass} patient`, () => registerPatient(financialClass === 'corporate' ? 'CORP' : 'GOV'), ['session']);
    if (pid) ctx[pkey] = pid;
    ctx[key] = await step(`B-${financialClass}`, `Open ${financialClass} encounter`, () => openEncounter(ctx[pkey], { financialClass }), [pkey]);
    await step(`B-${financialClass}`, `Classify as ${financialClass} with sponsor`, () => post(`/financial/encounters/${ctx[key]}/classification`, {
      hospitalId: ctx.hospitalId, patientId: ctx[pkey], financialClass,
      sponsorId: `uat-${financialClass}-sponsor`, sponsorName: `UAT ${financialClass} sponsor`,
    }), [key]);
  }

  console.log('\nBranch: emergency (unknown patient)');
  const arrival = await step('B-emergency', 'Quick arrival with temporary identity', () => post('/encounters/emergency/quick-arrival', {
    hospitalId: ctx.hospitalId, hospitalCode: ctx.hospitalCode, temporaryName: `UAT Unknown ${RUN}`, gender: 'unknown',
    chiefComplaint: 'UAT chest pain', arrivalMode: 'ambulance', priority: 'emergency',
  }), ['session']);
  if (arrival) {
    ctx.edEncounter = idOf(arrival, 'encounter', 'encounterId');
    ctx.edPatient = idOf(arrival, 'patient', 'patientId');
  }
  await step('B-emergency', 'Assign ED bed', () => patch(`/encounters/emergency/${ctx.edEncounter}/bed`, { hospitalId: ctx.hospitalId, bedName: 'UAT-ED-1' }), ['edEncounter']);
  await step('B-emergency', 'Triage level 2', () => triage(ctx.edPatient, ctx.edEncounter, 2), ['edEncounter', 'edPatient']);
  await step('B-emergency', 'Reassessment', () => post(`/encounters/emergency/${ctx.edEncounter}/reassessments`, {
    hospitalId: ctx.hospitalId, severity: 2, clinicalStatus: 'improved', note: 'UAT reassessment', clinicianName: DOCTOR.name,
  }), ['edEncounter']);
  await step('B-emergency', 'Emergency board lists patient', async () => {
    const board = JSON.stringify(await get('/encounters/emergency/board', { hospitalId: ctx.hospitalId }));
    if (!board.includes(ctx.edEncounter)) throw new Error('ED encounter not on the emergency board');
  }, ['edEncounter']);
  await step('B-emergency', 'Diagnose, sign and finish (referred)', async () => {
    await diagnoseAndSign(ctx.edPatient, ctx.edEncounter);
    await finish(ctx.edEncounter, 'referred', { referralDestination: 'UAT Cardiology Centre' });
  }, ['edEncounter', 'edPatient']);

  console.log('\nBranch: inpatient admission, transfer and discharge');
  const ip = await step('B-inpatient', 'Register inpatient', () => registerPatient('IP'), ['session']);
  if (ip) ctx.ipPatient = ip;
  ctx.ipEncounter = await step('B-inpatient', 'Open inpatient encounter', () => openEncounter(ctx.ipPatient, { encounterType: 'inpatient', financialClass: 'cash' }), ['ipPatient']);
  ctx.admissionRequestId = await step('B-inpatient', 'Admission request', async () => must(idOf(await post('/inpatient/admission-requests', {
    hospitalId: ctx.hospitalId, patientId: ctx.ipPatient, encounterId: ctx.ipEncounter, acuity: 'urgent',
    admissionReason: 'UAT pneumonia', requestingPhysicianName: DOCTOR.name,
  }), 'request', 'admissionRequest'), 'admission request id'), ['ipEncounter']);
  await step('B-inpatient', 'Approve admission', () => post(`/inpatient/admission-requests/${ctx.admissionRequestId}/review`, {
    hospitalId: ctx.hospitalId, decision: 'approved', admissionOfficerName: 'UAT Admission Officer',
  }), ['admissionRequestId']);
  await step('B-inpatient', 'Authorization not required (cash)', () => post(`/inpatient/admission-requests/${ctx.admissionRequestId}/authorization`, {
    hospitalId: ctx.hospitalId, status: 'not-required', authorizedBy: 'UAT Admission Officer',
  }), ['admissionRequestId']);
  await step('B-inpatient', 'Bed request', () => post(`/inpatient/admission-requests/${ctx.admissionRequestId}/bed-request`, {
    hospitalId: ctx.hospitalId, preferredWard: 'UAT-W1',
  }), ['admissionRequestId']);
  for (const n of [1, 2]) {
    ctx[`bed${n}`] = await step('B-inpatient', `Create UAT bed ${n}`, async () => must(idOf(await post('/inpatient/beds', {
      hospitalId: ctx.hospitalId, floorCode: 'UAT-F1', floorName: 'UAT Floor', wardCode: 'UAT-W1', wardName: 'UAT Ward',
      roomNumber: `U${n}`, bedCode: `UAT-${RUN}-B${n}`,
    }), 'bed', 'location'), 'bed id'), ['session']);
  }
  await step('B-inpatient', 'Admit to bed 1', () => post('/inpatient/admit', {
    hospitalId: ctx.hospitalId, encounterId: ctx.ipEncounter, patientId: ctx.ipPatient, bedId: ctx.bed1,
    admissionReason: 'UAT pneumonia', admissionRequestId: ctx.admissionRequestId,
  }), ['bed1', 'admissionRequestId']);
  await step('B-inpatient', 'Transfer to bed 2', () => post('/inpatient/transfer', {
    hospitalId: ctx.hospitalId, encounterId: ctx.ipEncounter, targetBedId: ctx.bed2, reason: 'UAT isolation',
  }), ['bed2', 'ipEncounter']);
  await step('B-inpatient', 'Diagnose and sign', () => diagnoseAndSign(ctx.ipPatient, ctx.ipEncounter), ['ipEncounter']);
  ctx.dischargeId = await step('B-inpatient', 'Start discharge', async () => must(idOf(await post('/discharge', {
    hospitalId: ctx.hospitalId, patientId: ctx.ipPatient, encounterId: ctx.ipEncounter, physicianName: DOCTOR.name, decisionReason: 'UAT recovered',
  }), 'discharge', 'carePlan'), 'discharge id'), ['ipEncounter']);
  await step('B-inpatient', 'Medication reconciliation', () => post(`/discharge/${ctx.dischargeId}/reconciliation`, {
    hospitalId: ctx.hospitalId, clinicianName: DOCTOR.name, homeMedications: ['Paracetamol 500 mg'],
  }), ['dischargeId']);
  await step('B-inpatient', 'Discharge summary', () => post(`/discharge/${ctx.dischargeId}/summary`, {
    hospitalId: ctx.hospitalId, authorName: DOCTOR.name, admissionReason: 'UAT pneumonia', finalDiagnoses: ['J18.9 Pneumonia'],
    procedures: [], hospitalCourse: 'Uneventful.', investigations: 'CXR', dischargeMedications: ['Paracetamol 500 mg'],
    conditionAtDischarge: 'improved', instructions: 'Rest.', followUp: 'Clinic in 1 week',
  }), ['dischargeId']);
  await step('B-inpatient', 'Bill and settle inpatient stay', () => billAndSettle(ctx.ipPatient, ctx.ipEncounter, 'card'), ['ipEncounter']);
  for (const department of ['billing', 'pharmacy', 'nursing']) {
    await step('B-inpatient', `${department} clearance`, () => post(`/discharge/${ctx.dischargeId}/clearance`, {
      hospitalId: ctx.hospitalId, department, cleared: true, actorName: `UAT ${department}`,
    }), ['dischargeId']);
  }
  await step('B-inpatient', 'Finalize discharge', () => post(`/discharge/${ctx.dischargeId}/finalize`, {
    hospitalId: ctx.hospitalId, actorName: DOCTOR.name, confirmation: true,
  }), ['dischargeId']);

  console.log('\nBranch: transfer out and death');
  for (const [tag, disposition, extra] of [['XFER', 'transfer', { referralDestination: 'UAT Tertiary Hospital' }], ['DEATH', 'deceased', { dischargeCondition: 'deteriorated' }]]) {
    const key = `${tag}Encounter`;
    const pid = await step(`B-${disposition}`, `Register ${tag} patient`, () => registerPatient(tag), ['session']);
    if (pid) ctx[`${tag}Patient`] = pid;
    ctx[key] = await step(`B-${disposition}`, 'Open encounter', () => openEncounter(ctx[`${tag}Patient`], { financialClass: 'cash' }), [`${tag}Patient`]);
    await step(`B-${disposition}`, 'Diagnose and sign', () => diagnoseAndSign(ctx[`${tag}Patient`], ctx[key]), [key]);
    await step(`B-${disposition}`, `Finish with disposition ${disposition}`, () => finish(ctx[key], disposition, extra), [key]);
  }

  // Isolation rule: the main encounter must not be readable from the other hospital.
  console.log('\nIsolation');
  await step('ISO', 'Cross-hospital read is refused', async () => {
    const other = (await get('/hospitals')).find((h) => h.id !== ctx.hospitalId);
    if (!other) throw new Error('no second hospital to test with');
    try {
      await get(`/encounters/${ctx.encounterId}`, { hospitalId: other.id });
    } catch (error) {
      if (/-> (401|403|404):/.test(error.message)) return;
      throw error;
    }
    throw new Error('encounter was returned for a different hospitalId');
  }, ['encounterId']);

  // ---- Summary -------------------------------------------------------------
  const count = (s) => results.filter((r) => r.status === s).length;
  console.log(`\nRun ${RUN}: ${count('PASS')} PASS, ${count('FAIL')} FAIL, ${count('SKIP')} SKIP`);
  const out = resolve(here, `hp1-live-uat-${RUN}.json`);
  writeFileSync(out, JSON.stringify({ run: RUN, api: API, hospitalCode: HOSPITAL_CODE, ids: ctx, results }, null, 2));
  console.log(`Results written to ${out}`);
  process.exitCode = count('FAIL') ? 1 : 0;
}

main().catch((error) => { console.error(error); process.exitCode = 2; });
