# Stage 15 — ICU acceptance

## Delivered workflow

- ICU admission requires an active inpatient `Encounter` and an ICU location.
- Continuous/high-frequency observations use typed FHIR `Observation` records with LOINC where available.
- Ventilator mode, FiO2, PEEP and tidal volume are supported.
- Intake, output and calculated/documented fluid balance are supported.
- Active infusions use `MedicationAdministration` with rate, unit, dose, performer and effective period.
- ABG values include pH, PaO2, PaCO2 and lactate.
- GCS, SOFA and APACHE II scores are supported.
- Daily ICU problems, goals and interventions use `CarePlan`.
- Transfer/discharge supports Ward, another ICU, discharge or death with mandatory handover note.
- Dashboard highlights acuity-1 patients, ventilation, active infusions and missing daily plans.

## Acceptance path

1. Admit a patient with an active inpatient encounter to an ICU location.
2. Record frequent vitals, ventilator settings, ABG, fluid balance and severity scores.
3. Start an infusion and verify rate/unit are visible on the ICU card.
4. Add the daily plan with problems, goals and interventions.
5. Transfer or discharge the patient with a clinical handover note.
6. Verify observations cannot be recorded before ICU admission and another hospital cannot access the admission.

Automated tests cover admission, active-context enforcement, observation/infusion persistence and tenant isolation. Production integration still requires bedside device feeds, alarm management, validated score calculators, ICU location catalog and local critical-care protocols.
