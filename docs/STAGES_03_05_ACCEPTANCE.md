# Stages 3–5 — Implementation and Acceptance Record

## Scope

This record covers Reception / Visit Creation, Insurance & Eligibility, and Triage for the first hospital rollout.

## Stage 3 — Reception / Visit Creation

- Every accepted reception transaction creates one FHIR R4 `Encounter` with a hospital-scoped visit number.
- Supported visit types: OPD, Emergency, Inpatient, Day Case, Laboratory-only, Radiology-only, Procedure, plus the legacy Diagnostic type.
- The Encounter links the patient, facility, department, physician, appointment and downstream services through FHIR references.
- Active-encounter duplication and cross-hospital patient use are rejected.
- Every new Encounter starts with an explicit financial-clearance state. Emergency visits receive a documented emergency override; other visits remain pending until classified.

## Stage 4 — Insurance & Eligibility

- FHIR `Coverage` stores payer, member/policy, plan, network, validity period, deductible, co-pay, coverage percentage, currency and default pre-authorization requirement.
- The encounter supports Cash, Insurance, Corporate and Government financial classes.
- Insurance classification requires active coverage belonging to the patient and hospital. Corporate/Government classification requires a sponsor.
- Financial-clearance rule. Only the Insurance class has an eligibility flow, so classification sets clearance as follows:
  - An `emergency-override` is never changed by classification.
  - Cash is `cleared` immediately.
  - Corporate and Government are `cleared` once classification records the sponsor. The sponsor contract is the payment guarantee, and there is no payer eligibility check for these classes. An encounter opened as Corporate/Government starts `pending-classification` until the sponsor is recorded.
  - Insurance is `pending-eligibility` until a payer decision is recorded. Re-classifying an encounter that is already Insurance with the same coverage keeps the existing decision (`cleared`, `pending-authorization` or `denied`). Changing the coverage, or switching to Insurance from another class, resets it to `pending-eligibility`, because the earlier decision no longer applies.
- FHIR `CoverageEligibilityRequest` records service codes, encounter, provider network and estimated amount.
- An eligible decision requires benefit and network verification. Authorization is required only when the payer decision says pre-authorization is required.
- The response records authorization number/limit, remaining deductible, co-pay, coverage percentage and patient responsibility.
- The Encounter clearance becomes `cleared`, `pending-authorization`, or `denied` from the eligibility decision.

## Stage 5 — Triage

- The nurse records chief complaint, BP, pulse, temperature, respiratory rate, SpO2, weight, height, calculated BMI and pain score as FHIR `Observation` resources.
- Triage requires an explicit allergy check and medication-history review.
- Consciousness, mobility, isolation, current medications, risk flags/notes and triage notes are retained on the Encounter.
- Critical observations generate alerts and determine Encounter priority.
- Completion changes the Encounter to `triaged` and creates one FHIR `Task` in the doctor queue; duplicate ready/in-progress queue tasks are prevented.
- Patient, Encounter and hospital references are checked before data is written.

## Automated acceptance

Run from `services/hospital-api`:

```text
npm test -- --runInBand
npm run test:e2e -- --runInBand
npm run build
```

Run from `apps/ehr-web`:

```text
npm run build
```

Automated acceptance does not replace payer-network certification, production authorization rules, security testing, clinical governance approval, or supervised end-user UAT.
