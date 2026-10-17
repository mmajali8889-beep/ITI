# Stage 21 — Patient Portal

The portal provides hospital-scoped, read-only patient access to appointments, released laboratory results, final radiology reports, prescriptions, diagnoses, discharge summaries, finalized medical reports, invoices, payments, insurance coverage, and notifications.

Security controls:

- A Patient-authenticated session can request only the Patient resource matching its profile ID.
- The existing authenticated hospital boundary is enforced by the global guard.
- Clinical content linked to an Encounter is included only when that Encounter belongs to the authenticated hospital.
- Preliminary diagnostic results and entered-in-error content are not released.
- Portal reads are captured by the global audit interceptor.
- Staff profiles can use the same endpoint for an authorized portal preview; production authorization should additionally bind this to explicit RBAC permissions.

The portal is intentionally read-only in this stage. Online payment, appointment self-service, messaging replies, proxy access, consent restrictions, and guardian/dependent access require separate workflows and policy decisions.
