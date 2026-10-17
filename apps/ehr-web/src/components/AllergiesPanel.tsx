import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react';

import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  CircleOff,
  ClipboardPlus,
  Pill,
  Plus,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';

import {
  createAllergy,
  getPatientAllergies,
  updateAllergyStatus,
} from '../api/allergyApi';

import type {
  AllergyCategory,
  AllergyClinicalStatus,
  AllergyCriticality,
  AllergyReactionSeverity,
  AllergyResponse,
  AllergyType,
  AllergyVerificationStatus,
} from '../types/allergy';

import './AllergiesPanel.css';

interface AllergiesPanelProps {
  patientId: string;
  hospitalId: string;
  encounterId?: string;
  readOnly?: boolean;
}

interface AllergyForm {
  type: AllergyType;
  category: AllergyCategory;
  criticality: AllergyCriticality;

  code: string;
  display: string;

  reaction: string;
  severity: AllergyReactionSeverity;

  verificationStatus:
    AllergyVerificationStatus;

  onsetDate: string;
  note: string;
}

const initialForm: AllergyForm = {
  type: 'allergy',

  category: 'medication',

  criticality: 'low',

  code: '',

  display: '',

  reaction: '',

  severity: 'mild',

  verificationStatus: 'confirmed',

  onsetDate: '',

  note: '',
};

export default function AllergiesPanel({
  patientId,
  hospitalId,
  encounterId,
  readOnly = false,
}: AllergiesPanelProps) {
  const [allergies, setAllergies] =
    useState<AllergyResponse[]>([]);

  const [form, setForm] =
    useState<AllergyForm>(
      initialForm,
    );

  const [loading, setLoading] =
    useState(true);

  const [saving, setSaving] =
    useState(false);

  const [error, setError] =
    useState('');

  const [success, setSuccess] =
    useState('');

  useEffect(() => {
    void loadAllergies();
  }, [patientId]);

  async function loadAllergies() {
    if (!patientId) {
      return;
    }

    try {
      setLoading(true);
      setError('');

      const result =
        await getPatientAllergies(
          patientId,
        );

      setAllergies(
        result.allergies ?? [],
      );
    } catch (err) {
      console.error(
        'Unable to load allergies:',
        err,
      );

      setError(
        'Unable to load allergy information.',
      );
    } finally {
      setLoading(false);
    }
  }

  function updateField<
    K extends keyof AllergyForm,
  >(
    field: K,
    value: AllergyForm[K],
  ) {
    setForm((current) => ({
      ...current,

      [field]: value,
    }));
  }

  const activeAllergies =
    useMemo(
      () =>
        allergies.filter(
          (allergy) =>
            allergy.clinicalStatus ===
            'active',
        ),
      [allergies],
    );

  const highCriticality =
    useMemo(
      () =>
        activeAllergies.filter(
          (allergy) =>
            allergy.criticality ===
            'high',
        ),
      [activeAllergies],
    );

  const medicationAllergies =
    useMemo(
      () =>
        activeAllergies.filter(
          (allergy) =>
            allergy.category ===
            'medication',
        ),
      [activeAllergies],
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

    if (!form.display.trim()) {
      setError(
        'Allergy substance is required.',
      );

      return;
    }

    try {
      setSaving(true);

      await createAllergy({
        patientId,

        hospitalId,

        encounterId:
          encounterId ||
          undefined,

        type:
          form.type,

        category:
          form.category,

        criticality:
          form.criticality,

        code:
          form.code.trim() ||
          normalizeCode(
            form.display,
          ),

        display:
          form.display.trim(),

        clinicalStatus:
          'active',

        verificationStatus:
          form.verificationStatus,

        reaction:
          form.reaction.trim() ||
          undefined,

        severity:
          form.reaction.trim()
            ? form.severity
            : undefined,

        onsetDateTime:
          form.onsetDate
            ? new Date(
                `${form.onsetDate}T00:00:00`,
              ).toISOString()
            : undefined,

        note:
          form.note.trim() ||
          undefined,
      });

      setForm(initialForm);

      setSuccess(
        'Allergy recorded successfully.',
      );

      await loadAllergies();
    } catch (err: any) {
      console.error(
        'Unable to save allergy:',
        err,
      );

      const message =
        err?.response?.data
          ?.message;

      setError(
        Array.isArray(message)
          ? message.join(', ')
          : message ||
              'Unable to save allergy.',
      );
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(
    allergy: AllergyResponse,
    status:
      AllergyClinicalStatus,
  ) {
    if (
      readOnly ||
      !allergy.id
    ) {
      return;
    }

    try {
      setError('');

      await updateAllergyStatus(
        allergy.id,
        status,
      );

      await loadAllergies();
    } catch (err) {
      console.error(
        'Unable to update allergy:',
        err,
      );

      setError(
        'Unable to update allergy status.',
      );
    }
  }

  return (
    <div className="allergies-panel">

      <div className="allergy-summary-grid">

        <SummaryCard
          icon={
            <ShieldAlert
              size={20}
            />
          }
          label="Active Allergies"
          value={
            activeAllergies.length
          }
          variant={
            activeAllergies.length
              ? 'warning'
              : 'success'
          }
        />

        <SummaryCard
          icon={
            <AlertTriangle
              size={20}
            />
          }
          label="High Criticality"
          value={
            highCriticality.length
          }
          variant={
            highCriticality.length
              ? 'danger'
              : 'neutral'
          }
        />

        <SummaryCard
          icon={
            <Pill size={20} />
          }
          label="Medication Allergies"
          value={
            medicationAllergies.length
          }
          variant="blue"
        />

      </div>

      {highCriticality.length >
        0 && (
        <div className="allergy-critical-alert">

          <AlertTriangle
            size={19}
          />

          <div>
            <strong>
              High-risk allergy
            </strong>

            <span>
              {highCriticality
                .map(
                  (item) =>
                    item.display,
                )
                .join(', ')}
            </span>
          </div>

        </div>
      )}

      {!readOnly && (
        <form
          className="allergy-form-card"
          onSubmit={
            handleSubmit
          }
        >

          <div className="allergy-card-header">

            <div className="allergy-title-icon">
              <ClipboardPlus
                size={19}
              />
            </div>

            <div>
              <h2>
                Add Allergy /
                Intolerance
              </h2>

              <p>
                Record patient allergy,
                intolerance and reaction
                information.
              </p>
            </div>

          </div>

          <div className="allergy-form-body">

            <div className="allergy-form-grid">

              <Field
                label="Type"
              >
                <select
                  value={
                    form.type
                  }
                  onChange={(
                    event,
                  ) =>
                    updateField(
                      'type',
                      event.target
                        .value as
                        AllergyType,
                    )
                  }
                >
                  <option value="allergy">
                    Allergy
                  </option>

                  <option value="intolerance">
                    Intolerance
                  </option>
                </select>
              </Field>

              <Field
                label="Category"
              >
                <select
                  value={
                    form.category
                  }
                  onChange={(
                    event,
                  ) =>
                    updateField(
                      'category',
                      event.target
                        .value as
                        AllergyCategory,
                    )
                  }
                >
                  <option value="medication">
                    Medication
                  </option>

                  <option value="food">
                    Food
                  </option>

                  <option value="environment">
                    Environment
                  </option>

                  <option value="biologic">
                    Biologic
                  </option>
                </select>
              </Field>

              <Field
                label="Criticality"
              >
                <select
                  value={
                    form.criticality
                  }
                  onChange={(
                    event,
                  ) =>
                    updateField(
                      'criticality',
                      event.target
                        .value as
                        AllergyCriticality,
                    )
                  }
                >
                  <option value="low">
                    Low
                  </option>

                  <option value="high">
                    High
                  </option>

                  <option value="unable-to-assess">
                    Unable to assess
                  </option>
                </select>
              </Field>

              <Field
                label="Verification"
              >
                <select
                  value={
                    form.verificationStatus
                  }
                  onChange={(
                    event,
                  ) =>
                    updateField(
                      'verificationStatus',
                      event.target
                        .value as
                        AllergyVerificationStatus,
                    )
                  }
                >
                  <option value="confirmed">
                    Confirmed
                  </option>

                  <option value="unconfirmed">
                    Unconfirmed
                  </option>

                  <option value="refuted">
                    Refuted
                  </option>
                </select>
              </Field>

            </div>

            <div className="allergy-substance-grid">

              <Field
                label="Substance / Allergen *"
              >
                <input
                  value={
                    form.display
                  }
                  onChange={(
                    event,
                  ) =>
                    updateField(
                      'display',
                      event.target
                        .value,
                    )
                  }
                  placeholder="Example: Penicillin"
                />
              </Field>

              <Field
                label="Code"
              >
                <input
                  value={
                    form.code
                  }
                  onChange={(
                    event,
                  ) =>
                    updateField(
                      'code',
                      event.target
                        .value,
                    )
                  }
                  placeholder="Optional code"
                />
              </Field>

            </div>

            <div className="allergy-form-grid allergy-reaction-grid">

              <Field
                label="Reaction"
              >
                <input
                  value={
                    form.reaction
                  }
                  onChange={(
                    event,
                  ) =>
                    updateField(
                      'reaction',
                      event.target
                        .value,
                    )
                  }
                  placeholder="Example: Anaphylaxis, rash, swelling..."
                />
              </Field>

              <Field
                label="Reaction Severity"
              >
                <select
                  value={
                    form.severity
                  }
                  onChange={(
                    event,
                  ) =>
                    updateField(
                      'severity',
                      event.target
                        .value as
                        AllergyReactionSeverity,
                    )
                  }
                >
                  <option value="mild">
                    Mild
                  </option>

                  <option value="moderate">
                    Moderate
                  </option>

                  <option value="severe">
                    Severe
                  </option>
                </select>
              </Field>

              <Field
                label="Onset Date"
              >
                <input
                  type="date"
                  value={
                    form.onsetDate
                  }
                  onChange={(
                    event,
                  ) =>
                    updateField(
                      'onsetDate',
                      event.target
                        .value,
                    )
                  }
                />
              </Field>

            </div>

            <Field
              label="Clinical Notes"
            >
              <textarea
                rows={3}
                value={
                  form.note
                }
                onChange={(
                  event,
                ) =>
                  updateField(
                    'note',
                    event.target
                      .value,
                  )
                }
                placeholder="Additional clinical information..."
              />
            </Field>

            {error && (
              <div className="allergy-message allergy-error">

                <AlertCircle
                  size={15}
                />

                {error}

              </div>
            )}

            {success && (
              <div className="allergy-message allergy-success">

                <CheckCircle2
                  size={15}
                />

                {success}

              </div>
            )}

            <div className="allergy-form-actions">

              <button
                type="submit"
                className="allergy-save-button"
                disabled={
                  saving
                }
              >
                <Plus size={16} />

                {saving
                  ? 'Saving...'
                  : 'Add Allergy'}
              </button>

            </div>

          </div>

        </form>
      )}

      <section className="allergy-list-card">

        <div className="allergy-list-header">

          <div>
            <h2>
              Allergies &
              Intolerances
            </h2>

            <p>
              Patient-level allergy
              information across all
              encounters
            </p>
          </div>

          <button
            type="button"
            className="allergy-refresh"
            onClick={() =>
              void loadAllergies()
            }
            disabled={
              loading
            }
          >
            <RefreshCw
              size={14}
            />

            Refresh
          </button>

        </div>

        {loading ? (
          <div className="allergy-empty-state">
            Loading allergies...
          </div>
        ) : allergies.length ===
          0 ? (
          <div className="allergy-empty-state">

            <div className="allergy-empty-icon">
              <CircleOff
                size={25}
              />
            </div>

            <strong>
              No known allergies
            </strong>

            <span>
              No allergy or intolerance
              has been recorded for this
              patient.
            </span>

          </div>
        ) : (
          <div className="allergy-list">

            {allergies.map(
              (allergy) => (
                <AllergyCard
                  key={
                    allergy.id
                  }
                  allergy={
                    allergy
                  }
                  readOnly={
                    readOnly
                  }
                  onResolve={() =>
                    changeStatus(
                      allergy,
                      'resolved',
                    )
                  }
                  onReactivate={() =>
                    changeStatus(
                      allergy,
                      'active',
                    )
                  }
                />
              ),
            )}

          </div>
        )}

      </section>

    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children:
    React.ReactNode;
}) {
  return (
    <label className="allergy-field">

      <span>
        {label}
      </span>

      {children}

    </label>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  variant,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  variant:
    | 'success'
    | 'warning'
    | 'danger'
    | 'neutral'
    | 'blue';
}) {
  return (
    <div
      className={`allergy-summary-card ${variant}`}
    >

      <div className="allergy-summary-icon">
        {icon}
      </div>

      <div>
        <span>
          {label}
        </span>

        <strong>
          {value}
        </strong>
      </div>

    </div>
  );
}

function AllergyCard({
  allergy,
  readOnly,
  onResolve,
  onReactivate,
}: {
  allergy:
    AllergyResponse;

  readOnly:
    boolean;

  onResolve:
    () => void;

  onReactivate:
    () => void;
}) {
  const resolved =
    allergy.clinicalStatus ===
    'resolved';

  const highRisk =
    allergy.criticality ===
      'high' ||
    allergy.severity ===
      'severe';

  return (
    <article
      className={`allergy-record ${
        highRisk
          ? 'high-risk'
          : ''
      } ${
        resolved
          ? 'resolved'
          : ''
      }`}
    >

      <div className="allergy-record-main">

        <div
          className={`allergy-record-icon ${
            highRisk
              ? 'danger'
              : ''
          }`}
        >
          {allergy.category ===
          'medication' ? (
            <Pill size={18} />
          ) : (
            <ShieldAlert
              size={18}
            />
          )}
        </div>

        <div className="allergy-record-content">

          <div className="allergy-record-title">

            <h3>
              {allergy.display ||
                'Unknown allergen'}
            </h3>

            {highRisk && (
              <span className="allergy-high-badge">
                HIGH RISK
              </span>
            )}

          </div>

          <div className="allergy-tags">

            <Tag
              value={
                allergy.category
              }
            />

            <Tag
              value={
                allergy.type
              }
            />

            <StatusTag
              status={
                allergy.clinicalStatus
              }
            />

          </div>

          <div className="allergy-detail-grid">

            <Detail
              label="Reaction"
              value={
                allergy.reaction
              }
            />

            <Detail
              label="Severity"
              value={
                allergy.severity
              }
            />

            <Detail
              label="Criticality"
              value={
                allergy.criticality
              }
            />

            <Detail
              label="Verification"
              value={
                allergy.verificationStatus
              }
            />

            <Detail
              label="Onset"
              value={
                formatDate(
                  allergy.onsetDateTime,
                )
              }
            />

            <Detail
              label="Recorded"
              value={
                formatDate(
                  allergy.recordedDate,
                )
              }
            />

          </div>

          {allergy.note && (
            <div className="allergy-note">
              {allergy.note}
            </div>
          )}

        </div>

      </div>

      {!readOnly && (
        <div className="allergy-record-actions">

          {resolved ? (
            <button
              type="button"
              className="allergy-reactivate-button"
              onClick={
                onReactivate
              }
            >
              <RefreshCw
                size={14}
              />

              Reactivate
            </button>
          ) : (
            <button
              type="button"
              className="allergy-resolve-button"
              onClick={
                onResolve
              }
            >
              <CheckCircle2
                size={14}
              />

              Resolve
            </button>
          )}

        </div>
      )}

    </article>
  );
}

function Tag({
  value,
}: {
  value?: string;
}) {
  if (!value) {
    return null;
  }

  return (
    <span className="allergy-tag">
      {formatValue(value)}
    </span>
  );
}

function StatusTag({
  status,
}: {
  status?: string;
}) {
  return (
    <span
      className={`allergy-status-tag ${
        status ?? ''
      }`}
    >
      <span />

      {formatValue(
        status,
      )}
    </span>
  );
}

function Detail({
  label,
  value,
}: {
  label: string;
  value?: string;
}) {
  return (
    <div className="allergy-detail">

      <span>
        {label}
      </span>

      <strong>
        {value
          ? formatValue(value)
          : '-'}
      </strong>

    </div>
  );
}

function normalizeCode(
  value: string,
) {
  return value
    .trim()
    .toLowerCase()
    .replace(
      /[^a-z0-9]+/g,
      '-',
    )
    .replace(
      /^-+|-+$/g,
      '',
    );
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

function formatDate(
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

  return date.toLocaleDateString();
}