# Stage 10 — Emergency Department Acceptance Record

## Dedicated ED workflow

- Emergency encounters use FHIR Encounter class `EMER` and a dedicated live tracking board.
- Known patients can be searched and registered normally.
- Unknown or unstable patients can receive a temporary MRN and unverified emergency identity with incomplete registration; care starts immediately without insurance.
- Emergency encounters carry a documented financial `emergency-override`, allowing laboratory, radiology, medication, procedure and consultation orders before financial clearance.
- Triage records severity 1–5, vitals, allergies, medication history and risks, then creates the doctor queue task.
- ED bed assignment records the active Location and closes prior bed-location periods.
- Reassessments create FHIR Observations with severity, clinical trend, clinician, note and timestamp; Encounter priority is updated.
- Doctor assessment and all downstream order modules remain patient/Encounter/hospital scoped.

## Disposition

Supported outcomes are Home, Admit, ICU, Operating Room, Transfer, Referral, Left Against Medical Advice, Left Without Being Seen and Death.

Clinical diagnosis and signed-note completion gates remain mandatory except for a genuine ED `left-without-being-seen` event. Transfer requires a destination. The audit interceptor records all mutating workflow calls.

## Deployment acceptance

Hospital-specific triage policy, resuscitation workflows, ambulance interfaces, disaster/mass-casualty mode and supervised ED UAT remain environment and governance activities.
