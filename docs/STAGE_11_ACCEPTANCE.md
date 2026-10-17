# Stage 11 — Admission / Inpatient Acceptance Record

## Admission workflow

1. Physician creates a hospital-scoped FHIR `Task` admission request linked to Patient and source Encounter.
2. The Admission Office approves or rejects the request and records officer, note and timestamp.
3. Insurance authorization is recorded as approved, denied or not required; approved insurance requires an authorization number.
4. A bed request cannot be created until office approval and authorization are complete.
5. Bed assignment cannot bypass the completed admission request and bed-request gates.
6. The source Encounter is converted to class `IMP`, status `in-progress`, with admission reason and active bed Location.
7. The admission Task completes with the assigned bed reference.
8. Transfers close the prior Location period and activate the target bed while retaining the transfer reason.

## Bed management and safety

- Beds are hospital-scoped FHIR Locations with ward, room and bed identity.
- The live census groups Hospital → Ward → Room → Bed and reports capacity and occupancy.
- A bed cannot be assigned to two active encounters.
- A patient/Encounter/admission request cannot cross the hospital boundary.
- Occupied beds appear red and available beds green in the visual board.

## Deployment acceptance

Production payer authorization interfaces, housekeeping/bed-cleaning states, isolation cohorts and supervised Admission Office/ward UAT remain environment-specific acceptance activities.
