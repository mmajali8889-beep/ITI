# Stages 6–7 — Implementation and Acceptance Record

## Stage 6 — Doctor Consultation

- The patient chart exposes patient/encounter context, allergies, medications, prior results and clinical documentation.
- The consultation note records chief complaint, history, review of systems, physical examination, assessment and plan.
- Signing an initial note requires allergy review, medication review and explicit confirmation that previous results were reviewed.
- Signed notes are immutable; corrections use a signed addendum.
- Diagnoses use FHIR `Condition`, support ICD-10 and ICD-11, and distinguish primary from secondary diagnoses.
- The physician can create laboratory, radiology, medication, procedure and consultation orders, plus admission requests, follow-up, sick leave and clinical-document requests.
- Financial clearance is enforced for non-emergency downstream services.

## Stage 7 — Laboratory / LIS Workflow

- A doctor order creates a FHIR `ServiceRequest` and accession workflow.
- Collection creates a FHIR `Specimen` with accession number and machine-readable barcode identifier.
- Specimen workflow distinguishes collected, received, accepted and rejected/recollection states.
- Rejection requires a reason and records whether recollection is required; acceptance requires receipt time.
- Results are FHIR `Observation` resources linked to order, specimen, patient and encounter.
- Technical validation is mandatory before clinical validation.
- Clinical validation releases the result as final.
- A critical result creates a stat FHIR `Task` for clinical notification.
- Critical acknowledgement requires doctor/nurse identity, notification method, read-back confirmation, acknowledger and timestamp; the alert task is then completed.
- All mutations use the existing application audit path and retain hospital scope.

## Automated acceptance commands

From `services/hospital-api`:

```text
npm test -- --runInBand
npm run test:e2e -- --runInBand
npm run build
```

From `apps/ehr-web`:

```text
npm run build
```

External analyzer/OpenELIS messaging, device validation, critical-value policies and production notification channels require environment-specific integration and supervised UAT.
