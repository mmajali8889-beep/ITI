# Stage 22 — Administration and RBAC

## Implemented

- Server-enforced role metadata and a global RBAC guard.
- Login-time role resolution from active FHIR `PractitionerRole` resources.
- Development administrator receives only the `system-administrator` role outside production.
- Administration endpoints require `administrator` or `system-administrator`.
- Audit log access allows administrator, system administrator, or medical-records roles.
- Role definitions use hospital-scoped FHIR `Group` resources; assignments use `PractitionerRole`.
- Practitioner profile provisioning, role assignment, and duplicate-assignment prevention.
- Governed catalogs for facilities, departments, clinics, schedules, services, price lists, insurance contracts, beds, formulary, laboratory, radiology, templates, and reference data.
- Administrative reads and writes generate audit events.

## FHIR resource mapping

| Configuration | FHIR resource |
| --- | --- |
| Facility / department / clinic | `Organization` |
| Practitioner | `Practitioner` + `PractitionerRole` |
| Schedule | `Schedule` |
| Service | `HealthcareService` |
| Price list | `ChargeItemDefinition` |
| Insurance contract | `Contract` |
| Bed | `Location` |
| Drug formulary | `MedicationKnowledge` |
| Lab / radiology catalog | `ActivityDefinition` |
| Clinical template | `Questionnaire` |
| Reference data | `CodeSystem` |

Creating a Practitioner profile does not create login credentials. Production identity invitations, MFA enrollment, account recovery, segregation-of-duties approval, and emergency access require integration with the production identity provider and Medplum membership/access-policy administration.
