# Stage 1–2 Acceptance — Hospital One

## Stage 1: Patient Registration / MPI — PASS

- One hospital-scoped patient search supports national ID, passport, MRN, phone, identifier, and name.
- Existing records are returned for verification; duplicate authoritative identifiers block registration.
- New registration creates or accepts a hospital MRN and captures Arabic/English names, DOB, gender, nationality, address, telecom, next of kin, and optional photo.
- Next of kin is represented both as `Patient.contact` for rapid display and as a linked FHIR `RelatedPerson`.
- Optional insurance creates a hospital-scoped FHIR `Coverage`.
- Optional known allergy alerts create FHIR `AllergyIntolerance` records.
- The patient remains the master identity; all linked resources reference the created Patient.

## Stage 2: Appointment & Scheduling — PASS with external delivery dependency

- FHIR chain implemented: `Schedule → Slot → Appointment → Encounter`.
- Schedules are scoped by hospital, practitioner, specialty, service, and planning horizon.
- Slot generation rejects overlap and exposes only free slots matching hospital/date/doctor/specialty.
- Booking reserves a slot, conflict checks patient/provider time, and marks the slot busy.
- Workflow states: booked, confirmed, arrived, checked-in, in-progress through the linked Encounter, and fulfilled/completed.
- Cancelled and no-show require controlled transitions; cancellation releases the slot.
- Rescheduling reserves the new slot, releases the old slot, and records the reason.
- Booking, confirmation, cancellation, and rescheduling create FHIR `Communication` notification records.
- Actual SMS transmission requires configuration of an SMS provider/connector; the application notification event and audit trail are present.

Production acceptance still requires concurrent double-booking tests against the live Medplum server and an enabled SMS provider delivery receipt.
