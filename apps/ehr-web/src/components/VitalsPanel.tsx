import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react';

import {
  Activity,
  AlertTriangle,
  Gauge,
  HeartPulse,
  Ruler,
  Save,
  Scale,
  Thermometer,
  Wind,
  ShieldCheck,
} from 'lucide-react';

import {
  createVitals,
  getEncounterVitals,
} from '../api/vitalsApi';

import type {
  VitalResult,
} from '../types/vitals';

import './VitalsPanel.css';


interface VitalsPanelProps {
  patientId: string;
  encounterId: string;
  hospitalId: string;
  readOnly?: boolean;
}


interface VitalsForm {
  systolic: string;
  diastolic: string;
  pulse: string;
  temperature: string;
  respiratoryRate: string;
  spo2: string;
  weight: string;
  height: string;
  painScore: string;
  triageLevel: string;
  chiefComplaint: string;
  consciousness: string;
  mobility: string;
  isolationRequired: boolean;
  triageNotes: string;
  allergyCheck: 'reviewed-no-known' | 'reviewed-known' | 'unable';
  medicationHistory: 'reviewed' | 'unavailable';
  currentMedications: string;
  riskAssessmentNotes: string;
  triageConfirmed: boolean;
}


type VitalStatus =
  | 'normal'
  | 'high'
  | 'low'
  | 'critical'
  | 'not-recorded';


interface VitalAssessment {
  status: VitalStatus;
  label: string;
  abnormal: boolean;
}


const emptyForm: VitalsForm = {
  systolic: '',
  diastolic: '',
  pulse: '',
  temperature: '',
  respiratoryRate: '',
  spo2: '',
  weight: '',
  height: '',
  painScore: '',
  triageLevel: '3',
  chiefComplaint: '',
  consciousness: 'alert',
  mobility: 'independent',
  isolationRequired: false,
  triageNotes: '',
  allergyCheck: 'reviewed-no-known',
  medicationHistory: 'reviewed',
  currentMedications: '',
  riskAssessmentNotes: '',
  triageConfirmed: false,
};


export default function VitalsPanel({
  patientId,
  encounterId,
  hospitalId,
  readOnly = false,
}: VitalsPanelProps) {

  const [
    form,
    setForm,
  ] =
    useState<VitalsForm>(
      emptyForm,
    );

  const [
    vitals,
    setVitals,
  ] =
    useState<VitalResult[]>(
      [],
    );

  const [
    loading,
    setLoading,
  ] =
    useState(true);

  const [
    saving,
    setSaving,
  ] =
    useState(false);

  const [
    error,
    setError,
  ] =
    useState('');

  const [
    success,
    setSuccess,
  ] =
    useState('');


  useEffect(() => {
    void loadVitals();
  }, [encounterId]);


  async function loadVitals() {
    try {
      setLoading(true);
      setError('');

      const response =
        await getEncounterVitals(
          encounterId,
        );

      setVitals(
        response.vitals ?? [],
      );

    } catch (err) {
      console.error(err);

      setError(
        'Unable to load vital signs.',
      );

    } finally {
      setLoading(false);
    }
  }


  function updateField(
    field: keyof VitalsForm,
    value: string,
  ) {
    setForm(
      (current) => ({
        ...current,
        [field]: value,
      }),
    );
  }


  const bmiPreview =
    useMemo(
      () => {
        const weight =
          Number(
            form.weight,
          );

        const height =
          Number(
            form.height,
          );

        if (
          !weight ||
          !height
        ) {
          return undefined;
        }

        const meters =
          height / 100;

        if (
          meters <= 0
        ) {
          return undefined;
        }

        return (
          weight /
          (
            meters *
            meters
          )
        ).toFixed(1);
      },
      [
        form.weight,
        form.height,
      ],
    );


  async function handleSubmit(
    event:
      FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (readOnly) {
      return;
    }

    setError('');
    setSuccess('');

    if (form.chiefComplaint.trim().length < 3) {
      setError('Chief complaint is required.');
      return;
    }

    if (!form.triageConfirmed) {
      setError('Confirm the triage assessment before saving.');
      return;
    }

    try {
      setSaving(true);

      const payload = {
        patientId,
        encounterId,
        hospitalId,

        systolic:
          toOptionalNumber(
            form.systolic,
          ),

        diastolic:
          toOptionalNumber(
            form.diastolic,
          ),

        pulse:
          toOptionalNumber(
            form.pulse,
          ),

        temperature:
          toOptionalNumber(
            form.temperature,
          ),

        respiratoryRate:
          toOptionalNumber(
            form.respiratoryRate,
          ),

        spo2:
          toOptionalNumber(
            form.spo2,
          ),

        weight:
          toOptionalNumber(
            form.weight,
          ),

        height:
          toOptionalNumber(
            form.height,
          ),

        painScore:
          toOptionalNumber(
            form.painScore,
          ),

        triageLevel: Number(form.triageLevel) as 1 | 2 | 3 | 4 | 5,
        chiefComplaint: form.chiefComplaint.trim(),
        consciousness: form.consciousness as 'alert' | 'voice' | 'pain' | 'unresponsive',
        mobility: form.mobility as 'independent' | 'assisted' | 'stretcher' | 'wheelchair',
        isolationRequired: form.isolationRequired,
        triageNotes: form.triageNotes.trim() || undefined,
        allergyCheck: form.allergyCheck,
        medicationHistory: form.medicationHistory,
        currentMedications: form.currentMedications.trim() || undefined,
        riskAssessmentNotes: form.riskAssessmentNotes.trim() || undefined,
        triageConfirmed: form.triageConfirmed,
      };

      await createVitals(
        payload,
      );

      setForm(
        emptyForm,
      );

      setSuccess(
        'Triage assessment and vital signs saved successfully.',
      );

      await loadVitals();

    } catch (err: any) {
      console.error(err);

      const message =
        err?.response
          ?.data
          ?.message;

      setError(
        Array.isArray(
          message,
        )
          ? message.join(', ')
          : message ||
            'Unable to save vital signs.',
      );

    } finally {
      setSaving(false);
    }
  }


  const latest =
    getLatestVitals(
      vitals,
    );


  const bpAssessment =
    assessBloodPressure(
      latest[
        'blood-pressure'
      ]?.value,
    );


  const pulseAssessment =
    assessPulse(
      latest.pulse
        ?.value,
    );


  const temperatureAssessment =
    assessTemperature(
      latest.temperature
        ?.value,
    );


  const respiratoryAssessment =
    assessRespiratoryRate(
      latest[
        'respiratory-rate'
      ]?.value,
    );


  const spo2Assessment =
    assessSpO2(
      latest.spo2
        ?.value,
    );


  const painAssessment =
    assessPainScore(
      latest[
        'pain-score'
      ]?.value,
    );


  const abnormalCount =
    [
      bpAssessment,
      pulseAssessment,
      temperatureAssessment,
      respiratoryAssessment,
      spo2Assessment,
      painAssessment,
    ].filter(
      (assessment) =>
        assessment.abnormal,
    ).length;


  return (
    <div className="vitals-panel">

      {/* =================================================
          LATEST VITAL SIGNS
      ================================================= */}

      <section className="latest-vitals-section">

        <div className="vitals-section-heading">

          <div>
            <h2>
              Latest Vital Signs
            </h2>

            <p>
              Most recent observations in this encounter
            </p>
          </div>

        </div>


        <div className="latest-vitals-grid">

          <VitalCard
            label="Blood Pressure"
            value={
              latest[
                'blood-pressure'
              ]?.value
            }
            unit={
              latest[
                'blood-pressure'
              ]?.unit
            }
            icon={
              <Gauge size={19} />
            }
            assessment={
              bpAssessment
            }
          />


          <VitalCard
            label="Pulse"
            value={
              latest.pulse
                ?.value
            }
            unit={
              latest.pulse
                ?.unit
            }
            icon={
              <HeartPulse
                size={19}
              />
            }
            assessment={
              pulseAssessment
            }
          />


          <VitalCard
            label="Temperature"
            value={
              latest.temperature
                ?.value
            }
            unit={
              latest.temperature
                ?.unit
            }
            icon={
              <Thermometer
                size={19}
              />
            }
            assessment={
              temperatureAssessment
            }
          />


          <VitalCard
            label="Respiratory Rate"
            value={
              latest[
                'respiratory-rate'
              ]?.value
            }
            unit={
              latest[
                'respiratory-rate'
              ]?.unit
            }
            icon={
              <Wind
                size={19}
              />
            }
            assessment={
              respiratoryAssessment
            }
          />


          <VitalCard
            label="SpO₂"
            value={
              latest.spo2
                ?.value
            }
            unit={
              latest.spo2
                ?.unit
            }
            icon={
              <Activity
                size={19}
              />
            }
            assessment={
              spo2Assessment
            }
          />


          <VitalCard
            label="Weight"
            value={
              latest.weight
                ?.value
            }
            unit={
              latest.weight
                ?.unit
            }
            icon={
              <Scale
                size={19}
              />
            }
          />


          <VitalCard
            label="Height"
            value={
              latest.height
                ?.value
            }
            unit={
              latest.height
                ?.unit
            }
            icon={
              <Ruler
                size={19}
              />
            }
          />


          <VitalCard
            label="BMI"
            value={
              latest.bmi
                ?.value
            }
            unit={
              latest.bmi
                ?.unit
            }
            icon={
              <Scale
                size={19}
              />
            }
          />


          <VitalCard
            label="Pain Score"
            value={
              latest[
                'pain-score'
              ]?.value
            }
            unit={
              latest[
                'pain-score'
              ]?.unit
            }
            icon={
              <Activity
                size={19}
              />
            }
            assessment={
              painAssessment
            }
          />

        </div>


        {/* =============================================
            ABNORMAL VITALS ALERT
        ============================================= */}

        {abnormalCount > 0 && (

          <div className="abnormal-vitals-banner">

            <div className="abnormal-vitals-banner-icon">
              <AlertTriangle
                size={22}
              />
            </div>

            <div className="abnormal-vitals-banner-content">

              <strong>
                Abnormal Vital Signs
              </strong>

              <span>
                {abnormalCount}{' '}
                {abnormalCount === 1
                  ? 'measurement is'
                  : 'measurements are'}{' '}
                outside the configured adult reference range.
              </span>

            </div>

          </div>

        )}

      </section>


      {/* =================================================
          RECORD VITALS
      ================================================= */}

      {!readOnly && (

        <form
          className="vitals-entry-section"
          onSubmit={
            handleSubmit
          }
        >

          <div className="vitals-section-heading">

            <div>
              <h2>
                Record Vital Signs
              </h2>

              <p>
                Enter current patient measurements
              </p>
            </div>

          </div>

          <div className="triage-assessment">
            <div className="triage-assessment-heading">
              <div><span>Triage assessment</span><strong>Clinical priority and presenting complaint</strong></div>
              <ShieldCheck size={20} />
            </div>

            <div className="triage-level-grid">
              {[
                ['1', 'Resuscitation', 'Immediate'],
                ['2', 'Emergent', '≤ 10 min'],
                ['3', 'Urgent', '≤ 30 min'],
                ['4', 'Less urgent', '≤ 60 min'],
                ['5', 'Non-urgent', '≤ 120 min'],
              ].map(([level, label, target]) => (
                <button key={level} type="button" className={`triage-level level-${level} ${form.triageLevel === level ? 'active' : ''}`} onClick={() => updateField('triageLevel', level)}>
                  <b>{level}</b><span>{label}<small>{target}</small></span>
                </button>
              ))}
            </div>

            <label className="triage-field wide"><span>Chief complaint *</span><textarea value={form.chiefComplaint} onChange={(event) => updateField('chiefComplaint', event.target.value)} maxLength={500} rows={3} placeholder="Patient's primary symptom or reason for clinical assessment" /></label>

            <div className="triage-fields-grid">
              <label className="triage-field"><span>Consciousness</span><select value={form.consciousness} onChange={(event) => updateField('consciousness', event.target.value)}><option value="alert">Alert</option><option value="voice">Responds to voice</option><option value="pain">Responds to pain</option><option value="unresponsive">Unresponsive</option></select></label>
              <label className="triage-field"><span>Mobility</span><select value={form.mobility} onChange={(event) => updateField('mobility', event.target.value)}><option value="independent">Independent</option><option value="assisted">Assisted</option><option value="wheelchair">Wheelchair</option><option value="stretcher">Stretcher</option></select></label>
            </div>

            <label className="triage-isolation"><input type="checkbox" checked={form.isolationRequired} onChange={(event) => setForm((current) => ({ ...current, isolationRequired: event.target.checked }))} /><span><strong>Isolation precautions required</strong><small>Flag this encounter for infection prevention precautions.</small></span></label>
            <label className="triage-field wide"><span>Triage notes</span><textarea value={form.triageNotes} onChange={(event) => updateField('triageNotes', event.target.value)} rows={2} placeholder="Relevant observations, onset, mechanism, or immediate actions" /></label>
          </div>


          <div className="vitals-entry-grid">

            <VitalInput
              label="Systolic BP"
              value={
                form.systolic
              }
              unit="mmHg"
              placeholder="120"
              onChange={(
                value,
              ) =>
                updateField(
                  'systolic',
                  value,
                )
              }
            />


            <VitalInput
              label="Diastolic BP"
              value={
                form.diastolic
              }
              unit="mmHg"
              placeholder="80"
              onChange={(
                value,
              ) =>
                updateField(
                  'diastolic',
                  value,
                )
              }
            />


            <VitalInput
              label="Pulse"
              value={
                form.pulse
              }
              unit="bpm"
              placeholder="72"
              onChange={(
                value,
              ) =>
                updateField(
                  'pulse',
                  value,
                )
              }
            />


            <VitalInput
              label="Temperature"
              value={
                form.temperature
              }
              unit="°C"
              placeholder="36.8"
              step="0.1"
              onChange={(
                value,
              ) =>
                updateField(
                  'temperature',
                  value,
                )
              }
            />


            <VitalInput
              label="Respiratory Rate"
              value={
                form.respiratoryRate
              }
              unit="/min"
              placeholder="16"
              onChange={(
                value,
              ) =>
                updateField(
                  'respiratoryRate',
                  value,
                )
              }
            />


            <VitalInput
              label="SpO₂"
              value={
                form.spo2
              }
              unit="%"
              placeholder="98"
              onChange={(
                value,
              ) =>
                updateField(
                  'spo2',
                  value,
                )
              }
            />


            <VitalInput
              label="Weight"
              value={
                form.weight
              }
              unit="kg"
              placeholder="75"
              step="0.1"
              onChange={(
                value,
              ) =>
                updateField(
                  'weight',
                  value,
                )
              }
            />


            <VitalInput
              label="Height"
              value={
                form.height
              }
              unit="cm"
              placeholder="175"
              step="0.1"
              onChange={(
                value,
              ) =>
                updateField(
                  'height',
                  value,
                )
              }
            />


            <VitalInput
              label="Pain Score"
              value={
                form.painScore
              }
              unit="/10"
              placeholder="0"
              min="0"
              max="10"
              onChange={(
                value,
              ) =>
                updateField(
                  'painScore',
                  value,
                )
              }
            />

          </div>

          <div className="vitals-input-grid">
            <label className="vital-input"><span>Allergy Check *</span><select value={form.allergyCheck} onChange={(event) => setForm((current) => ({ ...current, allergyCheck: event.target.value as VitalsForm['allergyCheck'] }))}><option value="reviewed-no-known">Reviewed — no known allergies</option><option value="reviewed-known">Reviewed — known allergies</option><option value="unable">Unable to verify</option></select></label>
            <label className="vital-input"><span>Medication History *</span><select value={form.medicationHistory} onChange={(event) => setForm((current) => ({ ...current, medicationHistory: event.target.value as VitalsForm['medicationHistory'] }))}><option value="reviewed">Reviewed</option><option value="unavailable">Unavailable</option></select></label>
            <label className="vital-input"><span>Current Medications</span><input value={form.currentMedications} onChange={(event) => setForm((current) => ({ ...current, currentMedications: event.target.value }))} placeholder="Medication name, dose and frequency" /></label>
            <label className="vital-input"><span>Risk Assessment</span><input value={form.riskAssessmentNotes} onChange={(event) => setForm((current) => ({ ...current, riskAssessmentNotes: event.target.value }))} placeholder="Falls, sepsis, infection or other risks" /></label>
          </div>

          <label className="triage-confirmation">
            <input type="checkbox" checked={form.triageConfirmed} onChange={(event) => setForm((current) => ({ ...current, triageConfirmed: event.target.checked }))} />
            <span><strong>I confirm this triage assessment is complete.</strong><small>Critical values will be flagged automatically and the encounter status will change to Triaged.</small></span>
          </label>


          {bmiPreview && (
            <div className="bmi-preview">
              Calculated BMI

              <strong>
                {bmiPreview}
              </strong>
            </div>
          )}


          {error && (
            <div className="vitals-message error">
              {error}
            </div>
          )}


          {success && (
            <div className="vitals-message success">
              {success}
            </div>
          )}


          <div className="vitals-form-actions">

            <button
              type="submit"
              className="save-vitals-button"
              disabled={
                saving
              }
            >

              <Save size={16} />

              {saving
                ? 'Saving...'
                : 'Save Vitals'}

            </button>

          </div>

        </form>

      )}


      {/* =================================================
          HISTORY
      ================================================= */}

      <section className="vitals-history-section">

        <div className="vitals-section-heading">

          <div>
            <h2>
              Observation History
            </h2>

            <p>
              All vital sign observations recorded during this encounter
            </p>
          </div>

        </div>


        {loading ? (

          <div className="vitals-empty-state">
            Loading vital signs...
          </div>

        ) : vitals.length === 0 ? (

          <div className="vitals-empty-state">
            No vital signs recorded yet.
          </div>

        ) : (

          <div className="vitals-history-table-wrapper">

            <table className="vitals-history-table">

              <thead>
                <tr>
                  <th>
                    Measurement
                  </th>

                  <th>
                    Value
                  </th>

                  <th>
                    Date / Time
                  </th>
                </tr>
              </thead>


              <tbody>

                {vitals.map(
                  (
                    vital,
                    index,
                  ) => (

                    <tr
                      key={
                        vital.id ??
                        `${vital.type}-${index}`
                      }
                    >

                      <td>
                        {vital.label ??
                          formatVitalType(
                            vital.type,
                          )}
                      </td>


                      <td>

                        <strong>
                          {vital.value ??
                            '-'}
                        </strong>

                        {vital.unit && (
                          <span>
                            {' '}
                            {vital.unit}
                          </span>
                        )}

                      </td>


                      <td>
                        {formatDateTime(
                          vital.effectiveDateTime,
                        )}
                      </td>

                    </tr>

                  ),
                )}

              </tbody>

            </table>

          </div>

        )}

      </section>

    </div>
  );
}


/* =========================================================
   VITAL CARD
========================================================= */

function VitalCard({
  label,
  value,
  unit,
  icon,
  assessment,
}: {
  label: string;

  value?:
    number |
    string;

  unit?: string;

  icon:
    React.ReactNode;

  assessment?:
    VitalAssessment;
}) {

  const hasValue =
    value !== undefined &&
    value !== null &&
    value !== '';


  const effectiveAssessment =
    assessment ??
    (
      hasValue
        ? {
            status:
              'normal' as const,

            label:
              'Normal',

            abnormal:
              false,
          }
        : {
            status:
              'not-recorded' as const,

            label:
              'Not recorded',

            abnormal:
              false,
          }
    );


  const abnormal =
    effectiveAssessment
      .abnormal;


  return (
    <div
      className={
        abnormal
          ? `latest-vital-card vital-card-abnormal vital-${effectiveAssessment.status}`
          : 'latest-vital-card'
      }
    >

      <div
        className={
          abnormal
            ? 'latest-vital-icon abnormal'
            : 'latest-vital-icon'
        }
      >

        {abnormal ? (
          <AlertTriangle
            size={20}
          />
        ) : (
          icon
        )}

      </div>


      <div className="latest-vital-content">

        <span
          className="latest-vital-label"
        >
          {label}
        </span>


        <strong
          className="latest-vital-value"
        >
          {hasValue
            ? value
            : '-'}

          {hasValue &&
            unit && (
              <small>
                {' '}
                {unit}
              </small>
            )}

        </strong>


        {assessment && (
          <span
            className={
              abnormal
                ? `vital-status-badge vital-status-${effectiveAssessment.status}`
                : 'vital-status-badge vital-status-normal'
            }
          >
            {effectiveAssessment.label}
          </span>
        )}

      </div>

    </div>
  );
}


/* =========================================================
   VITAL INPUT
========================================================= */

function VitalInput({
  label,
  value,
  unit,
  placeholder,
  step = '1',
  min,
  max,
  onChange,
}: {
  label: string;

  value: string;

  unit: string;

  placeholder: string;

  step?: string;

  min?: string;

  max?: string;

  onChange:
    (
      value: string,
    ) => void;
}) {

  return (
    <label className="vital-input-field">

      <span>
        {label}
      </span>


      <div className="vital-input-control">

        <input
          type="number"
          value={
            value
          }
          placeholder={
            placeholder
          }
          step={
            step
          }
          min={
            min
          }
          max={
            max
          }
          onChange={(
            event,
          ) =>
            onChange(
              event.target.value,
            )
          }
        />

        <div>
          {unit}
        </div>

      </div>

    </label>
  );
}


/* =========================================================
   CLINICAL ASSESSMENT
========================================================= */

function assessBloodPressure(
  value?:
    number |
    string,
): VitalAssessment {

  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return notRecorded();
  }


  const match =
    String(value)
      .match(
        /(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/,
      );


  if (!match) {
    return normal();
  }


  const systolic =
    Number(
      match[1],
    );

  const diastolic =
    Number(
      match[2],
    );


  if (
    systolic >= 180 ||
    diastolic >= 120
  ) {
    return critical(
      'Critical',
    );
  }


  if (
    systolic < 90 ||
    diastolic < 60
  ) {
    return low(
      'Low',
    );
  }


  if (
    systolic >= 140 ||
    diastolic >= 90
  ) {
    return high(
      'High',
    );
  }


  return normal();
}


function assessPulse(
  value?:
    number |
    string,
): VitalAssessment {

  const pulse =
    numericValue(
      value,
    );


  if (
    pulse === undefined
  ) {
    return notRecorded();
  }


  if (
    pulse < 40 ||
    pulse > 130
  ) {
    return critical(
      pulse < 40
        ? 'Critical Low'
        : 'Critical High',
    );
  }


  if (
    pulse < 60
  ) {
    return low(
      'Low',
    );
  }


  if (
    pulse > 100
  ) {
    return high(
      'High',
    );
  }


  return normal();
}


function assessTemperature(
  value?:
    number |
    string,
): VitalAssessment {

  const temperature =
    numericValue(
      value,
    );


  if (
    temperature ===
    undefined
  ) {
    return notRecorded();
  }


  if (
    temperature < 35 ||
    temperature >= 40
  ) {
    return critical(
      temperature < 35
        ? 'Critical Low'
        : 'Critical High',
    );
  }


  if (
    temperature >= 38
  ) {
    return high(
      'High',
    );
  }


  return normal();
}


function assessRespiratoryRate(
  value?:
    number |
    string,
): VitalAssessment {

  const respiratoryRate =
    numericValue(
      value,
    );


  if (
    respiratoryRate ===
    undefined
  ) {
    return notRecorded();
  }


  if (
    respiratoryRate < 8 ||
    respiratoryRate > 30
  ) {
    return critical(
      respiratoryRate < 8
        ? 'Critical Low'
        : 'Critical High',
    );
  }


  if (
    respiratoryRate < 12
  ) {
    return low(
      'Low',
    );
  }


  if (
    respiratoryRate > 20
  ) {
    return high(
      'High',
    );
  }


  return normal();
}


function assessSpO2(
  value?:
    number |
    string,
): VitalAssessment {

  const spo2 =
    numericValue(
      value,
    );


  if (
    spo2 === undefined
  ) {
    return notRecorded();
  }


  if (
    spo2 < 90
  ) {
    return critical(
      'Critical Low',
    );
  }


  if (
    spo2 < 95
  ) {
    return low(
      'Low',
    );
  }


  return normal();
}


function assessPainScore(
  value?:
    number |
    string,
): VitalAssessment {

  const pain =
    numericValue(
      value,
    );


  if (
    pain === undefined
  ) {
    return notRecorded();
  }


  if (
    pain >= 7
  ) {
    return high(
      'Severe',
    );
  }


  return normal();
}


/* =========================================================
   ASSESSMENT HELPERS
========================================================= */

function normal():
  VitalAssessment {

  return {
    status:
      'normal',

    label:
      'Normal',

    abnormal:
      false,
  };
}


function high(
  label = 'High',
):
  VitalAssessment {

  return {
    status:
      'high',

    label,

    abnormal:
      true,
  };
}


function low(
  label = 'Low',
):
  VitalAssessment {

  return {
    status:
      'low',

    label,

    abnormal:
      true,
  };
}


function critical(
  label = 'Critical',
):
  VitalAssessment {

  return {
    status:
      'critical',

    label,

    abnormal:
      true,
  };
}


function notRecorded():
  VitalAssessment {

  return {
    status:
      'not-recorded',

    label:
      'Not recorded',

    abnormal:
      false,
  };
}


/* =========================================================
   HELPERS
========================================================= */

function getLatestVitals(
  vitals:
    VitalResult[],
) {

  const result:
    Record<
      string,
      VitalResult
    > = {};


  for (
    const vital
    of vitals
  ) {

    if (
      vital.type &&
      !result[
        vital.type
      ]
    ) {

      result[
        vital.type
      ] =
        vital;

    }

  }


  return result;
}


function numericValue(
  value?:
    number |
    string,
) {

  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return undefined;
  }


  const result =
    Number(
      value,
    );


  return Number.isNaN(
    result,
  )
    ? undefined
    : result;
}


function toOptionalNumber(
  value:
    string,
) {

  if (
    value.trim() ===
    ''
  ) {
    return undefined;
  }


  const number =
    Number(
      value,
    );


  return Number.isNaN(
    number,
  )
    ? undefined
    : number;
}


function formatVitalType(
  value?: string,
) {

  if (!value) {
    return 'Observation';
  }


  return value
    .split('-')
    .map(
      (
        word,
      ) =>
        word
          .charAt(0)
          .toUpperCase() +
        word.slice(1),
    )
    .join(' ');
}


function formatDateTime(
  value?: string,
) {

  if (!value) {
    return '-';
  }


  const date =
    new Date(
      value,
    );


  return Number.isNaN(
    date.getTime(),
  )
    ? value
    : date.toLocaleString();
}
