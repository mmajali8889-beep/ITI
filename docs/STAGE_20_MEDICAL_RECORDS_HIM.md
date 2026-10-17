# Stage 20 — Medical Records / HIM

## Implemented workflow

1. Only a `finished` Encounter can enter HIM review.
2. Review checks primary diagnosis, signed clinical note, open orders, unreviewed final results, and financial closure.
3. Missing requirements create hospital-scoped FHIR `Task` resources in the deficiency queue.
4. A completed record is finalized as a FHIR `Composition` with an explicit electronic-attestation extension.
5. A FHIR `Provenance` resource records signer, time, intent and SHA-256 content evidence.
6. HIM lock is allowed only after signature.
7. Archive is allowed only after lock and may include a retention-until date.
8. Corrections after finalization use an appended `Composition`; the original is not overwritten.
9. Every Medical Records API read and every mutation is recorded as an `AuditEvent` by the global audit interceptor.

## Isolation and acceptance controls

- Every encounter, deficiency and record is matched to the requested hospital organization.
- Cross-hospital reads return not found rather than exposing existence.
- The queue filters completed encounters and records by hospital.
- Automated tests cover attestation provenance, lock/archive ordering, retention metadata, hospital queue isolation, and read-access auditing.

The current electronic attestation is application-level and stores signer intent plus digest evidence. A legally qualified digital signature still requires the production identity provider, certificate/private-key custody, approved signature policy, and jurisdiction-specific validation.
