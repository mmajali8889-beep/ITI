# Complete Patient Journey

The Encounter workspace now includes a Patient Journey tab assembled from the existing FHIR resources. It does not maintain a second workflow state. Instead, it derives each milestone from source-of-truth resources such as `Encounter`, `Appointment`, `Coverage`, `Observation`, `Condition`, `ServiceRequest`, `DiagnosticReport`, `MedicationRequest`, `MedicationDispense`, `Task`, `Procedure`, `CarePlan`, `Composition`, `Invoice`, and `Claim`.

Each node is classified as completed, current, pending, or not applicable. Optional branches such as laboratory, radiology, pharmacy, admission, surgery, ICU and procedures do not incorrectly block a journey when they were never ordered or selected.

Controls:

- The encounter must belong to both the requested Patient and authenticated hospital.
- Preliminary results do not satisfy the result milestone.
- Doctor review is derived from completed result-review tasks.
- Billing completion, medical-record completion and follow-up remain distinct milestones.
- Every journey read is audited.

The completion percentage is an operational completeness indicator, not a clinical-quality score. A production deployment should configure pathway-specific mandatory milestones by service line rather than using one universal pathway for every case.
