# Stage 16 — Consultation / Referral acceptance

## Closed-loop workflow

`Request → specialty queue → consultant accepts → assessment/note → recommendations → requester notification`

## FHIR R4 model

- `ServiceRequest`: clinical consultation order, reason, question, priority and requesting physician.
- `Task`: specialty queue, ownership and workflow status.
- `DocumentReference`: consultant assessment, consultation note and recommendations using LOINC `11488-4`.
- `Communication`: completed notification addressed to the original requesting physician with a reference to the consultation note.

The queue sorts emergency (`stat`) first, urgent second and routine last, then oldest first. A consultant must accept a waiting request before documenting a response. Completed and cancelled requests cannot be reopened through the workflow endpoints.

## Acceptance path

1. Submit a routine, urgent or emergency specialty consultation linked to a patient encounter.
2. Verify ordering by priority and request age in the specialty queue.
3. Accept the request as the responsible consultant.
4. Record assessment, note and one or more recommendations.
5. Complete the consultation and verify the `DocumentReference`, completed `ServiceRequest` and requester `Communication` are created.
6. Verify another hospital cannot see, accept or complete the request.

Automated tests cover linked resources, acceptance gating, completion notification and tenant isolation. Production delivery still requires practitioner directory routing, real-time notification channels, escalation SLAs and acknowledgement tracking.
