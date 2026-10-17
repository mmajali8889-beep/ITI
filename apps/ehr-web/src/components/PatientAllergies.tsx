import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  AlertCircle,
  AlertOctagon,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleSlash,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Stethoscope,
} from 'lucide-react';

import {
  useNavigate,
} from 'react-router-dom';

import {
  getPatientAllergies,
  updateAllergyStatus,
} from '../api/allergyApi';

import type {
  AllergyClinicalStatus,
  AllergyResponse,
} from '../types/allergy';

import './PatientAllergies.css';


interface PatientAllergiesProps {
  patientId: string;
  hospitalId: string;
}

type AllergyFilter =
  | 'all'
  | 'active'
  | 'high-risk'
  | 'resolved';


export default function PatientAllergies({
  patientId,
  hospitalId,
}: PatientAllergiesProps) {

  const navigate = useNavigate();

  const [
    allergies,
    setAllergies,
  ] = useState<AllergyResponse[]>([]);

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    refreshing,
    setRefreshing,
  ] = useState(false);

  const [
    error,
    setError,
  ] = useState('');

  const [
    search,
    setSearch,
  ] = useState('');

  const [
    filter,
    setFilter,
  ] = useState<AllergyFilter>('all');

  const [
    updatingId,
    setUpdatingId,
  ] = useState<string>();


  /* =====================================================
     LOAD
  ===================================================== */

  const loadAllergies = useCallback(
    async (manual = false) => {

      try {

        if (manual) {
          setRefreshing(true);
        } else {
          setLoading(true);
        }

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
          'Unable to load patient allergies:',
          err,
        );

        setError(
          'Unable to load the patient allergy list.',
        );

      } finally {

        setLoading(false);
        setRefreshing(false);

      }

    },
    [patientId],
  );


  useEffect(() => {

    void loadAllergies();

  }, [loadAllergies]);


  /* =====================================================
     COUNTS
  ===================================================== */

  const activeAllergies =
    useMemo(
      () =>
        allergies.filter(
          (item) =>
            item.clinicalStatus ===
            'active',
        ),
      [allergies],
    );


  const criticalAllergies =
    useMemo(
      () =>
        activeAllergies.filter(
          (item) =>
            item.criticality ===
              'high' ||
            item.severity ===
              'severe',
        ),
      [activeAllergies],
    );


  const medicationAllergies =
    useMemo(
      () =>
        activeAllergies.filter(
          (item) =>
            item.category ===
            'medication',
        ),
      [activeAllergies],
    );


  const resolvedAllergies =
    useMemo(
      () =>
        allergies.filter(
          (item) =>
            item.clinicalStatus ===
              'resolved' ||
            item.clinicalStatus ===
              'inactive',
        ),
      [allergies],
    );


  /* =====================================================
     FILTER
  ===================================================== */

  const filteredAllergies =
    useMemo(
      () => {

        const query =
          search
            .trim()
            .toLowerCase();

        return allergies.filter(
          (allergy) => {

            if (
              filter === 'active' &&
              allergy.clinicalStatus !==
                'active'
            ) {
              return false;
            }

            if (
              filter === 'high-risk' &&
              !(
                allergy.clinicalStatus ===
                  'active' &&
                (
                  allergy.criticality ===
                    'high' ||
                  allergy.severity ===
                    'severe'
                )
              )
            ) {
              return false;
            }

            if (
              filter === 'resolved' &&
              allergy.clinicalStatus !==
                'resolved' &&
              allergy.clinicalStatus !==
                'inactive'
            ) {
              return false;
            }

            if (!query) {
              return true;
            }

            const searchable = [
              allergy.display,
              allergy.code,
              allergy.category,
              allergy.type,
              allergy.reaction,
              allergy.severity,
              allergy.criticality,
              allergy.note,
              allergy.clinicalStatus,
              allergy.verificationStatus,
            ]
              .filter(Boolean)
              .join(' ')
              .toLowerCase();

            return searchable.includes(
              query,
            );

          },
        );

      },
      [
        allergies,
        filter,
        search,
      ],
    );


  /* =====================================================
     OPEN ENCOUNTER
  ===================================================== */

  function openEncounter(
    encounterId?: string,
  ) {

    if (!encounterId) {
      return;
    }

    navigate(
      `/hospital/${hospitalId}/patient/${patientId}/encounter/${encounterId}`,
    );

  }


  /* =====================================================
     UPDATE STATUS
  ===================================================== */

  async function changeStatus(
    allergy: AllergyResponse,
    status: AllergyClinicalStatus,
  ) {

    if (
      !allergy.id ||
      updatingId
    ) {
      return;
    }

    try {

      setUpdatingId(
        allergy.id,
      );

      setError('');

      const updated =
        await updateAllergyStatus(
          allergy.id,
          status,
        );

      setAllergies(
        (current) =>
          current.map(
            (item) =>
              item.id === updated.id
                ? updated
                : item,
          ),
      );

    } catch (err) {

      console.error(
        'Unable to update allergy:',
        err,
      );

      setError(
        'Unable to update allergy status.',
      );

    } finally {

      setUpdatingId(
        undefined,
      );

    }

  }


  /* =====================================================
     LOADING
  ===================================================== */

  if (loading) {

    return (

      <div className="patient-allergies-state">

        <div className="patient-allergies-spinner" />

        <strong>
          Loading Allergies
        </strong>

        <span>
          Retrieving patient allergy and intolerance information...
        </span>

      </div>

    );

  }


  return (

    <div className="patient-allergies">

      {/* HEADER */}

      <header className="patient-allergies-header">

        <div className="patient-allergies-title">

          <div className="patient-allergies-title-icon">
            <ShieldAlert size={20} />
          </div>

          <div>

            <h2>
              Allergies & Intolerances
            </h2>

            <p>
              Longitudinal FHIR AllergyIntolerance record
            </p>

          </div>

        </div>


        <button
          type="button"
          className="patient-allergies-refresh"
          disabled={refreshing}
          onClick={() =>
            void loadAllergies(true)
          }
        >

          <RefreshCw
            size={14}
            className={
              refreshing
                ? 'allergy-spin'
                : undefined
            }
          />

          {refreshing
            ? 'Refreshing...'
            : 'Refresh'}

        </button>

      </header>


      {/* ERROR */}

      {error && (

        <div className="patient-allergies-error">

          <AlertCircle size={16} />

          {error}

        </div>

      )}


      {/* CRITICAL ALERT */}

      {criticalAllergies.length > 0 && (

        <section className="critical-allergy-alert">

          <div className="critical-allergy-icon">

            <AlertOctagon size={25} />

          </div>

          <div className="critical-allergy-content">

            <strong>
              CRITICAL ALLERGY ALERT
            </strong>

            <span>
              This patient has high-risk active allergies.
              Review before prescribing or administering medication.
            </span>

            <div className="critical-allergy-items">

              {criticalAllergies.map(
                (allergy) => (

                  <span
                    key={
                      allergy.id ??
                      allergy.display
                    }
                  >
                    <AlertTriangle
                      size={11}
                    />

                    {allergy.display ??
                      'Unknown Allergy'}

                    {allergy.reaction
                      ? ` — ${allergy.reaction}`
                      : ''}

                  </span>

                ),
              )}

            </div>

          </div>

        </section>

      )}


      {/* SUMMARY */}

      <section className="allergy-summary-grid">

        <SummaryCard
          type="total"
          icon={
            <ShieldAlert size={19} />
          }
          label="Total Allergies"
          value={allergies.length}
        />

        <SummaryCard
          type="active"
          icon={
            <AlertTriangle size={19} />
          }
          label="Active"
          value={activeAllergies.length}
        />

        <SummaryCard
          type="critical"
          icon={
            <AlertOctagon size={19} />
          }
          label="High Risk"
          value={criticalAllergies.length}
        />

        <SummaryCard
          type="medication"
          icon={
            <Stethoscope size={19} />
          }
          label="Medication"
          value={medicationAllergies.length}
        />

      </section>


      {/* TOOLBAR */}

      <section className="patient-allergies-toolbar">

        <div className="patient-allergy-search">

          <Search size={14} />

          <input
            value={search}
            onChange={(event) =>
              setSearch(
                event.target.value,
              )
            }
            placeholder="Search allergy, reaction, category..."
          />

        </div>


        <div className="allergy-filter-group">

          <FilterButton
            label="All"
            count={allergies.length}
            active={filter === 'all'}
            onClick={() =>
              setFilter('all')
            }
          />

          <FilterButton
            label="Active"
            count={activeAllergies.length}
            active={filter === 'active'}
            onClick={() =>
              setFilter('active')
            }
          />

          <FilterButton
            label="High Risk"
            count={criticalAllergies.length}
            active={
              filter === 'high-risk'
            }
            danger
            onClick={() =>
              setFilter('high-risk')
            }
          />

          <FilterButton
            label="Resolved"
            count={resolvedAllergies.length}
            active={
              filter === 'resolved'
            }
            onClick={() =>
              setFilter('resolved')
            }
          />

        </div>

      </section>


      {/* LIST */}

      <section className="patient-allergy-list-container">

        <div className="patient-allergy-list-heading">

          <div>

            <h3>
              Allergy List
            </h3>

            <p>
              Clinical allergy and intolerance history
            </p>

          </div>

          <span>
            {filteredAllergies.length}
            {' '}
            result
            {filteredAllergies.length !== 1
              ? 's'
              : ''}
          </span>

        </div>


        {filteredAllergies.length === 0 ? (

          <div className="patient-allergies-empty">

            <ShieldCheck size={32} />

            <strong>
              {allergies.length === 0
                ? 'No allergies recorded'
                : 'No matching allergies'}
            </strong>

            <span>
              {allergies.length === 0
                ? 'No AllergyIntolerance records are currently documented for this patient.'
                : 'Try changing the search or filter.'}
            </span>

          </div>

        ) : (

          <div className="patient-allergy-list">

            {filteredAllergies.map(
              (allergy) => (

                <AllergyCard
                  key={
                    allergy.id ??
                    `${allergy.code}-${allergy.recordedDate}`
                  }
                  allergy={allergy}
                  updating={
                    updatingId ===
                    allergy.id
                  }
                  onOpenEncounter={
                    openEncounter
                  }
                  onChangeStatus={
                    changeStatus
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


/* =========================================================
   ALLERGY CARD
========================================================= */

function AllergyCard({
  allergy,
  updating,
  onOpenEncounter,
  onChangeStatus,
}: {
  allergy: AllergyResponse;

  updating: boolean;

  onOpenEncounter:
    (encounterId?: string) => void;

  onChangeStatus:
    (
      allergy: AllergyResponse,
      status: AllergyClinicalStatus,
    ) => Promise<void>;
}) {

  const active =
    allergy.clinicalStatus ===
    'active';

  const highRisk =
    active &&
    (
      allergy.criticality ===
        'high' ||
      allergy.severity ===
        'severe'
    );


  return (

    <article
      className={[
        'patient-allergy-card',
        active ? 'active' : '',
        highRisk ? 'critical' : '',
      ].join(' ')}
    >

      <div className="allergy-card-risk-bar" />


      <div className="allergy-card-main">

        <div className="allergy-card-icon">

          {highRisk ? (
            <AlertOctagon size={19} />
          ) : active ? (
            <AlertTriangle size={19} />
          ) : (
            <CheckCircle2 size={19} />
          )}

        </div>


        <div className="allergy-card-content">

          <div className="allergy-card-title-row">

            <div>

              <div className="allergy-name-row">

                <h4>
                  {allergy.display ??
                    'Unknown Allergy'}
                </h4>

                {highRisk && (

                  <span className="allergy-high-risk">

                    <AlertOctagon
                      size={10}
                    />

                    HIGH RISK

                  </span>

                )}

              </div>


              <div className="allergy-badges">

                <span
                  className={`allergy-clinical-status ${
                    allergy.clinicalStatus ??
                    'active'
                  }`}
                >
                  {formatStatus(
                    allergy.clinicalStatus ??
                      'active',
                  )}
                </span>


                {allergy.category && (

                  <span className="allergy-category">
                    {formatStatus(
                      allergy.category,
                    )}
                  </span>

                )}


                {allergy.type && (

                  <span className="allergy-type">
                    {formatStatus(
                      allergy.type,
                    )}
                  </span>

                )}


                {allergy.verificationStatus && (

                  <span
                    className={`allergy-verification ${allergy.verificationStatus}`}
                  >
                    {formatStatus(
                      allergy.verificationStatus,
                    )}
                  </span>

                )}

              </div>

            </div>

          </div>


          <div className="allergy-clinical-grid">

            <AllergyDetail
              label="Reaction"
              value={
                allergy.reaction ??
                'Not documented'
              }
              danger={highRisk}
            />

            <AllergyDetail
              label="Severity"
              value={
                allergy.severity
                  ? formatStatus(
                      allergy.severity,
                    )
                  : 'Not documented'
              }
              danger={
                allergy.severity ===
                'severe'
              }
            />

            <AllergyDetail
              label="Criticality"
              value={
                allergy.criticality
                  ? formatStatus(
                      allergy.criticality,
                    )
                  : 'Not assessed'
              }
              danger={
                allergy.criticality ===
                'high'
              }
            />

            <AllergyDetail
              label="Onset"
              value={
                formatDate(
                  allergy.onsetDateTime,
                )
              }
            />

            <AllergyDetail
              label="Recorded"
              value={
                formatDate(
                  allergy.recordedDate,
                )
              }
            />

            <AllergyDetail
              label="Code"
              value={
                allergy.code ?? '—'
              }
            />

          </div>


          {allergy.note && (

            <div className="allergy-note">

              <strong>
                Clinical Note
              </strong>

              <p>
                {allergy.note}
              </p>

            </div>

          )}

        </div>

      </div>


      <footer className="allergy-card-footer">

        <div>

          {allergy.encounterId ? (

            <button
              type="button"
              className="allergy-open-encounter"
              onClick={() =>
                onOpenEncounter(
                  allergy.encounterId,
                )
              }
            >

              Open Encounter

              <ArrowRight size={12} />

            </button>

          ) : (

            <span className="allergy-longitudinal">
              Patient-level allergy
            </span>

          )}

        </div>


        <div className="allergy-status-actions">

          {active ? (

            <button
              type="button"
              className="allergy-resolve-button"
              disabled={updating}
              onClick={() =>
                void onChangeStatus(
                  allergy,
                  'resolved',
                )
              }
            >

              <CircleSlash size={12} />

              {updating
                ? 'Updating...'
                : 'Mark Resolved'}

            </button>

          ) : (

            <button
              type="button"
              className="allergy-reactivate-button"
              disabled={updating}
              onClick={() =>
                void onChangeStatus(
                  allergy,
                  'active',
                )
              }
            >

              <RotateCcw size={12} />

              {updating
                ? 'Updating...'
                : 'Reactivate'}

            </button>

          )}

        </div>

      </footer>

    </article>

  );

}


/* =========================================================
   SUMMARY
========================================================= */

function SummaryCard({
  icon,
  label,
  value,
  type,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  type:
    | 'total'
    | 'active'
    | 'critical'
    | 'medication';
}) {

  return (

    <div
      className={`allergy-summary-card ${type}`}
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


/* =========================================================
   FILTER
========================================================= */

function FilterButton({
  label,
  count,
  active,
  danger = false,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  danger?: boolean;
  onClick: () => void;
}) {

  return (

    <button
      type="button"
      className={[
        'allergy-filter',
        active ? 'active' : '',
        danger ? 'danger' : '',
      ].join(' ')}
      onClick={onClick}
    >

      {label}

      <span>
        {count}
      </span>

    </button>

  );

}


/* =========================================================
   DETAIL
========================================================= */

function AllergyDetail({
  label,
  value,
  danger = false,
}: {
  label: string;
  value: string;
  danger?: boolean;
}) {

  return (

    <div
      className={
        danger
          ? 'allergy-detail danger'
          : 'allergy-detail'
      }
    >

      <span>
        {label}
      </span>

      <strong>
        {value}
      </strong>

    </div>

  );

}


/* =========================================================
   FORMAT
========================================================= */

function formatStatus(
  value: string,
) {

  return value
    .split('-')
    .map(
      (part) =>
        part
          .charAt(0)
          .toUpperCase() +
        part.slice(1),
    )
    .join(' ');

}


function formatDate(
  value?: string,
) {

  if (!value) {
    return '—';
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

  return date.toLocaleDateString(
    undefined,
    {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
    },
  );

}