import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  Activity,
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  CircleDot,
  ClipboardList,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Stethoscope,
} from 'lucide-react';

import {
  useNavigate,
} from 'react-router-dom';

import {
  getPatientProblems,
  updateConditionStatus,
} from '../api/conditionApi';

import type {
  ClinicalStatus,
  ConditionResponse,
} from '../types/condition';

import './PatientProblems.css';


interface PatientProblemsProps {
  patientId: string;
  hospitalId: string;
}


type ProblemFilter =
  | 'all'
  | 'active'
  | 'resolved';


const ACTIVE_STATUSES:
  ClinicalStatus[] = [
    'active',
    'recurrence',
    'relapse',
  ];


const RESOLVED_STATUSES:
  ClinicalStatus[] = [
    'resolved',
    'inactive',
    'remission',
  ];


export default function PatientProblems({
  patientId,
  hospitalId,
}: PatientProblemsProps) {

  const navigate =
    useNavigate();


  const [
    problems,
    setProblems,
  ] =
    useState<ConditionResponse[]>([]);


  const [
    loading,
    setLoading,
  ] =
    useState(true);


  const [
    refreshing,
    setRefreshing,
  ] =
    useState(false);


  const [
    error,
    setError,
  ] =
    useState('');


  const [
    search,
    setSearch,
  ] =
    useState('');


  const [
    filter,
    setFilter,
  ] =
    useState<ProblemFilter>(
      'all',
    );


  const [
    updatingId,
    setUpdatingId,
  ] =
    useState<string>();


  /* =====================================================
     LOAD PROBLEMS
  ===================================================== */

  const loadProblems =
    useCallback(
      async (
        manual = false,
      ) => {

        try {

          if (manual) {
            setRefreshing(true);
          } else {
            setLoading(true);
          }


          setError('');


          const result =
            await getPatientProblems(
              patientId,
              hospitalId,
            );


          const sorted = [
            ...(result.conditions ??
              []),
          ].sort(
            (
              a,
              b,
            ) => {

              const aDate =
                getProblemTime(a);

              const bDate =
                getProblemTime(b);

              return (
                bDate -
                aDate
              );

            },
          );


          setProblems(
            sorted,
          );


        } catch (err) {

          console.error(
            'Unable to load patient problems:',
            err,
          );


          setError(
            'Unable to load the patient problem list.',
          );


        } finally {

          setLoading(false);
          setRefreshing(false);

        }

      },
      [patientId, hospitalId],
    );


  useEffect(() => {

    void loadProblems();

  }, [loadProblems]);


  /* =====================================================
     COUNTS
  ===================================================== */

  const activeProblems =
    useMemo(
      () =>
        problems.filter(
          (
            problem,
          ) =>
            isActiveProblem(
              problem,
            ),
        ),
      [problems],
    );


  const resolvedProblems =
    useMemo(
      () =>
        problems.filter(
          (
            problem,
          ) =>
            isResolvedProblem(
              problem,
            ),
        ),
      [problems],
    );


  const confirmedProblems =
    useMemo(
      () =>
        problems.filter(
          (
            problem,
          ) =>
            problem
              .verificationStatus ===
            'confirmed',
        ).length,
      [problems],
    );


  /* =====================================================
     FILTERED
  ===================================================== */

  const filteredProblems =
    useMemo(
      () => {

        const query =
          search
            .trim()
            .toLowerCase();


        return problems.filter(
          (
            problem,
          ) => {

            if (
              filter ===
                'active' &&
              !isActiveProblem(
                problem,
              )
            ) {
              return false;
            }


            if (
              filter ===
                'resolved' &&
              !isResolvedProblem(
                problem,
              )
            ) {
              return false;
            }


            if (!query) {
              return true;
            }


            const searchable =
              [
                problem.description,
                problem.diagnosisCode ?? problem.icd10Code,
                problem.severity,
                problem.note,
                problem.clinicalStatus,
                problem.verificationStatus,
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
        problems,
        search,
        filter,
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
    problem:
      ConditionResponse,

    clinicalStatus:
      ClinicalStatus,
  ) {

    if (
      !problem.id ||
      updatingId
    ) {
      return;
    }


    try {

      setUpdatingId(
        problem.id,
      );

      setError('');


      const updated =
        await updateConditionStatus(
          problem.id,
          clinicalStatus,
          hospitalId,
        );


      setProblems(
        (
          current,
        ) =>
          current.map(
            (
              item,
            ) =>
              item.id ===
              updated.id
                ? updated
                : item,
          ),
      );


    } catch (err) {

      console.error(
        'Unable to update condition status:',
        err,
      );


      setError(
        'Unable to update the problem status.',
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

      <div className="patient-problems-state">

        <div className="patient-problems-spinner" />

        <strong>
          Loading Problem List
        </strong>

        <span>
          Retrieving longitudinal clinical problems...
        </span>

      </div>

    );

  }


  /* =====================================================
     MAIN
  ===================================================== */

  return (

    <div className="patient-problems">

      {/* =================================================
          HEADER
      ================================================= */}

      <header className="patient-problems-header">

        <div className="patient-problems-title">

          <div className="patient-problems-title-icon">

            <ClipboardList
              size={20}
            />

          </div>

          <div>

            <h2>
              Patient Problem List
            </h2>

            <p>
              Longitudinal clinical problems and diagnoses
            </p>

          </div>

        </div>


        <button
          type="button"
          className="patient-problems-refresh"
          disabled={refreshing}
          onClick={() =>
            void loadProblems(
              true,
            )
          }
        >

          <RefreshCw
            size={14}
            className={
              refreshing
                ? 'problem-spin'
                : undefined
            }
          />

          {refreshing
            ? 'Refreshing...'
            : 'Refresh'}

        </button>

      </header>


      {/* =================================================
          ERROR
      ================================================= */}

      {error && (

        <div className="patient-problems-error">

          <AlertCircle
            size={16}
          />

          <span>
            {error}
          </span>

        </div>

      )}


      {/* =================================================
          SUMMARY CARDS
      ================================================= */}

      <section className="problem-summary-grid">

        <ProblemSummaryCard
          icon={
            <ClipboardList
              size={19}
            />
          }
          label="Total Problems"
          value={
            problems.length
          }
          type="total"
        />


        <ProblemSummaryCard
          icon={
            <Activity
              size={19}
            />
          }
          label="Active Problems"
          value={
            activeProblems.length
          }
          type="active"
        />


        <ProblemSummaryCard
          icon={
            <CheckCircle2
              size={19}
            />
          }
          label="Resolved"
          value={
            resolvedProblems.length
          }
          type="resolved"
        />


        <ProblemSummaryCard
          icon={
            <ShieldCheck
              size={19}
            />
          }
          label="Confirmed"
          value={
            confirmedProblems
          }
          type="confirmed"
        />

      </section>


      {/* =================================================
          TOOLBAR
      ================================================= */}

      <section className="patient-problems-toolbar">

        <div className="patient-problem-search">

          <Search size={14} />

          <input
            value={search}
            onChange={(
              event,
            ) =>
              setSearch(
                event.target.value,
              )
            }
            placeholder="Search by diagnosis, ICD-10/ICD-11, status..."
          />

        </div>


        <div className="problem-filter-group">

          <FilterButton
            label="All"
            count={
              problems.length
            }
            active={
              filter ===
              'all'
            }
            onClick={() =>
              setFilter(
                'all',
              )
            }
          />


          <FilterButton
            label="Active"
            count={
              activeProblems.length
            }
            active={
              filter ===
              'active'
            }
            onClick={() =>
              setFilter(
                'active',
              )
            }
          />


          <FilterButton
            label="Resolved"
            count={
              resolvedProblems.length
            }
            active={
              filter ===
              'resolved'
            }
            onClick={() =>
              setFilter(
                'resolved',
              )
            }
          />

        </div>

      </section>


      {/* =================================================
          LIST
      ================================================= */}

      <section className="patient-problem-list-card">

        <div className="patient-problem-list-heading">

          <div>

            <h3>
              Clinical Problems
            </h3>

            <p>
              FHIR Condition problem-list items
            </p>

          </div>


          <span>
            {filteredProblems.length}
            {' '}
            result
            {filteredProblems.length !==
            1
              ? 's'
              : ''}
          </span>

        </div>


        {filteredProblems.length ===
        0 ? (

          <div className="patient-problems-empty">

            <Stethoscope
              size={30}
            />

            <strong>
              {problems.length ===
              0
                ? 'No problems recorded'
                : 'No matching problems'}
            </strong>

            <span>

              {problems.length ===
              0
                ? 'Problem-list conditions recorded for this patient will appear here.'
                : 'Try changing the filter or search criteria.'}

            </span>

          </div>

        ) : (

          <div className="patient-problem-list">

            {filteredProblems.map(
              (
                problem,
              ) => (

                <ProblemCard
                  key={
                    problem.id
                  }
                  problem={
                    problem
                  }
                  updating={
                    updatingId ===
                    problem.id
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
   PROBLEM CARD
========================================================= */

function ProblemCard({
  problem,
  updating,
  onOpenEncounter,
  onChangeStatus,
}: {
  problem:
    ConditionResponse;

  updating:
    boolean;

  onOpenEncounter:
    (
      encounterId?: string,
    ) => void;

  onChangeStatus:
    (
      problem:
        ConditionResponse,
      status:
        ClinicalStatus,
    ) => Promise<void>;
}) {

  const active =
    isActiveProblem(
      problem,
    );


  const resolved =
    isResolvedProblem(
      problem,
    );


  return (

    <article
      className={
        active
          ? 'patient-problem-card active'
          : 'patient-problem-card'
      }
    >

      <div className="problem-card-status-bar" />


      <div className="problem-card-main">

        <div className="problem-card-icon">

          {active ? (
            <CircleDot
              size={18}
            />
          ) : (
            <CheckCircle2
              size={18}
            />
          )}

        </div>


        <div className="problem-card-content">

          <div className="problem-card-top">

            <div>

              <div className="problem-title-row">

                <h4>
                  {problem.description ||
                    'Unnamed Problem'}
                </h4>


                {(problem.diagnosisCode || problem.icd10Code) && (

                  <span className="problem-icd-code">

                    {problem.codeSystem ?? 'ICD-10'}&nbsp;
                    {
                      problem.diagnosisCode ?? problem.icd10Code
                    }

                  </span>

                )}

              </div>


              <div className="problem-badges">

                <ClinicalStatusBadge
                  status={
                    problem.clinicalStatus
                  }
                />


                {problem.verificationStatus && (

                  <span
                    className={`problem-verification ${problem.verificationStatus}`}
                  >

                    {
                      formatStatus(
                        problem.verificationStatus,
                      )
                    }

                  </span>

                )}


                {problem.severity && (

                  <span className="problem-severity">

                    Severity:
                    {' '}
                    {
                      problem.severity
                    }

                  </span>

                )}

              </div>

            </div>

          </div>


          <div className="problem-details-grid">

            <ProblemDetail
              label="Onset"
              value={
                formatDate(
                  problem.onsetDateTime,
                )
              }
            />


            <ProblemDetail
              label="Recorded"
              value={
                formatDate(
                  problem.recordedDate,
                )
              }
            />


            <ProblemDetail
              label="Resolved"
              value={
                formatDate(
                  problem.abatementDateTime,
                )
              }
            />


            <ProblemDetail
              label="FHIR Type"
              value="Problem List Item"
            />

          </div>


          {problem.note && (

            <div className="problem-note">

              <strong>
                Clinical Note
              </strong>

              <p>
                {problem.note}
              </p>

            </div>

          )}

        </div>

      </div>


      <footer className="problem-card-footer">

        <div className="problem-card-footer-left">

          {problem.encounterId ? (

            <button
              type="button"
              className="problem-open-encounter"
              onClick={() =>
                onOpenEncounter(
                  problem.encounterId,
                )
              }
            >

              Open Encounter

              <ArrowRight
                size={12}
              />

            </button>

          ) : (

            <span className="problem-no-encounter">

              Longitudinal problem

            </span>

          )}

        </div>


        <div className="problem-status-actions">

          {active && (

            <button
              type="button"
              className="problem-resolve-button"
              disabled={
                updating
              }
              onClick={() =>
                void onChangeStatus(
                  problem,
                  'resolved',
                )
              }
            >

              <CheckCircle2
                size={13}
              />

              {updating
                ? 'Updating...'
                : 'Mark Resolved'}

            </button>

          )}


          {resolved && (

            <button
              type="button"
              className="problem-reactivate-button"
              disabled={
                updating
              }
              onClick={() =>
                void onChangeStatus(
                  problem,
                  'active',
                )
              }
            >

              <RotateCcw
                size={12}
              />

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
   SUMMARY CARD
========================================================= */

function ProblemSummaryCard({
  icon,
  label,
  value,
  type,
}: {
  icon:
    React.ReactNode;

  label:
    string;

  value:
    number;

  type:
    'total' |
    'active' |
    'resolved' |
    'confirmed';
}) {

  return (

    <div
      className={`problem-summary-card ${type}`}
    >

      <div className="problem-summary-icon">
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
   FILTER BUTTON
========================================================= */

function FilterButton({
  label,
  count,
  active,
  onClick,
}: {
  label:
    string;

  count:
    number;

  active:
    boolean;

  onClick:
    () => void;
}) {

  return (

    <button
      type="button"
      className={
        active
          ? 'problem-filter active'
          : 'problem-filter'
      }
      onClick={
        onClick
      }
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

function ProblemDetail({
  label,
  value,
}: {
  label:
    string;

  value:
    string;
}) {

  return (

    <div className="problem-detail">

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
   CLINICAL STATUS BADGE
========================================================= */

function ClinicalStatusBadge({
  status,
}: {
  status?:
    ClinicalStatus;
}) {

  const value =
    status ??
    'active';


  return (

    <span
      className={`problem-clinical-status ${value}`}
    >

      {isActiveStatus(
        value,
      ) ? (

        <Activity
          size={10}
        />

      ) : (

        <CheckCircle2
          size={10}
        />

      )}


      {formatStatus(
        value,
      )}

    </span>

  );

}


/* =========================================================
   STATUS HELPERS
========================================================= */

function isActiveStatus(
  status:
    ClinicalStatus,
) {

  return ACTIVE_STATUSES.includes(
    status,
  );

}


function isActiveProblem(
  problem:
    ConditionResponse,
) {

  const status =
    problem.clinicalStatus ??
    'active';


  return ACTIVE_STATUSES.includes(
    status,
  );

}


function isResolvedProblem(
  problem:
    ConditionResponse,
) {

  if (
    !problem.clinicalStatus
  ) {
    return false;
  }


  return RESOLVED_STATUSES.includes(
    problem.clinicalStatus,
  );

}


/* =========================================================
   FORMAT
========================================================= */

function formatStatus(
  value:
    string,
) {

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
      year:
        'numeric',
      month:
        'short',
      day:
        '2-digit',
    },
  );

}


function getProblemTime(
  problem:
    ConditionResponse,
) {

  const value =
    problem.recordedDate ??
    problem.onsetDateTime;


  if (!value) {
    return 0;
  }


  const date =
    new Date(value);


  return Number.isNaN(
    date.getTime(),
  )
    ? 0
    : date.getTime();

}
