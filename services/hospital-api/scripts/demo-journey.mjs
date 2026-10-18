// A complete outpatient journey for one named patient on a TRAINING or demo
// environment (for the user manual and training): reception → nurse → doctor →
// laboratory → radiology → pharmacy → doctor review → discharge → billing →
// medical records. Every step is done by the account of the role that does it
// in the hospital, so the audit log and the screens show who did what.
//
//   node --env-file=<seed.env> scripts/demo-journey.mjs --training-environment
//
// Env (besides those of seed-training.mjs, which must have run first):
//   DEMO_PATIENT_JSON        optional: the patient to register (see PATIENT below)
//   DEMO_ORTHANC_CONTAINER   the environment's Orthanc container, to play the
//                            X-ray machine (e.g. unitech-training-orthanc-1)
//   DEMO_ORTHANC_PASSWORD_FILE  that Orthanc's hospital-api password file
//   DEMO_DICOM_FILE          a sample DICOM image (default: dicom-test/ct-test.dcm)
//
// Prints each step; exits 1 if the journey is not 100% complete and paid.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

if (!process.argv.includes('--training-environment')) {
  console.error('Refusing to run: this creates a patient and a full visit.\n' +
    'Pass --training-environment to confirm the target is a training or demo environment.');
  process.exit(2);
}
const here = dirname(fileURLToPath(import.meta.url));
const need = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const API = need('TRAINING_API_URL').replace(/\/+$/, '');
const HOSPITAL_CODE = process.env.TRAINING_HOSPITAL_CODE ?? 'HOSP-01';
const INSECURE = process.env.TRAINING_INSECURE_TLS === '1';
const PASSWORD = /^Password: `([^`]+)`/m.exec(readFileSync(need('TRAINING_ACCOUNTS_FILE'), 'utf8'))?.[1];
if (!PASSWORD) throw new Error('No password in the account sheet; run seed-training.mjs first');

const PATIENT = JSON.parse(process.env.DEMO_PATIENT_JSON ?? JSON.stringify({
  nationalId: '9990000201',
  firstNameAr: 'محمد', familyNameAr: 'سميح',
  firstNameEn: 'Mohammad', familyNameEn: 'Sameeh',
  gender: 'male', birthDate: '1984-03-14', phone: '0790000201',
  city: 'Amman', country: 'Jordan', nationality: 'Jordanian',
}));

// ---- HTTP (cookie sessions per role) ----------------------------------------------
function request(cookie, method, path, body) {
  const url = new URL(API + path);
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const client = url.protocol === 'https:' ? https : http;
  return new Promise((resolve_, reject) => {
    const req = client.request({
      hostname: url.hostname, port: url.port, path: url.pathname + url.search, method,
      rejectUnauthorized: !INSECURE,
      ...(url.hostname.endsWith('.localhost') && {
        lookup: (h, o, cb) => (o?.all ? cb(null, [{ address: '127.0.0.1', family: 4 }]) : cb(null, '127.0.0.1', 4)),
      }),
      headers: {
        'content-type': 'application/json', ...(cookie ? { cookie } : {}),
        ...(payload ? { 'content-length': Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (text += c));
      res.on('end', () => {
        let data;
        try { data = text ? JSON.parse(text) : undefined; } catch { data = text; }
        const set = [].concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith('unitech_ehr_session='));
        resolve_({ status: res.statusCode, data, cookie: set?.split(';')[0] });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
const wait = (s) => new Promise((r) => setTimeout(r, s * 1000));
const sessions = {};
let H;
async function as(role) {
  if (sessions[role]) return sessions[role];
  if (Object.keys(sessions).length) await wait(13); // Medplum allows only a few sign-ins per short window
  const login = await request(null, 'POST', '/api/auth/login', { hospitalId: H, username: `train.${role}`, password: PASSWORD });
  if (login.status !== 201) throw new Error(`train.${role} cannot sign in (HTTP ${login.status})`);
  const user = login.data.user;
  sessions[role] = {
    id: user.id, name: user.display,
    call: async (method, path, body) => {
      const r = await request(login.cookie, method, path, body);
      if (r.status >= 300) throw new Error(`${method} ${path} as train.${role} -> ${r.status} ${JSON.stringify(r.data).slice(0, 300)}`);
      return r.data;
    },
  };
  return sessions[role];
}
let n = 0;
async function step(role, label, fn) {
  const who = await as(role);
  const result = await fn(who);
  console.log(`  ${String(++n).padStart(2)}. [${who.name}] ${label}`);
  return result;
}
const idOf = (x, ...keys) => {
  for (const k of keys) if (x?.[k]?.id) return x[k].id;
  return x?.id;
};

// ---- The journey ----------------------------------------------------------------
const hospitals = (await request(null, 'GET', '/api/hospitals')).data;
const hospital = hospitals.find((h) => h.code === HOSPITAL_CODE);
if (!hospital) throw new Error(`${HOSPITAL_CODE} not found`);
H = hospital.id;
const q = `hospitalId=${H}`;
console.log(`Journey for ${PATIENT.firstNameAr} ${PATIENT.familyNameAr} (${PATIENT.firstNameEn} ${PATIENT.familyNameEn}) at ${HOSPITAL_CODE}, ${API}\n`);

// Price list: one price per billable category, in the hospital currency.
console.log('Price list');
await step('administrator', 'Check the price list covers the visit', async (u) => {
  const PRICES = [
    ['CONS-IM', 'Internal medicine consultation', 'consultation', 20],
    ['LAB-STD', 'Laboratory test', 'laboratory', 8],
    ['RAD-XR', 'X-ray examination', 'radiology', 25],
    ['MED-UNIT', 'Medicine (per unit dispensed)', 'medication', 0.5],
    ['PROC-STD', 'Outpatient procedure', 'procedure', 15],
  ];
  const listed = (await u.call('GET', `/api/administration/catalog?${q}&kind=price-lists`)).items;
  for (const [code, name, category, price] of PRICES) {
    if (listed.some((i) => i.category === category && i.status === 'active')) continue;
    await u.call('POST', '/api/administration/catalog', { hospitalId: H, kind: 'price-lists', code, name, price, category });
  }
});

console.log('\nReception');
const patientId = await step('receptionist', 'Find or register the patient', async (u) => {
  const found = await u.call('GET', `/api/patients?${q}&nationalId=${PATIENT.nationalId}`);
  if (found.patients?.[0]) return found.patients[0].id;
  const created = await u.call('POST', '/api/patients', {
    hospitalId: H, hospitalCode: HOSPITAL_CODE, preferredLanguage: 'ar', registrationConfirmed: true, ...PATIENT,
  });
  return idOf(created, 'patient');
});
const doctor = await as('doctor');
// Reception opens the visit by checking the patient in on an appointment
// (walk-ins get one booked on the spot); the visit's payer is set by billing.
const encounterId = await step('receptionist', 'Appointment booked with the internal medicine doctor, patient checked in', async (u) => {
  const appointment = await u.call('POST', '/api/appointments', {
    hospitalId: H, patientId, practitionerId: doctor.id, practitionerName: doctor.name, department: 'Internal Medicine',
    serviceType: 'Consultation', reason: 'Sore throat and fever for two days',
    start: new Date(Date.now() + 5 * 60_000).toISOString(), durationMinutes: 20, priority: 'routine',
  });
  const checkedIn = await u.call('POST', `/api/appointments/${idOf(appointment, 'appointment')}/check-in`, { hospitalId: H });
  return idOf(checkedIn, 'encounter');
});
await step('cashier', 'Visit classified as cash (self-pay)', (u) =>
  u.call('POST', `/api/financial/encounters/${encounterId}/classification`, { hospitalId: H, patientId, financialClass: 'cash' }));
const visit = { patientId, encounterId, hospitalId: H };

console.log('\nNursing');
await step('nurse', 'Triage: vital signs, allergies and medicines reviewed', (u) => u.call('POST', '/api/vitals', {
  ...visit, systolic: 124, diastolic: 80, pulse: 92, temperature: 38.4, respiratoryRate: 18, spo2: 98, triageLevel: 4,
  chiefComplaint: 'Sore throat and fever', allergyCheck: 'reviewed-no-known', medicationHistory: 'reviewed', triageConfirmed: true,
}));

console.log('\nDoctor');
await step('doctor', 'Diagnosis: acute pharyngitis (J02.9)', (u) => u.call('POST', '/api/conditions', {
  ...visit, category: 'encounter-diagnosis', diagnosisRank: 'primary', codeSystem: 'ICD-10', diagnosisCode: 'J02.9',
  description: 'Acute pharyngitis, unspecified', clinicalStatus: 'active', verificationStatus: 'confirmed',
}));
await step('doctor', 'Clinical note, signed', async (u) => {
  const note = await u.call('POST', '/api/clinical-notes', {
    ...visit, practitionerId: u.id, practitionerName: u.name, noteType: 'initial',
    chiefComplaint: 'Sore throat and fever', historyPresentIllness: 'Two days of sore throat, fever up to 38.5 °C, no cough.',
    physicalExamination: 'Pharyngeal erythema, tender anterior cervical nodes, chest clear.',
    allergyReview: 'reviewed-no-known', medicationReview: 'reviewed', previousResultsReviewed: true,
    assessment: 'Acute pharyngitis. Blood count and chest X-ray to exclude complications.',
    plan: 'Paracetamol, fluids, review results, follow-up in one week.',
  });
  await u.call('POST', `/api/clinical-notes/${idOf(note, 'note')}/sign`, { hospitalId: H, signatureConfirmed: true });
});
const medicationRequestId = await step('doctor', 'Prescription: paracetamol 500 mg every 8 hours for 3 days', async (u) =>
  idOf(await u.call('POST', '/api/medications', {
    ...visit, practitionerId: u.id, medicationCode: 'PARACETAMOL-500', medicationName: 'Paracetamol 500 mg',
    dose: 500, doseUnit: 'mg', route: 'oral', frequency: 'every 8 hours', durationDays: 3, quantity: 9, quantityUnit: 'tablet',
  }), 'medicationRequest'));
const labOrderId = await step('doctor', 'Laboratory order: haemoglobin', async (u) =>
  idOf(await u.call('POST', '/api/laboratory/orders', {
    ...visit, testCode: '718-7', testName: 'Hemoglobin', priority: 'routine', practitionerId: u.id, practitionerName: u.name,
  }), 'order', 'serviceRequest'));
const radiologyOrderId = await step('doctor', 'Radiology order: chest X-ray', async (u) =>
  idOf(await u.call('POST', '/api/radiology/orders', {
    ...visit, examCode: '36643-5', examName: 'Chest X-ray', modality: 'XR', priority: 'routine',
    clinicalIndication: 'Fever, exclude pneumonia', requesterId: u.id, requesterName: u.name,
  }), 'order', 'serviceRequest'));

console.log('\nLaboratory');
const specimenId = await step('lab.technician', 'Blood specimen collected', async (u) =>
  idOf(await u.call('POST', '/api/laboratory/specimens', {
    orderId: labOrderId, ...visit, specimenTypeCode: '119297000', specimenTypeName: 'Blood',
    collectedAt: new Date().toISOString(), collectorName: u.name,
  }), 'specimen'));
await step('lab.technician', 'Specimen received and accepted', (u) => u.call('PATCH', `/api/laboratory/specimens/${specimenId}/status`, {
  status: 'available', acceptanceStatus: 'accepted', receivedAt: new Date().toISOString(), receiverName: u.name,
}));
const resultId = await step('lab.technician', 'Result entered: haemoglobin 14.6 g/dL', async (u) =>
  idOf(await u.call('POST', '/api/laboratory/results', {
    orderId: labOrderId, specimenId, ...visit, testCode: '718-7', testName: 'Hemoglobin', value: 14.6, unit: 'g/dL',
    referenceLow: 13.5, referenceHigh: 17.5, criticalLow: 7, criticalHigh: 20, status: 'preliminary', performerName: u.name,
  }), 'result', 'observation'));
await step('lab.technician', 'Technical validation', (u) =>
  u.call('POST', `/api/laboratory/results/${resultId}/technical-validation`, { hospitalId: H, validatorName: u.name }));
await step('lab.supervisor', 'Clinical validation', (u) =>
  u.call('POST', `/api/laboratory/results/${resultId}/clinical-validation`, { hospitalId: H, validatorName: u.name }));
const labReportId = await step('lab.supervisor', 'Laboratory report issued and finalised', async (u) => {
  const report = await u.call('POST', '/api/laboratory/reports', {
    orderId: labOrderId, ...visit, specimenIds: [specimenId], resultIds: [resultId], performerName: u.name,
    conclusion: 'Haemoglobin within normal limits.',
  });
  const id = idOf(report, 'report', 'diagnosticReport');
  await u.call('POST', `/api/laboratory/reports/${id}/finalize`, { verifierName: u.name, conclusion: 'Haemoglobin within normal limits.' });
  return id;
});

console.log('\nRadiology');
await step('radiology.technician', 'Exam scheduled, patient arrived, exam started and acquired', async (u) => {
  for (const workflowStatus of ['scheduled', 'arrived', 'exam-started', 'acquired'])
    await u.call('PATCH', `/api/radiology/orders/${radiologyOrderId}/workflow`, { workflowStatus });
});
await step('radiology.technician', 'X-ray images sent to PACS and linked to the order', async (u) => {
  const order = await u.call('GET', `/api/radiology/orders/${radiologyOrderId}?${q}`);
  const accession = (order.order ?? order).accessionNumber;
  const patient = await u.call('GET', `/api/patients/${patientId}?${q}`);
  sendStudyToPacs(accession, patient.hospitalMrn ?? patientId, `${PATIENT.familyNameEn}^${PATIENT.firstNameEn}`);
  const synced = await u.call('POST', `/api/radiology/pacs/sync/accession/${encodeURIComponent(accession)}?${q}`, { hospitalId: H });
  if (!(synced.studiesFound >= 1)) throw new Error(`PACS has no study for ${accession}`);
  for (const workflowStatus of ['images-available', 'reporting'])
    await u.call('PATCH', `/api/radiology/orders/${radiologyOrderId}/workflow`, { workflowStatus });
});
const radiologyReportId = await step('radiologist', 'Chest X-ray reported and finalised', async (u) => {
  const report = await u.call('POST', '/api/radiology/reports', {
    orderId: radiologyOrderId, ...visit, radiologistName: u.name, technique: 'PA chest radiograph',
    findings: 'Lungs clear. No consolidation or effusion. Normal heart size.', impression: 'No acute cardiopulmonary disease.',
  });
  const id = idOf(report, 'report', 'diagnosticReport');
  await u.call('POST', `/api/radiology/reports/${id}/finalize`, { verifierName: u.name, verificationConfirmed: true });
  return id;
});

console.log('\nPharmacy');
await step('pharmacist', 'Stock received: paracetamol 500 mg', (u) => u.call('POST', '/api/pharmacy/inventory/receive', {
  hospitalId: H, medicationCode: 'PARACETAMOL-500', medicationName: 'Paracetamol 500 mg', form: 'tablet', strength: '500 mg',
  unit: 'tablet', lotNumber: `PCM-${new Date().getFullYear()}-01`, expirationDate: '2028-12-31', quantity: 200, reorderLevel: 20,
}));
await step('pharmacist', 'Prescription verified (allergies, interactions, dose, stock)', (u) =>
  u.call('POST', `/api/pharmacy/prescriptions/${medicationRequestId}/verify`, {
    hospitalId: H, pharmacistName: u.name, allergyChecked: true, interactionChecked: true, doseChecked: true,
    stockChecked: true, decision: 'approved',
  }));
await step('pharmacist', 'Dispensed with counselling', (u) => u.call('POST', '/api/pharmacy/dispense', {
  hospitalId: H, medicationRequestId, quantity: 9, pharmacistName: u.name, counselingProvided: true,
}));

console.log('\nDoctor: results and discharge');
await step('doctor', 'Laboratory and X-ray reports reviewed and acknowledged', async (u) => {
  for (const targetId of [labReportId, radiologyReportId])
    await u.call('POST', '/api/result-reviews', {
      ...visit, targetType: 'DiagnosticReport', targetId, practitionerId: u.id, practitionerName: u.name,
      decision: 'acknowledged', critical: false,
    });
});
await step('lab.technician', 'Orders completed now that the reports are final', async (u) => {
  const lab = await u.call('GET', `/api/laboratory/orders/${labOrderId}?${q}`);
  if (['draft', 'active', 'on-hold'].includes((lab.order ?? lab).status))
    await u.call('PATCH', `/api/laboratory/orders/${labOrderId}/status`, { status: 'completed' });
  const rad = await (await as('radiology.technician')).call('GET', `/api/radiology/orders/${radiologyOrderId}?${q}`);
  if (['draft', 'active', 'on-hold'].includes((rad.order ?? rad).status))
    await (await as('radiology.technician')).call('PATCH', `/api/radiology/orders/${radiologyOrderId}/status`, { status: 'completed' });
});
await step('doctor', 'Discharged home, improved, follow-up in one week', (u) => u.call('PATCH', `/api/encounters/${encounterId}/finish`, {
  hospitalId: H, disposition: 'home', dischargeCondition: 'improved',
  dischargeInstructions: 'Paracetamol as prescribed, plenty of fluids. Return if breathing difficulty or fever over 39 °C.',
  followUpDate: new Date(Date.now() + 7 * 864e5).toISOString(), confirmation: true,
}));
await step('receptionist', 'Follow-up appointment booked', (u) => {
  const start = new Date(Date.now() + 7 * 864e5);
  start.setUTCHours(7, 0, 0, 0); // 10:00 in Amman
  return u.call('POST', '/api/appointments', {
    hospitalId: H, patientId, practitionerId: doctor.id, practitionerName: doctor.name, department: 'Internal Medicine',
    serviceType: 'Follow-up', reason: 'Follow-up after acute pharyngitis', start: start.toISOString(), durationMinutes: 20,
  });
});

console.log('\nBilling');
const invoice = await step('cashier', 'Charges captured from the price list, invoice issued', async (u) => {
  await u.call('POST', `/api/billing/encounters/${encounterId}/capture`, { hospitalId: H });
  return u.call('POST', '/api/billing/invoices', { hospitalId: H, patientId, encounterId });
});
const invoiceId = idOf(invoice, 'invoice');
await step('cashier', 'Paid in cash, receipt issued', async (u) => {
  const account = await u.call('GET', `/api/billing/accounts/${patientId}?${q}`);
  const open = account.invoices.find((i) => i.id === invoiceId);
  await u.call('POST', `/api/billing/invoices/${invoiceId}/payments`, {
    hospitalId: H, amount: open.balance, method: 'cash', reference: `RCPT-${Date.now().toString().slice(-6)}`,
  });
});

console.log('\nMedical records');
const recordId = await step('medical.records', 'Record checked for deficiencies, closed and signed', async (u) => {
  await u.call('POST', `/api/medical-records/encounters/${encounterId}/assess`, { hospitalId: H, ownerId: doctor.id, ownerName: doctor.name });
  const view = await u.call('GET', `/api/medical-records/encounters/${encounterId}?${q}`);
  for (const d of (view.deficiencies ?? []).filter((x) => !['completed', 'cancelled'].includes(x.status)))
    await u.call('PATCH', `/api/medical-records/deficiencies/${d.id}/resolve`, { hospitalId: H, resolutionNote: 'Completed by the treating doctor.' });
  const closed = await u.call('POST', `/api/medical-records/encounters/${encounterId}/close`, {
    hospitalId: H, practitionerId: doctor.id, practitionerName: doctor.name, confirmation: true,
  });
  return idOf(closed, 'record', 'composition');
});
await step('medical.records', 'Record locked and archived', async (u) => {
  await u.call('POST', `/api/medical-records/${recordId}/lock`, { hospitalId: H, himOfficerId: u.id, himOfficerName: u.name, confirmation: true });
  await u.call('POST', `/api/medical-records/${recordId}/archive`, { hospitalId: H, archivistId: u.id, archivistName: u.name, confirmation: true });
});

// ---- Result -------------------------------------------------------------------------
const journey = await doctor.call('GET', `/api/patient-journey/${patientId}/encounters/${encounterId}?${q}`);
const account = await (await as('cashier')).call('GET', `/api/billing/accounts/${patientId}?${q}`);
const inv = account.invoices.find((i) => i.id === invoiceId);
console.log(`\nJourney: ${journey.completion}% of mandatory milestones (${journey.pathway?.label}), stage ${journey.currentStage}`);
console.log('  ' + journey.nodes.map((x) => `${x.key}:${x.state}`).join('  '));
console.log(`Invoice ${inv.identifier}: total ${inv.total} ${inv.currency}, paid ${inv.paid}, balance ${inv.balance} (${inv.status})`);
for (const s of Object.values(sessions)) await s.call('POST', '/api/auth/logout').catch(() => undefined);
const ok = journey.completion === 100 && inv.balance === 0;
console.log(ok ? '\nCOMPLETE' : '\nINCOMPLETE');
process.exitCode = ok ? 0 : 1;

/** Plays the X-ray machine: uploads a sample image to Orthanc, tagged with the order's accession number. */
function sendStudyToPacs(accession, mrn, patientName) {
  const container = need('DEMO_ORTHANC_CONTAINER');
  const dicom = process.env.DEMO_DICOM_FILE ?? resolve(here, '../../../dicom-test/ct-test.dcm');
  execFileSync('docker', ['cp', dicom, `${container}:/tmp/demo-study.dcm`]);
  const py = [
    'import base64,json,sys,urllib.request as u',
    'pw=sys.stdin.read().strip()',
    "h={'Authorization':'Basic '+base64.b64encode(('hospital-api:'+pw).encode()).decode()}",
    "def call(m,p,b=None,ct=None):",
    "  r=u.Request('http://127.0.0.1:8042'+p,data=b,method=m,headers=dict(h,**({'Content-Type':ct} if ct else {})))",
    '  return json.load(u.urlopen(r))',
    "up=call('POST','/instances',open('/tmp/demo-study.dcm','rb').read(),'application/dicom')",
    `body=json.dumps({'Replace':{'AccessionNumber':${JSON.stringify(accession)},'StudyID':${JSON.stringify(accession)},'PatientID':${JSON.stringify(mrn)},'PatientName':${JSON.stringify(patientName)},'StudyDescription':'Chest X-ray'},'Force':True}).encode()`,
    "call('POST','/studies/'+up['ParentStudy']+'/modify',body,'application/json')",
    "call('DELETE','/studies/'+up['ParentStudy'])",
  ].join('\n');
  execFileSync('docker', ['exec', '-i', container, 'python3', '-c', py], {
    input: readFileSync(need('DEMO_ORTHANC_PASSWORD_FILE')),
  });
}
