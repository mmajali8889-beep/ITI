# Stage 9 — Pharmacy and eMAR Acceptance Record

## Outpatient pharmacy

1. Physician prescription creates a hospital-scoped FHIR `MedicationRequest`.
2. Active prescriptions enter the pharmacy queue.
3. Pharmacist approval requires explicit allergy, interaction, dose and stock checks.
4. Rejection stops the order; clarification places it on hold and requires issue details.
5. Dispensing is blocked until clinical verification succeeds.
6. FEFO stock allocation uses valid non-expired batches and prevents negative stock.
7. Outpatient dispensing requires patient-counseling confirmation and records counseling details.
8. Completed `MedicationDispense` records retain prescription, patient, encounter, pharmacist, quantities and batch allocations.

## Inpatient medication and eMAR

1. The same medication order requires pharmacist verification.
2. A ward supply is represented by `MedicationDispense` with a ward/location reference.
3. The eMAR endpoint returns encounter medication orders, verification state and administrations.
4. The nurse records `given`, `held`, `refused` or `missed`; all non-given outcomes require a reason.
5. `given` requires both patient and medication scans.
6. BCMA verifies the patient barcode against the Patient identifiers and the medication barcode against the batch actually supplied for the prescription.
7. Administration creates FHIR `MedicationAdministration` with nurse, dose, route, time, outcome and scan evidence.

## Remaining deployment acceptance

Production drug-interaction knowledge-base integration, pediatric/renal dose rules, barcode hardware validation, formulary governance and supervised pharmacy/nursing UAT require the hospital environment and clinical policy owners.
