# Stage 13 — Physician Inpatient Rounds acceptance

## Delivered workflow

- Hospital- and ward-scoped inpatient round list with bed placement and last-round time.
- One encounter timeline combining `Observation`, `DiagnosticReport`, `ServiceRequest`, `MedicationRequest`, `MedicationAdministration`, `DocumentReference`, `Condition` and `CarePlan`.
- Dedicated overnight view calculated from the latest 12 hours.
- Round documentation covering overnight events, examination, progress note, assessment and plan.
- Optional new laboratory, radiology, medication, procedure, consultation or other order from the round form.
- Round note persisted as FHIR `DocumentReference` using LOINC `11506-3`; non-medication orders use `ServiceRequest`, medication orders use `MedicationRequest`.
- Active inpatient and hospital trust-boundary validation before reads or writes.

## Acceptance path

1. Complete Stage 11 admission and bed assignment.
2. Open **Physician Rounds**, filter to the ward and select the inpatient.
3. Confirm that vitals, laboratory, radiology, medication, diagnoses, notes, care plans and orders appear chronologically without opening separate modules.
4. Verify that events from the latest 12 hours appear in Overnight Events.
5. Document examination, progress, assessment and plan and optionally place a new order.
6. Refresh and verify that the signed round appears in the timeline and the patient's last-round time updates.
7. Attempt access using another hospital ID and an ambulatory encounter; both must be rejected.

Automated acceptance covers resource aggregation, round/order creation and trust boundaries. Production UAT still requires connected Medplum data, hospital order catalogs, physician identities and approved note templates.
