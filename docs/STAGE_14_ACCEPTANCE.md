# Stage 14 — Surgery / Operating Theatre acceptance

## Controlled perioperative states

`requested → authorized → scheduled → pre-op-assessed → anesthesia-assessed → consented → pre-op-check-complete → in-or → who-check-complete → anesthesia-started → procedure-in-progress → procedure-completed → pacu → completed`

The backend rejects skipped stages. Cancellation is allowed only before closure and remains in the audit history.

## FHIR R4 model

- `Task`: surgery case, current workflow state, team, schedule and transition history.
- `QuestionnaireResponse`: pre-op assessment, anesthesia assessment, pre-op checklist and WHO Surgical Safety Checklist.
- `Consent`: active treatment consent linked to the surgery case and hospital.
- `Procedure`: completed operation including surgeon, assistant, anesthesiologist, nurses, OR, performed period, complication list, implants, medications and consumables.
- `Encounter`, `Patient`, `Location` and `Organization` references provide clinical and tenant context.

## Acceptance path

1. Create a surgery request for an active encounter and specify the primary surgeon and procedure.
2. Record pre-authorization; an authorization number is mandatory.
3. Schedule an operating room with valid start and end times.
4. Complete pre-op and anesthesia assessments, consent and pre-op checklist.
5. Mark arrival in OR and complete the WHO checklist before anesthesia or incision.
6. Start anesthesia and procedure, then document the operative result, implants, medications, consumables and complications.
7. Move to PACU and select Ward, ICU or Discharge as final destination.
8. Verify another hospital cannot read or transition the case.

Automated tests validate transition order, required gates, FHIR supporting records and hospital isolation. Production UAT still requires approved consent content, local WHO checklist, OR/location catalog, implant traceability policy and pharmacy/inventory integration.
