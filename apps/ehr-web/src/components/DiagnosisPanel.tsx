import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react';

import {
  AlertCircle,
  CheckCircle2,
  ClipboardPlus,
  HeartPulse,
  Plus,
  RotateCcw,
  Search,
  Stethoscope,
} from 'lucide-react';

import {
  createCondition,
  getEncounterConditions,
  getPatientProblems,
  updateConditionStatus,
} from '../api/conditionApi';

import type {
  ClinicalStatus,
  ConditionCategory,
  ConditionResponse,
  DiagnosisCodeSystem,
  DiagnosisRank,
  VerificationStatus,
} from '../types/condition';

import {
  icd10Catalog,
} from '../data/icd10Catalog';

import './DiagnosisPanel.css';


interface DiagnosisPanelProps {
  patientId:
    string;

  encounterId:
    string;

  hospitalId:
    string;

  readOnly?:
    boolean;
}


interface DiagnosisForm {
  category:
    ConditionCategory;

  diagnosisRank:
    DiagnosisRank;

  codeSystem:
    DiagnosisCodeSystem;

  icd10Code:
    string;

  description:
    string;

  clinicalStatus:
    ClinicalStatus;

  verificationStatus:
    VerificationStatus;

  severity:
    string;

  onsetDate:
    string;

  note:
    string;
}


const initialForm:
  DiagnosisForm = {
    category:
      'encounter-diagnosis',

    diagnosisRank:
      'secondary',

    codeSystem:
      'ICD-10',

    icd10Code:
      '',

    description:
      '',

    clinicalStatus:
      'active',

    verificationStatus:
      'confirmed',

    severity:
      '',

    onsetDate:
      '',

    note:
      '',
  };


export default function DiagnosisPanel({
  patientId,
  encounterId,
  hospitalId,
  readOnly = false,
}: DiagnosisPanelProps) {
  const [
    form,
    setForm,
  ] =
    useState<DiagnosisForm>(
      initialForm,
    );

  const [
    encounterConditions,
    setEncounterConditions,
  ] =
    useState<ConditionResponse[]>(
      [],
    );

  const [
    problemList,
    setProblemList,
  ] =
    useState<ConditionResponse[]>(
      [],
    );

  const [
    searchText,
    setSearchText,
  ] =
    useState('');

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
    loadConditions();
  }, [
    patientId,
    encounterId,
  ]);


  async function loadConditions() {
    try {
      setLoading(true);

      setError('');

      const [
        encounterResult,
        problemsResult,
      ] =
        await Promise.all([
          getEncounterConditions(
            encounterId,
            hospitalId,
          ),

          getPatientProblems(
            patientId,
            hospitalId,
          ),
        ]);

      setEncounterConditions(
        encounterResult.conditions ??
          [],
      );

      setProblemList(
        problemsResult.conditions ??
          [],
      );

    } catch (err) {
      console.error(
        'Unable to load conditions:',
        err,
      );

      setError(
        'Unable to load diagnosis information.',
      );

    } finally {
      setLoading(false);
    }
  }


  function updateField<
    K extends keyof DiagnosisForm,
  >(
    field:
      K,

    value:
      DiagnosisForm[K],
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


  const filteredCodes =
    useMemo(
      () => {
        const value =
          searchText
            .trim()
            .toLowerCase();

        if (!value) {
          return [];
        }

        if (form.codeSystem !== 'ICD-10') {
          return [];
        }

        return icd10Catalog
          .filter(
            (
              item,
            ) =>
              item.code
                .toLowerCase()
                .includes(
                  value,
                ) ||
              item.description
                .toLowerCase()
                .includes(
                  value,
                ) ||
              item.descriptionAr
                .includes(value),
          )
          .slice(
            0,
            8,
          );
      },
      [
        searchText,
        form.codeSystem,
      ],
    );


  function selectIcd10(
    code:
      string,

    description:
      string,
  ) {
    setForm(
      (
        current,
      ) => ({
        ...current,

        icd10Code:
          code,

        description,
      }),
    );

    setSearchText('');
  }


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

    if (
      !form.icd10Code.trim()
    ) {
      setError(
        `${form.codeSystem} code is required.`,
      );

      return;
    }

    if (
      !form.description.trim()
    ) {
      setError(
        'Diagnosis description is required.',
      );

      return;
    }

    try {
      setSaving(true);

      await createCondition({
        patientId,

        hospitalId,

        encounterId:
          form.category ===
          'encounter-diagnosis'
            ? encounterId
            : undefined,

        category:
          form.category,

        diagnosisRank:
          form.category ===
          'encounter-diagnosis'
            ? form.diagnosisRank
            : undefined,

        codeSystem:
          form.codeSystem,

        diagnosisCode:
          form.icd10Code
            .trim(),

        description:
          form.description
            .trim(),

        clinicalStatus:
          form.clinicalStatus,

        verificationStatus:
          form.verificationStatus,

        severity:
          form.severity ||
          undefined,

        onsetDateTime:
          form.onsetDate
            ? new Date(
                form.onsetDate,
              ).toISOString()
            : undefined,

        note:
          form.note.trim() ||
          undefined,
      });

      setForm(
        initialForm,
      );

      setSearchText('');

      setSuccess(
        'Diagnosis saved successfully.',
      );

      await loadConditions();

    } catch (err: any) {
      console.error(
        'Unable to save condition:',
        err,
      );

      const message =
        err?.response
          ?.data
          ?.message;

      setError(
        Array.isArray(
          message,
        )
          ? message.join(
              ', ',
            )
          : message ||
              'Unable to save diagnosis.',
      );

    } finally {
      setSaving(false);
    }
  }


  async function resolveCondition(
    condition:
      ConditionResponse,
  ) {
    if (
      readOnly ||
      !condition.id
    ) {
      return;
    }

    try {
      await updateConditionStatus(
        condition.id,
        'resolved',
        hospitalId,
      );

      await loadConditions();

    } catch (err) {
      console.error(
        'Unable to resolve condition:',
        err,
      );

      setError(
        'Unable to resolve condition.',
      );
    }
  }


  async function reactivateCondition(
    condition:
      ConditionResponse,
  ) {
    if (
      readOnly ||
      !condition.id
    ) {
      return;
    }

    try {
      await updateConditionStatus(
        condition.id,
        'active',
        hospitalId,
      );

      await loadConditions();

    } catch (err) {
      console.error(
        'Unable to reactivate condition:',
        err,
      );

      setError(
        'Unable to reactivate condition.',
      );
    }
  }


  const primaryDiagnosis =
    encounterConditions.find(
      (
        condition,
      ) =>
        condition.diagnosisRank ===
        'primary',
    );


  return (
    <div className="diagnosis-panel">

      {/* =================================================
          SUMMARY
      ================================================= */}

      <section className="diagnosis-summary-grid">

        <DiagnosisSummaryCard
          icon={
            <Stethoscope
              size={19}
            />
          }
          label="Encounter Diagnoses"
          value={
            String(
              encounterConditions.length,
            )
          }
        />

        <DiagnosisSummaryCard
          icon={
            <HeartPulse
              size={19}
            />
          }
          label="Active Problems"
          value={
            String(
              problemList.filter(
                (
                  condition,
                ) =>
                  condition.clinicalStatus ===
                  'active',
              ).length,
            )
          }
        />

        <DiagnosisSummaryCard
          icon={
            <CheckCircle2
              size={19}
            />
          }
          label="Primary Diagnosis"
          value={
            primaryDiagnosis
              ?.diagnosisCode ?? primaryDiagnosis?.icd10Code ??
            'Not Set'
          }
          textValue
        />

      </section>


      {/* =================================================
          ADD DIAGNOSIS
      ================================================= */}

      {!readOnly && (
        <form
          className="diagnosis-entry-card"
          onSubmit={
            handleSubmit
          }
        >

          <div className="diagnosis-card-heading">

            <div>
              <h2>
                Add Diagnosis / Problem
              </h2>

              <p>
                Record encounter diagnoses or long-term patient problems
              </p>
            </div>

            <ClipboardPlus
              size={20}
            />

          </div>


          <div className="diagnosis-form-body">

            <div className="diagnosis-form-grid">

              <label className="diagnosis-field">

                <span>
                  Type
                </span>

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
                        ConditionCategory,
                    )
                  }
                >
                  <option value="encounter-diagnosis">
                    Encounter Diagnosis
                  </option>

                  <option value="problem-list-item">
                    Patient Problem List
                  </option>
                </select>

              </label>


              {form.category ===
                'encounter-diagnosis' && (
                <label className="diagnosis-field">

                  <span>
                    Diagnosis Rank
                  </span>

                  <select
                    value={
                      form.diagnosisRank
                    }
                    onChange={(
                      event,
                    ) =>
                      updateField(
                        'diagnosisRank',
                        event.target
                          .value as
                          DiagnosisRank,
                      )
                    }
                  >
                    <option value="primary">
                      Primary
                    </option>

                    <option value="secondary">
                      Secondary
                    </option>
                  </select>

                </label>
              )}


              <label className="diagnosis-field">

                <span>
                  Clinical Status
                </span>

                <select
                  value={
                    form.clinicalStatus
                  }
                  onChange={(
                    event,
                  ) =>
                    updateField(
                      'clinicalStatus',
                      event.target
                        .value as
                        ClinicalStatus,
                    )
                  }
                >
                  <option value="active">
                    Active
                  </option>

                  <option value="inactive">
                    Inactive
                  </option>

                  <option value="resolved">
                    Resolved
                  </option>

                  <option value="remission">
                    Remission
                  </option>
                </select>

              </label>


              <label className="diagnosis-field">

                <span>
                  Verification
                </span>

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
                        VerificationStatus,
                    )
                  }
                >
                  <option value="confirmed">
                    Confirmed
                  </option>

                  <option value="provisional">
                    Provisional
                  </option>

                  <option value="differential">
                    Differential
                  </option>

                  <option value="unconfirmed">
                    Unconfirmed
                  </option>
                </select>

              </label>

            </div>


            {/* ICD SEARCH */}

            <div className="diagnosis-form-grid">
              <label className="diagnosis-field">
                <span>Classification System</span>
                <select
                  value={form.codeSystem}
                  onChange={(event) => {
                    updateField('codeSystem', event.target.value as DiagnosisCodeSystem);
                    updateField('icd10Code', '');
                    updateField('description', '');
                    setSearchText('');
                  }}
                >
                  <option value="ICD-10">ICD-10</option>
                  <option value="ICD-11">ICD-11 MMS</option>
                </select>
              </label>
            </div>

            <div className="icd-search-block">

              <label>
                {form.codeSystem} Search
              </label>

              <div className="icd-search-input">

                <Search
                  size={16}
                />

                <input
                  value={
                    searchText
                  }
                  onChange={(
                    event,
                  ) =>
                    setSearchText(
                      event.target
                        .value,
                    )
                  }
                  placeholder={form.codeSystem === 'ICD-10' ? 'Search ICD-10 by code, English or Arabic description...' : 'Enter an ICD-11 MMS code and description below...'}
                  disabled={form.codeSystem === 'ICD-11'}
                />

              </div>


              {filteredCodes.length >
                0 && (
                <div className="icd-search-results">

                  {filteredCodes.map(
                    (
                      item,
                    ) => (
                      <button
                        key={
                          item.code
                        }
                        type="button"
                        onClick={() =>
                          selectIcd10(
                            item.code,
                            item.description,
                          )
                        }
                      >
                        <strong>
                          {item.code}
                        </strong>

                        <span>
                          {item.description}
                          <small dir="rtl">
                            {item.descriptionAr}
                          </small>
                        </span>
                      </button>
                    ),
                  )}

                </div>
              )}

            </div>


            <div className="diagnosis-form-grid diagnosis-main-fields">

              <label className="diagnosis-field">

                <span>
                  {form.codeSystem} Code *
                </span>

                <input
                  value={
                    form.icd10Code
                  }
                  onChange={(
                    event,
                  ) =>
                    updateField(
                      'icd10Code',
                      event.target
                        .value,
                    )
                  }
                  placeholder={form.codeSystem === 'ICD-10' ? 'I10' : 'BA00'}
                />

              </label>


              <label className="diagnosis-field diagnosis-description-field">

                <span>
                  Diagnosis Description *
                </span>

                <input
                  value={
                    form.description
                  }
                  onChange={(
                    event,
                  ) =>
                    updateField(
                      'description',
                      event.target
                        .value,
                    )
                  }
                  placeholder="Essential hypertension"
                />

              </label>


              <label className="diagnosis-field">

                <span>
                  Severity
                </span>

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
                        .value,
                    )
                  }
                >
                  <option value="">
                    Not specified
                  </option>

                  <option value="Mild">
                    Mild
                  </option>

                  <option value="Moderate">
                    Moderate
                  </option>

                  <option value="Severe">
                    Severe
                  </option>
                </select>

              </label>


              <label className="diagnosis-field">

                <span>
                  Onset Date
                </span>

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

              </label>

            </div>


            <label className="diagnosis-field">

              <span>
                Clinical Notes
              </span>

              <textarea
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
                placeholder="Optional clinical notes..."
                rows={3}
              />

            </label>


            {error && (
              <div className="diagnosis-message error">

                <AlertCircle
                  size={15}
                />

                {error}

              </div>
            )}


            {success && (
              <div className="diagnosis-message success">

                <CheckCircle2
                  size={15}
                />

                {success}

              </div>
            )}


            <div className="diagnosis-form-actions">

              <button
                type="submit"
                className="add-diagnosis-button"
                disabled={
                  saving
                }
              >
                <Plus
                  size={16}
                />

                {saving
                  ? 'Saving...'
                  : 'Add Diagnosis'}
              </button>

            </div>

          </div>

        </form>
      )}


      {/* =================================================
          ENCOUNTER DIAGNOSES
      ================================================= */}

      <ConditionList
        title="Encounter Diagnoses"
        subtitle="Diagnoses associated with the current visit"
        conditions={
          encounterConditions
        }
        loading={
          loading
        }
        readOnly={
          readOnly
        }
        onResolve={
          resolveCondition
        }
        onReactivate={
          reactivateCondition
        }
        showRank
      />


      {/* =================================================
          PATIENT PROBLEM LIST
      ================================================= */}

      <ConditionList
        title="Patient Problem List"
        subtitle="Persistent problems available across encounters"
        conditions={
          problemList
        }
        loading={
          loading
        }
        readOnly={
          readOnly
        }
        onResolve={
          resolveCondition
        }
        onReactivate={
          reactivateCondition
        }
      />

    </div>
  );
}


function DiagnosisSummaryCard({
  icon,
  label,
  value,
  textValue = false,
}: {
  icon:
    React.ReactNode;

  label:
    string;

  value:
    string;

  textValue?:
    boolean;
}) {
  return (
    <div className="diagnosis-summary-card">

      <div className="diagnosis-summary-icon">
        {icon}
      </div>

      <div>
        <span>
          {label}
        </span>

        <strong
          className={
            textValue
              ? 'text-value'
              : ''
          }
        >
          {value}
        </strong>
      </div>

    </div>
  );
}


function ConditionList({
  title,
  subtitle,
  conditions,
  loading,
  readOnly,
  showRank = false,
  onResolve,
  onReactivate,
}: {
  title:
    string;

  subtitle:
    string;

  conditions:
    ConditionResponse[];

  loading:
    boolean;

  readOnly:
    boolean;

  showRank?:
    boolean;

  onResolve:
    (
      condition:
        ConditionResponse,
    ) => void;

  onReactivate:
    (
      condition:
        ConditionResponse,
    ) => void;
}) {
  return (
    <section className="condition-list-card">

      <div className="diagnosis-card-heading">

        <div>
          <h2>
            {title}
          </h2>

          <p>
            {subtitle}
          </p>
        </div>

        <span className="condition-count">
          {conditions.length}
        </span>

      </div>


      {loading ? (
        <div className="condition-empty">
          Loading...
        </div>
      ) : conditions.length ===
        0 ? (
        <div className="condition-empty">

          <Stethoscope
            size={24}
          />

          <strong>
            No diagnoses recorded
          </strong>

          <span>
            Clinical diagnoses will appear here.
          </span>

        </div>
      ) : (
        <div className="condition-table-wrapper">

          <table className="condition-table">

            <thead>
              <tr>
                {showRank && (
                  <th>
                    Rank
                  </th>
                )}

                <th>
                  Classification
                </th>

                <th>
                  Diagnosis
                </th>

                <th>
                  Status
                </th>

                <th>
                  Verification
                </th>

                <th>
                  Severity
                </th>

                <th>
                  Recorded
                </th>

                {!readOnly && (
                  <th />
                )}
              </tr>
            </thead>


            <tbody>

              {conditions.map(
                (
                  condition,
                ) => (
                  <tr
                    key={
                      condition.id
                    }
                  >

                    {showRank && (
                      <td>
                        <RankBadge
                          rank={
                            condition.diagnosisRank
                          }
                        />
                      </td>
                    )}


                    <td>
                      <strong className="icd-code">
                        {condition.codeSystem ?? 'ICD-10'}{' '}
                        {condition.diagnosisCode ?? condition.icd10Code ??
                          '-'}
                      </strong>
                    </td>


                    <td>
                      <div className="condition-description">

                        <strong>
                          {condition.description ??
                            '-'}
                        </strong>

                        {condition.note && (
                          <span>
                            {condition.note}
                          </span>
                        )}

                      </div>
                    </td>


                    <td>
                      <StatusBadge
                        status={
                          condition.clinicalStatus
                        }
                      />
                    </td>


                    <td>
                      {formatValue(
                        condition.verificationStatus,
                      )}
                    </td>


                    <td>
                      {condition.severity ??
                        '-'}
                    </td>


                    <td>
                      {formatDate(
                        condition.recordedDate,
                      )}
                    </td>


                    {!readOnly && (
                      <td className="condition-action-cell">

                        {condition.clinicalStatus ===
                        'resolved' ? (
                          <button
                            type="button"
                            className="condition-reactivate"
                            onClick={() =>
                              onReactivate(
                                condition,
                              )
                            }
                          >
                            <RotateCcw
                              size={14}
                            />

                            Reactivate
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="condition-resolve"
                            onClick={() =>
                              onResolve(
                                condition,
                              )
                            }
                          >
                            <CheckCircle2
                              size={14}
                            />

                            Resolve
                          </button>
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


function RankBadge({
  rank,
}: {
  rank?:
    DiagnosisRank;
}) {
  if (
    rank ===
    'primary'
  ) {
    return (
      <span className="rank-badge primary">
        Primary
      </span>
    );
  }

  return (
    <span className="rank-badge secondary">
      Secondary
    </span>
  );
}


function StatusBadge({
  status,
}: {
  status?:
    string;
}) {
  return (
    <span
      className={`condition-status ${status ?? 'unknown'}`}
    >
      <span />

      {formatValue(
        status,
      )}
    </span>
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
      (
        word,
      ) =>
        word
          .charAt(0)
          .toUpperCase() +
        word.slice(
          1,
        ),
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
    new Date(
      value,
    );

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return value;
  }

  return date.toLocaleString();
}
