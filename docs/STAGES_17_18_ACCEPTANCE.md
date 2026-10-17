# Stages 17–18 — Bed Management and Discharge acceptance

## Bed lifecycle

The central board groups beds as Hospital → Floor → Ward → Room → Bed and supports `available`, `occupied`, `reserved`, `cleaning`, `dirty`, `blocked`, `maintenance` and `isolation`. Invalid transitions are rejected. Transfer marks the previous bed dirty; discharge marks the released bed dirty; housekeeping must complete `dirty → cleaning → available`.

## Discharge gates

Final discharge requires medication reconciliation, a final FHIR `Composition` discharge summary, no active clinical orders, a balanced encounter invoice, and positive Billing, Pharmacy and Nursing clearances. The summary contains admission reason, diagnoses, procedures, hospital course, investigations, discharge medications, condition, instructions and follow-up. Finalization closes the encounter/location and sends the bed to cleaning workflow.

Automated tests validate bed-state transitions, discharge gating and summary completeness. Production UAT still requires departmental identities, real appointment creation from follow-up, housekeeping mobile acknowledgement and local financial/pharmacy clearance policies.
