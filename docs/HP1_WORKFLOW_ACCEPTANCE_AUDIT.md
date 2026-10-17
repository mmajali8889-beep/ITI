# Hospital One — Complete Workflow Acceptance Audit

Audit date: 2026-09-26  
Scenario: `HP1-UAT-2026-001`  
Decision: **FUNCTIONALLY ACCEPTED IN AUTOMATED TESTS; LIVE ENVIRONMENT ACCEPTANCE STILL REQUIRED**

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
