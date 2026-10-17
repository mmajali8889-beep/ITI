import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react';

import {
  AlertTriangle,
  CheckCircle2,
  ClipboardPlus,
  History,
  Pill,
  Plus,
  RefreshCw,
  ShieldAlert,
  SquareStop,
} from 'lucide-react';

import {
  createMedication,
  getEncounterMedications,
  getPatientMedications,
  updateMedicationStatus,
} from '../api/medicationApi';

import type {
  MedicationAllergyError,
  MedicationPriority,
  MedicationRequestStatus,
  MedicationResponse,
} from '../types/medication';

import './MedicationPanel.css';


interface MedicationPanelProps {
  patientId: string;
  hospitalId: string;
  encounterId: string;

  practitionerId?: string;

  readOnly?: boolean;
}


interface MedicationForm {
  medicationCode: string;
  medicationName: string;

  dose: string;
  doseUnit: string;

  route: string;

  frequency: string;

  durationDays: string;

  quantity: string;
  quantityUnit: string;

  instructions: string;

  asNeeded: boolean;

  startDate: string;
  endDate: string;

  priority:
    MedicationPriority;
}


const initialForm:
  MedicationForm = {
    medicationCode:
      '',

    medicationName:
      '',

    dose:
      '',

    doseUnit:
      'mg',

    route:
      'Oral',

    frequency:
      '',

    durationDays:
      '',

    quantity:
      '',

    quantityUnit:
      'tablet',

    instructions:
      '',

    asNeeded:
      false,

    startDate:
      '',

    endDate:
      '',

    priority:
      'routine',
  };


export default function MedicationPanel({
  patientId,
  hospitalId,
  encounterId,
  practitionerId,
  readOnly = false,
}: MedicationPanelProps) {

  const [
    form,
    setForm,
  ] =
    useState<MedicationForm>(
      initialForm,
    );

  const [
    encounterMedications,
    setEncounterMedications,
  ] =
    useState<MedicationResponse[]>(
      [],
    );

  const [
    patientMedications,
    setPatientMedications,
  ] =
    useState<MedicationResponse[]>(
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

  const [
    allergyAlert,
    setAllergyAlert,
  ] =
    useState<MedicationAllergyError | null>(
      null,
    );


  useEffect(() => {
    void loadMedications();
  }, [
    patientId,
    encounterId,
  ]);


  async function loadMedications() {
    try {
      setLoading(true);
      setError('');

      const [
        encounterResult,
        patientResult,
      ] =
        await Promise.all([
          getEncounterMedications(
            encounterId,
          ),

          getPatientMedications(
            patientId,
          ),
        ]);

      setEncounterMedications(
        encounterResult.medications ??
          [],
      );

      setPatientMedications(
        patientResult.medications ??
          [],
      );

    } catch (err) {
      console.error(
        'Unable to load medications:',
        err,
      );

      setError(
        'Unable to load medication information.',
      );

    } finally {
      setLoading(false);
    }
  }


  function updateField<
    K extends keyof MedicationForm,
  >(
    field:
      K,

    value:
      MedicationForm[K],
  ) {
    setForm(
      (
        current,
      ) => ({
        ...current,

        [field]:
          value,
      }),
    );
  }


  const activePatientMedications =
    useMemo(
      () =>
        patientMedications.filter(
          (
            medication,
          ) =>
            medication.status ===
            'active',
        ),
      [
        patientMedications,
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
    setAllergyAlert(
      null,
    );

    if (
      !form.medicationName.trim()
    ) {
      setError(
        'Medication name is required.',
      );

      return;
    }

    if (
      !form.medicationCode.trim()
    ) {
      setError(
        'Medication code is required.',
      );

      return;
    }

    try {
      setSaving(true);

      await createMedication({
        patientId,

        hospitalId,

        encounterId,

        practitionerId,

        medicationCode:
          form.medicationCode.trim(),

        medicationName:
          form.medicationName.trim(),

        dose:
          optionalNumber(
            form.dose,
          ),

        doseUnit:
          form.doseUnit ||
          undefined,

        route:
          form.route ||
          undefined,

        frequency:
          form.frequency.trim() ||
          undefined,

        durationDays:
          optionalNumber(
            form.durationDays,
          ),

        quantity:
          optionalNumber(
            form.quantity,
          ),

        quantityUnit:
          form.quantityUnit ||
          undefined,

        instructions:
          form.instructions.trim() ||
          undefined,

        asNeeded:
          form.asNeeded,

        startDate:
          form.startDate ||
          undefined,

        endDate:
          form.endDate ||
          undefined,

        priority:
          form.priority,
      });

      setForm(
        initialForm,
      );

      setSuccess(
        'Medication order created successfully.',
      );

      await loadMedications();

    } catch (err: any) {
      console.error(
        'Unable to create medication order:',
        err,
      );

      const responseData =
        err?.response
          ?.data;

      /*
       * Nest ConflictException can wrap the supplied
       * object depending on the response shape.
       */

      const allergyData =
        extractAllergyAlert(
          responseData,
        );

      if (
        allergyData
          ?.allergyAlert
      ) {
        setAllergyAlert(
          allergyData,
        );

        setError(
          '',
        );

      } else {
        const message =
          responseData
            ?.message;

        setError(
          Array.isArray(
            message,
          )
            ? message.join(
                ', ',
              )
            : typeof message ===
                'string'
              ? message
              : 'Unable to create medication order.',
        );
      }

    } finally {
      setSaving(false);
    }
  }


  async function changeStatus(
    medication:
      MedicationResponse,

    status:
      MedicationRequestStatus,
  ) {
    if (
      readOnly ||
      !medication.id
    ) {
      return;
    }

    try {
      setError('');
      setSuccess('');

      await updateMedicationStatus(
        medication.id,
        status,
      );

      await loadMedications();

    } catch (err) {
      console.error(
        'Unable to update medication:',
        err,
      );

      setError(
        'Unable to update medication status.',
      );
    }
  }


  return (
    <div className="medication-panel">

      {/* =================================================
          SUMMARY
      ================================================= */}

      <div className="medication-summary-grid">

        <SummaryCard
          icon={
            <Pill size={20} />
          }
          label="Active Medications"
          value={
            activePatientMedications.length
          }
          variant="blue"
        />

        <SummaryCard
          icon={
            <ClipboardPlus
              size={20}
            />
          }
          label="Encounter Orders"
          value={
            encounterMedications.length
          }
          variant="green"
        />

        <SummaryCard
          icon={
            <ShieldAlert
              size={20}
            />
          }
          label="Safety Check"
          value="Allergy"
          variant="safety"
          textValue
        />

      </div>


      {/* =================================================
          ALLERGY ALERT
      ================================================= */}

      {allergyAlert && (
        <section className="drug-allergy-alert">

          <div className="drug-allergy-alert-icon">
            <AlertTriangle
              size={25}
            />
          </div>


          <div className="drug-allergy-alert-content">

            <div className="drug-allergy-alert-heading">

              <div>
                <strong>
                  DRUG-ALLERGY ALERT
                </strong>

                <h3>
                  Medication order blocked
                </h3>
              </div>

              <span>
                SAFETY
              </span>

            </div>


            <p>
              The medication{' '}
              <strong>
                {allergyAlert.medication ??
                  form.medicationName}
              </strong>{' '}
              matches an active medication allergy recorded for this patient.
            </p>


            <div className="allergy-warning-list">

              {allergyAlert.warnings?.map(
                (
                  warning,
                  index,
                ) => (

                  <div
                    key={
                      warning.allergyId ??
                      index
                    }
                    className="allergy-warning-row"
                  >

                    <div>
                      <span>
                        Allergen
                      </span>

                      <strong>
                        {warning.allergen ??
                          '-'}
                      </strong>
                    </div>


                    <div>
                      <span>
                        Reaction
                      </span>

                      <strong>
                        {warning.reaction ??
                          '-'}
                      </strong>
                    </div>


                    <div>
                      <span>
                        Severity
                      </span>

                      <strong>
                        {formatValue(
                          warning.severity,
                        )}
                      </strong>
                    </div>


                    <div>
                      <span>
                        Criticality
                      </span>

                      <strong>
                        {formatValue(
                          warning.criticality,
                        )}
                      </strong>
                    </div>

                  </div>

                ),
              )}

            </div>


            <div className="drug-allergy-advice">
              Review the allergy record and select an appropriate alternative medication.
            </div>

          </div>

        </section>
      )}


      {/* =================================================
          NEW PRESCRIPTION
      ================================================= */}

      {!readOnly && (
        <form
          className="medication-order-card"
          onSubmit={
            handleSubmit
          }
        >

          <div className="medication-card-header">

            <div className="medication-header-icon">
              <ClipboardPlus
                size={19}
              />
            </div>

            <div>
              <h2>
                New Medication Order
              </h2>

              <p>
                Create a prescription for the current encounter.
              </p>
            </div>

          </div>


          <div className="medication-form-body">

            <div className="medication-primary-grid">

              <Field
                label="Medication Name *"
              >
                <input
                  value={
                    form.medicationName
                  }
                  onChange={(
                    event,
                  ) =>
                    updateField(
                      'medicationName',
                      event.target
                        .value,
                    )
                  }
                  placeholder="Example: Amoxicillin"
                />
              </Field>


              <Field
                label="Medication Code *"
              >
                <input
                  value={
                    form.medicationCode
                  }
                  onChange={(
                    event,
                  ) =>
                    updateField(
                      'medicationCode',
                      event.target
                        .value,
                    )
                  }
                  placeholder="Example: amoxicillin"
                />
              </Field>


              <Field
                label="Priority"
              >
                <select
                  value={
                    form.priority
                  }
                  onChange={(
                    event,
                  ) =>
                    updateField(
                      'priority',
                      event.target
                        .value as
                        MedicationPriority,
                    )
                  }
                >
                  <option value="routine">
                    Routine
                  </option>

                  <option value="urgent">
                    Urgent
                  </option>

                  <option value="asap">
                    ASAP
                  </option>

                  <option value="stat">
                    STAT
                  </option>
                </select>
              </Field>

            </div>


            <div className="medication-dose-grid">

              <Field label="Dose">
                <input
                  type="number"
                  step="0.01"
                  value={
                    form.dose
                  }
                  onChange={(
                    event,
                  ) =>
                    updateField(
                      'dose',
                      event.target
                        .value,
                    )
                  }
                  placeholder="500"
                />
              </Field>


              <Field label="Dose Unit">
                <select
                  value={
                    form.doseUnit
                  }
                  onChange={(
                    event,
                  ) =>
                    updateField(
                      'doseUnit',
                      event.target
                        .value,
                    )
                  }
                >
                  <option value="mg">
                    mg
                  </option>

                  <option value="g">
                    g
                  </option>

                  <option value="mcg">
                    mcg
                  </option>

                  <option value="mL">
                    mL
                  </option>

                  <option value="tablet">
                    tablet
                  </option>

                  <option value="capsule">
                    capsule
                  </option>
                </select>
              </Field>


              <Field label="Route">
                <select
                  value={
                    form.route
                  }
                  onChange={(
                    event,
                  ) =>
                    updateField(
                      'route',
                      event.target
                        .value,
                    )
                  }
                >
                  <option value="Oral">
                    Oral
                  </option>

                  <option value="Intravenous">
                    Intravenous
                  </option>

                  <option value="Intramuscular">
                    Intramuscular
                  </option>

                  <option value="Subcutaneous">
                    Subcutaneous
                  </option>

                  <option value="Topical">
                    Topical
                  </option>

                  <option value="Inhalation">
                    Inhalation
                  </option>

                  <option value="Sublingual">
                    Sublingual
                  </option>

                  <option value="Rectal">
                    Rectal
                  </option>
                </select>
              </Field>


              <Field label="Frequency">
                <select
                  value={
                    form.frequency
                  }
                  onChange={(
                    event,
                  ) =>
                    updateField(
                      'frequency',
                      event.target
                        .value,
                    )
                  }
                >
                  <option value="">
                    Select frequency
                  </option>

                  <option value="Once daily">
                    Once daily
                  </option>

                  <option value="Twice daily">
                    Twice daily
                  </option>

                  <option value="Three times daily">
                    Three times daily
                  </option>

                  <option value="Four times daily">
                    Four times daily
                  </option>

                  <option value="Every 4 hours">
                    Every 4 hours
                  </option>

                  <option value="Every 6 hours">
                    Every 6 hours
                  </option>

                  <option value="Every 8 hours">
                    Every 8 hours
                  </option>

                  <option value="Every 12 hours">
                    Every 12 hours
                  </option>

                  <option value="At bedtime">
                    At bedtime
                  </option>
                </select>
              </Field>

            </div>


            <div className="medication-duration-grid">

              <Field label="Duration">
                <div className="medication-input-unit">

                  <input
                    type="number"
                    min="1"
                    value={
                      form.durationDays
                    }
                    onChange={(
                      event,
                    ) =>
                      updateField(
                        'durationDays',
                        event.target
                          .value,
                      )
                    }
                    placeholder="7"
                  />

                  <span>
                    days
                  </span>

                </div>
              </Field>


              <Field label="Quantity">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={
                    form.quantity
                  }
                  onChange={(
                    event,
                  ) =>
                    updateField(
                      'quantity',
                      event.target
                        .value,
                    )
                  }
                  placeholder="14"
                />
              </Field>


              <Field label="Quantity Unit">
                <select
                  value={
                    form.quantityUnit
                  }
                  onChange={(
                    event,
                  ) =>
                    updateField(
                      'quantityUnit',
                      event.target
                        .value,
                    )
                  }
                >
                  <option value="tablet">
                    Tablet
                  </option>

                  <option value="capsule">
                    Capsule
                  </option>

                  <option value="mL">
                    mL
                  </option>

                  <option value="ampoule">
                    Ampoule
                  </option>

                  <option value="vial">
                    Vial
                  </option>

                  <option value="inhaler">
                    Inhaler
                  </option>
                </select>
              </Field>


              <label className="medication-prn-field">

                <input
                  type="checkbox"
                  checked={
                    form.asNeeded
                  }
                  onChange={(
                    event,
                  ) =>
                    updateField(
                      'asNeeded',
                      event.target
                        .checked,
                    )
                  }
                />

                <div>
                  <strong>
                    PRN
                  </strong>

                  <span>
                    As needed
                  </span>
                </div>

              </label>

            </div>


            <div className="medication-date-grid">

              <Field label="Start Date">
                <input
                  type="date"
                  value={
                    form.startDate
                  }
                  onChange={(
                    event,
                  ) =>
                    updateField(
                      'startDate',
                      event.target
                        .value,
                    )
                  }
                />
              </Field>


              <Field label="End Date">
                <input
                  type="date"
                  value={
                    form.endDate
                  }
                  onChange={(
                    event,
                  ) =>
                    updateField(
                      'endDate',
                      event.target
                        .value,
                    )
                  }
                />
              </Field>

            </div>


            <Field
              label="Prescription Instructions"
            >
              <textarea
                rows={3}
                value={
                  form.instructions
                }
                onChange={(
                  event,
                ) =>
                  updateField(
                    'instructions',
                    event.target
                      .value,
                  )
                }
                placeholder="Example: Take one tablet orally twice daily after meals."
              />
            </Field>


            {error && (
              <div className="medication-message error">
                <AlertTriangle
                  size={15}
                />

                {error}
              </div>
            )}


            {success && (
              <div className="medication-message success">
                <CheckCircle2
                  size={15}
                />

                {success}
              </div>
            )}


            <div className="medication-form-actions">

              <button
                type="submit"
                className="create-medication-button"
                disabled={
                  saving
                }
              >

                <Plus
                  size={16}
                />

                {saving
                  ? 'Checking & Saving...'
                  : 'Create Medication Order'}

              </button>

            </div>

          </div>

        </form>
      )}


      {/* =================================================
          ACTIVE MEDICATIONS
      ================================================= */}

      <MedicationList
        title="Active Medications"
        subtitle="Current active medication orders for this patient"
        icon={
          <Pill size={18} />
        }
        medications={
          activePatientMedications
        }
        loading={
          loading
        }
        readOnly={
          readOnly
        }
        onStop={(
          medication,
        ) =>
          void changeStatus(
            medication,
            'stopped',
          )
        }
      />


      {/* =================================================
          ENCOUNTER ORDERS
      ================================================= */}

      <MedicationList
        title="Encounter Medication Orders"
        subtitle="Medication orders created during this encounter"
        icon={
          <History
            size={18}
          />
        }
        medications={
          encounterMedications
        }
        loading={
          loading
        }
        readOnly={
          readOnly
        }
        onStop={(
          medication,
        ) =>
          void changeStatus(
            medication,
            'stopped',
          )
        }
      />


      <button
        type="button"
        className="medication-refresh-button"
        onClick={() =>
          void loadMedications()
        }
      >
        <RefreshCw
          size={14}
        />

        Refresh medication data
      </button>

    </div>
  );
}


/* =========================================================
   FIELD
========================================================= */

function Field({
  label,
  children,
}: {
  label:
    string;

  children:
    React.ReactNode;
}) {
  return (
    <label className="medication-field">

      <span>
        {label}
      </span>

      {children}

    </label>
  );
}


/* =========================================================
   SUMMARY
========================================================= */

function SummaryCard({
  icon,
  label,
  value,
  variant,
  textValue = false,
}: {
  icon:
    React.ReactNode;

  label:
    string;

  value:
    number |
    string;

  variant:
    'blue' |
    'green' |
    'safety';

  textValue?:
    boolean;
}) {
  return (
    <div
      className={
        `medication-summary-card ${variant}`
      }
    >

      <div className="medication-summary-icon">
        {icon}
      </div>

      <div>
        <span>
          {label}
        </span>

        <strong
          className={
            textValue
              ? 'summary-text-value'
              : ''
          }
        >
          {value}
        </strong>
      </div>

    </div>
  );
}


/* =========================================================
   MEDICATION LIST
========================================================= */

function MedicationList({
  title,
  subtitle,
  icon,
  medications,
  loading,
  readOnly,
  onStop,
}: {
  title:
    string;

  subtitle:
    string;

  icon:
    React.ReactNode;

  medications:
    MedicationResponse[];

  loading:
    boolean;

  readOnly:
    boolean;

  onStop:
    (
      medication:
        MedicationResponse,
    ) => void;
}) {
  return (
    <section className="medication-list-card">

      <div className="medication-list-header">

        <div className="medication-list-title">

          <div>
            {icon}
          </div>

          <div>
            <h2>
              {title}
            </h2>

            <p>
              {subtitle}
            </p>
          </div>

        </div>


        <span className="medication-list-count">
          {medications.length}
        </span>

      </div>


      {loading ? (
        <div className="medication-empty">
          Loading medication orders...
        </div>
      ) : medications.length ===
        0 ? (
        <div className="medication-empty">

          <Pill
            size={25}
          />

          <strong>
            No medication orders
          </strong>

          <span>
            Medication orders will appear here.
          </span>

        </div>
      ) : (
        <div className="medication-table-wrapper">

          <table className="medication-table">

            <thead>
              <tr>
                <th>
                  Medication
                </th>

                <th>
                  Dose
                </th>

                <th>
                  Route
                </th>

                <th>
                  Frequency
                </th>

                <th>
                  Duration
                </th>

                <th>
                  Status
                </th>

                <th>
                  Priority
                </th>

                <th>
                  Ordered
                </th>

                {!readOnly && (
                  <th />
                )}
              </tr>
            </thead>


            <tbody>

              {medications.map(
                (
                  medication,
                  index,
                ) => (

                  <tr
                    key={
                      medication.id ??
                      `${medication.medicationName}-${index}`
                    }
                  >

                    <td>

                      <div className="medication-name-cell">

                        <div className="medication-table-pill-icon">
                          <Pill
                            size={15}
                          />
                        </div>

                        <div>
                          <strong>
                            {medication.medicationName ??
                              '-'}
                          </strong>

                          <span>
                            {medication.medicationCode ??
                              ''}
                          </span>
                        </div>

                      </div>

                    </td>


                    <td>
                      {medication.dose ??
                        '-'}

                      {medication.doseUnit &&
                        ` ${medication.doseUnit}`}
                    </td>


                    <td>
                      {medication.route ??
                        '-'}
                    </td>


                    <td>
                      {medication.frequency ??
                        '-'}
                    </td>


                    <td>
                      {medication.durationDays
                        ? `${medication.durationDays} days`
                        : '-'}
                    </td>


                    <td>
                      <MedicationStatus
                        status={
                          medication.status
                        }
                      />
                    </td>


                    <td>
                      <PriorityBadge
                        priority={
                          medication.priority
                        }
                      />
                    </td>


                    <td>
                      {formatDateTime(
                        medication.authoredOn,
                      )}
                    </td>


                    {!readOnly && (
                      <td className="medication-action-cell">

                        {medication.status ===
                        'active' ? (
                          <button
                            type="button"
                            className="stop-medication-button"
                            onClick={() =>
                              onStop(
                                medication,
                              )
                            }
                          >
                            <SquareStop
                              size={13}
                            />

                            Stop
                          </button>
                        ) : (
                          <span className="medication-no-action">
                            —
                          </span>
                        )}

                      </td>
                    )}

                  </tr>

                ),
              )}

            </tbody>

          </table>

        </div>
      )}

    </section>
  );
}


/* =========================================================
   STATUS
========================================================= */

function MedicationStatus({
  status,
}: {
  status?:
    MedicationRequestStatus;
}) {
  return (
    <span
      className={
        `medication-status ${status ?? 'unknown'}`
      }
    >
      <span />

      {formatValue(
        status,
      )}
    </span>
  );
}


function PriorityBadge({
  priority,
}: {
  priority?:
    MedicationPriority;
}) {
  return (
    <span
      className={
        `medication-priority ${priority ?? 'routine'}`
      }
    >
      {formatValue(
        priority,
      )}
    </span>
  );
}


/* =========================================================
   HELPERS
========================================================= */

function optionalNumber(
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
    Number(value);

  return Number.isNaN(
    number,
  )
    ? undefined
    : number;
}


function formatValue(
  value?: string,
) {
  if (!value) {
    return '-';
  }

  return value
    .split('-')
    .map(
      (word) =>
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
    new Date(value);

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return value;
  }

  return date.toLocaleString();
}


function extractAllergyAlert(
  data: any,
):
  MedicationAllergyError |
  null {

  if (!data) {
    return null;
  }

  if (
    data.allergyAlert ===
    true
  ) {
    return data;
  }

  if (
    data.message &&
    typeof data.message ===
      'object' &&
    data.message
      .allergyAlert ===
      true
  ) {
    return data.message;
  }

  return null;
}