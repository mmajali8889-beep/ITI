# Complete Patient Journey

The Encounter workspace now includes a Patient Journey tab assembled from the existing FHIR resources. It does not maintain a second workflow state. Instead, it derives each milestone from source-of-truth resources such as `Encounter`, `Appointment`, `Coverage`, `Observation`, `Condition`, `ServiceRequest`, `DiagnosticReport`, `MedicationRequest`, `MedicationDispense`, `Task`, `Procedure`, `CarePlan`, `Composition`, `Invoice`, and `Claim`.

Each node is classified as completed, current, pending, or not applicable. Optional branches such as laboratory, radiology, pharmacy, admission, surgery, ICU and procedures do not incorrectly block a journey when they were never ordered or selected.

Controls:

- The encounter must belong to both the requested Patient and authenticated hospital.
- Preliminary results do not satisfy the result milestone.
- Doctor review is derived from completed result-review tasks.
- Billing completion, medical-record completion and follow-up remain distinct milestones.
- Every journey read is audited.

The completion percentage is an operational completeness indicator, not a clinical-quality score. Since 27.3 the percentage counts only the milestones that are mandatory on the encounter's care pathway.

## Care pathways (27.3)

Each encounter follows the pathway of its service line, taken from the encounter type chosen at registration (an admitted encounter, class `IMP`, follows the inpatient pathway):

| Pathway | Encounter types |
|---|---|
| Outpatient clinic | outpatient |
| Emergency department | emergency |
| Inpatient admission | inpatient, or any admitted encounter |
| Day case / short stay | day-case |
| Diagnostic only | diagnostic, laboratory-only, radiology-only |
| Procedure visit | procedure |

A milestone that is mandatory on the pathway blocks the journey until it is done. One that is not is shown as **optional**: it is never the current stage and does not count towards completion. Patient/MPI, arrival and encounter are always mandatory. Ordered branches (laboratory, radiology, pharmacy, review, admission) stay not-applicable until something is ordered.

The defaults live in `services/hospital-api/src/patient-journey/journey-pathways.ts` (for example, payer is optional in the emergency department and doctor assessment is optional for a diagnostic-only visit). Each hospital can override them in Administration → Care Pathways (`GET/PUT /api/administration/journey-pathways`, administration permission); the override is a `Basic` resource per hospital. If it cannot be read, the journey uses the defaults. The defaults are a proposal for the clinical team to review.
