# Hospital One — Complete Workflow Acceptance Audit

Audit date: 2026-09-26 (live acceptance added 2026-10-17)  
Scenario: `HP1-UAT-2026-001`  
Decision: **ACCEPTED ON THE DEDICATED UAT TENANT (HOSP-01) — live workflow, security, concurrency, performance and backup/restore gates passed; approved by the project owner on 2026-10-17.** See [Live environment acceptance](#live-environment-acceptance-2026-10-17).

This audit checks the requested patient journey from arrival through reporting. It distinguishes an implemented workflow from a screen or a stored FHIR resource. A stage passes only when the repository contains an actionable API workflow and its required transition controls.

## Acceptance result

| # | Required gate | Result | Repository evidence / gap |
|---|---|---|---|
| 1 | Identification / registration | PASS | Patient create, search, hospital MRN, and duplicate search exist. |
| 2 | Visit / encounter creation | PASS | OPD, emergency, inpatient, day case, and procedure/diagnostic encounter types are supported with explicit FHIR class/type mappings. |
| 3 | Insurance / eligibility / financial class | PASS | Hospital-scoped coverage, payer/member data, eligibility requests and decisions, history, and encounter financial classification now exist. |
| 4 | Triage / initial assessment | PASS | Vitals plus emergency priority/board workflow exist. |
| 5 | Doctor / clinical assessment | PASS | Diagnoses, clinical notes/signing, medication requests, lab/radiology orders, and disposition decision exist. |
| 6 | Orders, services, pharmacy | PASS | Laboratory, radiology, pharmacy, procedures, consultations, and other-service orders exist with controlled status transitions. |
| 7 | Results / reporting | PASS | Laboratory results/reports and radiology reports/finalization exist. |
| 8 | Doctor review | PASS | Final results can be acknowledged or marked action-required with reviewer, timestamp, encounter, critical flag, and mandatory critical-result note. |
| 9 | Disposition | PASS | Discharge, follow-up date, referral, admission, transfer, and death are represented; diagnosis and signed-note gates are enforced. |
| 10 | Billing / claim | PASS | Charge capture, invoice generation, payment reconciliation, claim submission, adjudication, denial handling, and hospital-scoped summaries exist. |
| 11 | Medical record completion | PASS | Automated deficiency assessment, owned deficiency tasks, resolution, final lock/close, and append-only authorized amendments exist. |
| 12 | Reporting / audit / analytics | PASS | Mutating API operations generate hospital-scoped FHIR AuditEvent records, with audit retrieval and consolidated operational/clinical/financial overview. |

Raw gate score: **12 PASS + 0 PARTIAL + 0 FAIL**. Automated contract coverage is **100% (12/12)**. This means the requested workflow capabilities are represented and tested in code; production acceptance still requires the live Medplum scenario, security/performance testing, and clinical-owner sign-off.

## Test data and automation

- Test fixture: `services/hospital-api/test/fixtures/hp1-workflow.acceptance.json`
- Executable contract audit: `services/hospital-api/test/hp1-workflow.acceptance.e2e-spec.ts`
- The data uses an HP1-only MRN and synthetic identifiers. It must never be treated as a real patient.
- The automated audit deliberately asserts missing gates. It prevents the incomplete workflow from being described as 100% complete while allowing CI to remain green.

## Mandatory migration order

1. Run the complete synthetic scenario against the dedicated Hospital One Medplum test tenant, including cash, insurance, corporate, government, emergency, inpatient, transfer, and death branches.
2. Execute authorization, penetration, concurrency, backup/restore, and performance acceptance tests.
3. Obtain clinical, HIM, revenue-cycle, pharmacy, laboratory, radiology, and security owner sign-off before production activation.

## Safety and isolation acceptance rules

- Every resource and query must be constrained by `hospitalId`; a missing hospital scope is a test failure.
- Cross-hospital identifiers must return not-found/forbidden and must not reveal whether a record exists.
- Clinical completion, financial completion, and medical-record completion are separate states.
- A claim or invoice must never be inferred merely because an encounter is finished.
- Audit history must be append-only from the application perspective and include actor, action, patient/encounter, hospital, timestamp, and outcome.

## Live environment acceptance (2026-10-17)

Environment: local Medplum 5.1.30 (`localhost:8103`) and hospital-api, with `ACTIVE_HOSPITAL_CODE=HOSP-01`.
Dedicated UAT hospitals **HOSP-01, HOSP-02 and HOSP-03** were created by `scripts/create-test-hospitals.mjs` under the EHR Healthcare Group. Each has 8 departments and a main building, and every resource is tagged `environment=uat`.
All test patients are synthetic, named `UAT-…`/`Run<runId>`, and were created only in HOSP-01.

| Gate | Tool (in `services/hospital-api/test/live/`) | Result |
|---|---|---|
| 1. Complete synthetic scenario: insured outpatient path plus cash, corporate, government, emergency (unknown patient), inpatient with bed transfer and discharge, transfer-out and death branches | `hp1-live-uat.mjs` | **99 / 99 PASS** on HOSP-01 (isolation checked against HOSP-02) |
| 2a. Authorization and penetration: authentication, forged/expired/replayed tokens, cookie flags, cross-hospital isolation (26 probes), role-based access (21), input handling, CORS and headers, brute-force throttling | `security-uat.mjs` | **78 / 78 PASS** |
| 2b. Concurrency: parallel registration (unique MRNs), parallel visit opening, double payment, two admissions to one bed, double claim adjudication | `load-concurrency-uat.mjs` | **6 / 6 PASS** |
| 2c. Performance: 120 reads, 6 in parallel, across 8 key endpoints | `load-concurrency-uat.mjs` | **PASS**: 0 errors, every p95 ≤ 232 ms (target < 1 s) |
| 2d. Backup / restore | `pg_dump` → restore into a scratch database | **PASS**: 11 MB dump in 2 s and restore in 16 s; record counts for 13 resource types and full-content checksums for 8 clinical/financial tables are identical; scratch database dropped afterwards |
| 3. Owner sign-off | — | **Approved** (see below) |

### Defects found by the live gates and fixed

| Severity | Defect | Fix |
|---|---|---|
| Critical | Patient registration always failed: `Basic.created` (MRN counter) was written as a dateTime | Write a FHIR `date` |
| Critical | Every payment failed: `PaymentReconciliation.paymentDate` was written as a dateTime | Write a FHIR `date` |
| Critical | Parallel registrations got the **same MRN** (6 patients shared one): the counter update had no optimistic lock | `MedplumService.updateIfUnchanged` (If-Match) with retry |
| Critical | Cross-hospital reads: radiology, medications and vitals by patient or encounter, and the portal, returned another hospital's records | Global `HospitalScopeGuard`: every `patientId`/`encounterId` must belong to the session hospital (404 otherwise) |
| Critical | Double payment, double bed admission and double claim adjudication under parallel requests | Guarded (If-Match) updates on invoice, bed and claim; bed and claim are claimed before any other write |
| High | Several parallel visits could be opened for one patient | Short per-patient visit lock (guarded) and a status-filtered active-visit search |
| High | Any staff role could open any patient's portal; a receptionist could read hospital-wide analytics | Portal limited to the patient (and system administrators); `/analytics` requires `administration` |
| High | Bed transfer always failed and left beds inconsistent | Pass `patientId`; occupy the target bed before moving the encounter |
| High | Audit retrieval missed a hospital's recent events once other hospitals had older ones | Search `AuditEvent` by `source` and `-date` on the server |
| Medium | Hospital list dropped hospitals beyond the first 20 Organizations | Filter by type on the server, `_count=200` |
| Medium | Medplum sign-in throttling was reported as "invalid username or password" | Return 429 `SIGN_IN_THROTTLED` |
| Low | `X-Powered-By: Express` disclosed; no `X-Content-Type-Options` | Header removed; `nosniff` set |

### Known limits and residual risks

- **Sign-in throttling is per client address (Medplum).** Behind a shared hospital NAT, one user's repeated failures can briefly block sign-in for others on that network. The exact threshold was not measured: earlier test runs had already used up the budget for this address. *Update 2026-10-17:* the API now locks the individual account after 5 failed sign-ins (15 minutes, 423 `ACCOUNT_LOCKED`), so an attacker is stopped before Medplum's per-address limit. Allow-listing internal addresses at the Medplum layer remains advisable (see `docs/ROADMAP.md` 24.1 and 24.4).
- **Medplum rate limit (about 50,000 points per minute):** the API now returns 503 rather than 500; the UAT scripts pace themselves (`HP1_STEP_DELAY_MS`).
- **Single active hospital per API instance** (`ACTIVE_HOSPITAL_CODE`), so cross-hospital tests use one signed-in hospital and a foreign record set.
- **The patient-portal login path** (a Patient profile session) was not exercised live; it is covered by the controller rule and the frontend route guard.
- **The development admin login** (`admin`/`admin` unless `DEV_ADMIN_*` is set) is disabled only by `NODE_ENV=production`. Make sure production sets it.
- **Penetration testing was scripted (OWASP-style probes)**, not a third-party manual test.

### Sign-off

| Role | Decision | Date |
|---|---|---|
| Project owner (Mohammad Almajali), on behalf of clinical, HIM, revenue-cycle, pharmacy, laboratory, radiology and security owners | **Approved** | 2026-10-17 |
