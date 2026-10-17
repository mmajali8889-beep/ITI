# Stage 12 — Nursing / Ward acceptance

## Delivered workflow

The nursing module accepts documentation only for an active `IMP` inpatient `Encounter` belonging to the selected hospital and patient.

| Workflow capability | FHIR R4 representation | Acceptance evidence |
|---|---|---|
| Nursing admission assessment | `QuestionnaireResponse` | Confirmation required; duplicate assessment blocked per encounter |
| Care plan, goals and interventions | `CarePlan` | Active plan linked to patient and inpatient encounter |
| IV/fluids, intake/output and ongoing monitoring | `Observation` | Typed observation with timestamp, performer and hospital boundary |
| Pain, fall and pressure-injury risk | `Observation` | Pain constrained to 0–10; risk scores cannot be negative |
| Nursing notes | `DocumentReference` (LOINC 34746-8) | UTF-8 clinical note linked to encounter |
| Required and overdue work | `Task` | Due time, priority, owner, completion and audit-ready output |
| Ward dashboard | Aggregated live read model | Patients, work due, overdue, assessment gaps and care-plan gaps |
| Medication administration | Existing Stage 9 `MedicationAdministration` / eMAR | Remains the authoritative medication administration workflow |

## Acceptance scenarios

1. Admit and assign a patient to a bed through Stage 11.
2. Open **Nursing / Ward** and verify ward, room and bed placement.
3. Complete the admission assessment and create a care plan.
4. Record pain, fall risk, pressure risk, IV/fluids, intake/output and monitoring observations.
5. Create care tasks with future and elapsed deadlines; elapsed open tasks must appear red and contribute to the overdue count.
6. Complete a task and verify it disappears from the open workload after refresh.
7. Open the patient chart from the card and use the Stage 9 eMAR for Given / Held / Refused / Missed medication documentation.
8. Attempt cross-hospital documentation and documentation against a non-inpatient encounter; both must be rejected.

## Scope note

Automated tests validate service rules and aggregation. A production acceptance run still requires a connected Medplum environment, representative clinical users, configured wards and the hospital's approved nursing assessment forms and scoring policies.
