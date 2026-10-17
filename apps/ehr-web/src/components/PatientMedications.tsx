import {
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  Activity,
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock3,
  ExternalLink,
  PauseCircle,
  Pill,
  RefreshCw,
  Search,
  StopCircle,
} from 'lucide-react';

import {
  useNavigate,
} from 'react-router-dom';

import {
  getPatientMedications,
  updateMedicationStatus,
} from '../api/medicationApi';

import type {
  MedicationRequestStatus,
  MedicationResponse,
} from '../types/medication';

import './PatientMedications.css';


interface PatientMedicationsProps {
  patientId: string;
  hospitalId: string;
}


type FilterType =
  | 'all'
  | 'active'
  | 'on-hold'
  | 'completed'
  | 'stopped';


export default function PatientMedications({
  patientId,
  hospitalId,
}: PatientMedicationsProps) {

  const navigate =
    useNavigate();


  const [
    medications,
    setMedications,
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
    useState<FilterType>(
      'all',
    );


  const [
    updatingId,
    setUpdatingId,
  ] =
    useState<string | null>(
      null,
    );


  /* =====================================================
     LOAD
  ===================================================== */

  async function loadMedications(
    manual = false,
  ) {

    try {

      if (manual) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }


      setError('');


      const response =
        await getPatientMedications(
          patientId,
        );


      const sorted =
        [...(
          response.medications ??
          []
        )].sort(
          (
            a,
            b,
          ) => {

            const aDate =
              a.authoredOn
                ? new Date(
                    a.authoredOn,
                  ).getTime()
                : 0;


            const bDate =
              b.authoredOn
                ? new Date(
                    b.authoredOn,
                  ).getTime()
                : 0;


            return (
              bDate -
              aDate
            );

          },
        );


      setMedications(
        sorted,
      );


    } catch (err) {

      console.error(
        'Failed to load patient medications:',
        err,
      );


      setError(
        'Unable to load patient medications.',
      );


    } finally {

      setLoading(false);
      setRefreshing(false);

    }

  }


  useEffect(() => {

    void loadMedications();

  }, [patientId]);


  /* =====================================================
     COUNTS
  ===================================================== */

  const activeCount =
    useMemo(
      () =>
        medications.filter(
          (
            medication,
          ) =>
            medication.status ===
            'active',
        ).length,
      [medications],
    );


  const onHoldCount =
    useMemo(
      () =>
        medications.filter(
          (
            medication,
          ) =>
            medication.status ===
            'on-hold',
        ).length,
      [medications],
    );


  const completedCount =
    useMemo(
      () =>
        medications.filter(
          (
            medication,
          ) =>
            medication.status ===
            'completed',
        ).length,
      [medications],
    );


  const stoppedCount =
    useMemo(
      () =>
        medications.filter(
          (
            medication,
          ) =>
            medication.status ===
              'stopped' ||
            medication.status ===
              'cancelled',
        ).length,
      [medications],
    );


  /* =====================================================
     FILTER
  ===================================================== */

  const filteredMedications =
    useMemo(
      () => {

        const term =
          search
            .trim()
            .toLowerCase();


        return medications.filter(
          (
            medication,
          ) => {

            const matchesFilter =
              filter ===
                'all' ||
              medication.status ===
                filter;


            if (
              !matchesFilter
            ) {
              return false;
            }


            if (!term) {
              return true;
            }


            const haystack = [
              medication.medicationName,
              medication.medicationCode,
              medication.status,
              medication.route,
              medication.frequency,
              medication.instructions,
              medication.dose?.toString(),
              medication.doseUnit,
              medication.requester,
            ]
              .filter(Boolean)
              .join(' ')
              .toLowerCase();


            return haystack.includes(
              term,
            );

          },
        );

      },
      [
        medications,
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
    medication:
      MedicationResponse,

    status:
      MedicationRequestStatus,
  ) {

    if (!medication.id) {
      return;
    }


    try {

      setUpdatingId(
        medication.id,
      );


      setError('');


      const updated =
        await updateMedicationStatus(
          medication.id,
          status,
        );


      setMedications(
        (
          current,
        ) =>
          current.map(
            (
              item,
            ) =>
              item.id ===
              medication.id
                ? updated
                : item,
          ),
      );


    } catch (err) {

      console.error(
        'Failed to update medication status:',
        err,
      );


      setError(
        'Unable to update medication status.',
      );


    } finally {

      setUpdatingId(
        null,
      );

    }

  }


  /* =====================================================
     LOADING
  ===================================================== */

  if (loading) {

    return (

      <div className="patient-medications-state">

        <div className="patient-medications-spinner" />

        <strong>
          Loading Medications
        </strong>

        <span>
          Retrieving longitudinal medication history...
        </span>

      </div>

    );

  }


  return (

    <div className="patient-medications">

      {/* =================================================
          HEADER
      ================================================= */}

      <header className="patient-medications-header">

        <div className="patient-medications-heading">

          <div className="patient-medications-heading-icon">

            <Pill
              size={20}
            />

          </div>


          <div>

            <h2>
              Patient Medications
            </h2>

            <p>
              Longitudinal medication history across all encounters
            </p>

          </div>

        </div>


        <button
          type="button"
          className="patient-medications-refresh"
          disabled={
            refreshing
          }
          onClick={() =>
            void loadMedications(
              true,
            )
          }
        >

          <RefreshCw
            size={14}
            className={
              refreshing
                ? 'medication-spin'
                : undefined
            }
          />

          {refreshing
            ? 'Refreshing...'
            : 'Refresh'}

        </button>

      </header>


      {/* =================================================
          SUMMARY
      ================================================= */}

      <div className="patient-medication-summary">

        <MedicationSummaryCard
          icon={
            <Pill size={17} />
          }
          label="Total"
          value={
            medications.length
          }
        />


        <MedicationSummaryCard
          icon={
            <Activity size={17} />
          }
          label="Active"
          value={
            activeCount
          }
          type="active"
        />


        <MedicationSummaryCard
          icon={
            <PauseCircle size={17} />
          }
          label="On Hold"
          value={
            onHoldCount
          }
          type="hold"
        />


        <MedicationSummaryCard
          icon={
            <CheckCircle2 size={17} />
          }
          label="Completed"
          value={
            completedCount
          }
          type="completed"
        />


        <MedicationSummaryCard
          icon={
            <StopCircle size={17} />
          }
          label="Stopped"
          value={
            stoppedCount
          }
          type="stopped"
        />

      </div>


      {/* =================================================
          ERROR
      ================================================= */}

      {error && (

        <div className="patient-medications-error">

          <AlertTriangle
            size={15}
          />

          {error}

        </div>

      )}


      {/* =================================================
          TOOLBAR
      ================================================= */}

      <div className="patient-medications-toolbar">

        <div className="patient-medications-search">

          <Search
            size={14}
          />

          <input
            value={
              search
            }
            onChange={
              (
                event,
              ) =>
                setSearch(
                  event.target.value,
                )
            }
            placeholder="Search medication, code, route, frequency..."
          />

        </div>


        <div className="patient-medications-filters">

          <FilterButton
            active={
              filter ===
              'all'
            }
            onClick={() =>
              setFilter(
                'all',
              )
            }
          >
            All
          </FilterButton>


          <FilterButton
            active={
              filter ===
              'active'
            }
            onClick={() =>
              setFilter(
                'active',
              )
            }
          >
            Active
          </FilterButton>


          <FilterButton
            active={
              filter ===
              'on-hold'
            }
            onClick={() =>
              setFilter(
                'on-hold',
              )
            }
          >
            On Hold
          </FilterButton>


          <FilterButton
            active={
              filter ===
              'completed'
            }
            onClick={() =>
              setFilter(
                'completed',
              )
            }
          >
            Completed
          </FilterButton>


          <FilterButton
            active={
              filter ===
              'stopped'
            }
            onClick={() =>
              setFilter(
                'stopped',
              )
            }
          >
            Stopped
          </FilterButton>

        </div>

      </div>


      {/* =================================================
          MEDICATIONS
      ================================================= */}

      {filteredMedications.length ===
      0 ? (

        <div className="patient-medications-empty">

          <Pill
            size={32}
          />

          <strong>

            {medications.length ===
            0
              ? 'No medications recorded'
              : 'No medications match your search'}

          </strong>

          <span>

            {medications.length ===
            0
              ? 'Medication orders from patient encounters will appear here.'
              : 'Try changing the search text or medication status filter.'}

          </span>

        </div>

      ) : (

        <div className="patient-medication-list">

          {filteredMedications.map(
            (
              medication,
              index,
            ) => (

              <MedicationCard
                key={
                  medication.id ??
                  index
                }
                medication={
                  medication
                }
                updating={
                  updatingId ===
                  medication.id
                }
                onOpenEncounter={() =>
                  openEncounter(
                    medication.encounterId,
                  )
                }
                onStatusChange={
                  (
                    status,
                  ) =>
                    void changeStatus(
                      medication,
                      status,
                    )
                }
              />

            ),
          )}

        </div>

      )}

    </div>

  );

}


/* =========================================================
   SUMMARY CARD
========================================================= */

function MedicationSummaryCard({
  icon,
  label,
  value,
  type = 'default',
}: {
  icon:
    React.ReactNode;

  label:
    string;

  value:
    number;

  type?:
    'default' |
    'active' |
    'hold' |
    'completed' |
    'stopped';
}) {

  return (

    <div
      className={
        `patient-medication-summary-card ${type}`
      }
    >

      <div className="patient-medication-summary-icon">
        {icon}
      </div>


      <div>

        <strong>
          {value}
        </strong>

        <span>
          {label}
        </span>

      </div>

    </div>

  );

}


/* =========================================================
   FILTER BUTTON
========================================================= */

function FilterButton({
  active,
  onClick,
  children,
}: {
  active:
    boolean;

  onClick:
    () => void;

  children:
    React.ReactNode;
}) {

  return (

    <button
      type="button"
      className={
        active
          ? 'patient-medication-filter active'
          : 'patient-medication-filter'
      }
      onClick={
        onClick
      }
    >

      {children}

    </button>

  );

}


/* =========================================================
   MEDICATION CARD
========================================================= */

function MedicationCard({
  medication,
  updating,
  onOpenEncounter,
  onStatusChange,
}: {
  medication:
    MedicationResponse;

  updating:
    boolean;

  onOpenEncounter:
    () => void;

  onStatusChange:
    (
      status:
        MedicationRequestStatus,
    ) => void;
}) {

  const status =
    medication.status ??
    'unknown';


  const dose =
    medication.dose !==
    undefined
      ? `${medication.dose}${medication.doseUnit
          ? ` ${medication.doseUnit}`
          : ''}`
      : '—';


  return (

    <article
      className={
        `patient-medication-card status-${status}`
      }
    >

      <div className="patient-medication-status-bar" />


      <div className="patient-medication-card-header">

        <div className="patient-medication-name">

          <div className="patient-medication-icon">

            <Pill
              size={18}
            />

          </div>


          <div>

            <div className="patient-medication-title-row">

              <h3>

                {medication.medicationName ??
                  'Unknown Medication'}

              </h3>


              <MedicationStatus
                status={
                  status
                }
              />


              {medication.priority &&
                medication.priority !==
                  'routine' && (

                <span
                  className={
                    `patient-medication-priority ${medication.priority}`
                  }
                >

                  {
                    medication.priority
                  }

                </span>

              )}

            </div>


            {medication.medicationCode && (

              <span className="patient-medication-code">

                Code: {
                  medication.medicationCode
                }

              </span>

            )}

          </div>

        </div>


        {medication.encounterId && (

          <button
            type="button"
            className="patient-medication-encounter"
            onClick={
              onOpenEncounter
            }
          >

            <ExternalLink
              size={12}
            />

            Open Encounter

          </button>

        )}

      </div>


      {/* =================================================
          CLINICAL DETAILS
      ================================================= */}

      <div className="patient-medication-details">

        <MedicationDetail
          label="Dose"
          value={
            dose
          }
        />


        <MedicationDetail
          label="Route"
          value={
            medication.route ??
            '—'
          }
        />


        <MedicationDetail
          label="Frequency"
          value={
            medication.frequency ??
            '—'
          }
        />


        <MedicationDetail
          label="Duration"
          value={
            medication.durationDays !==
            undefined
              ? `${medication.durationDays} days`
              : '—'
          }
        />


        <MedicationDetail
          label="Quantity"
          value={
            medication.quantity !==
            undefined
              ? `${medication.quantity}${medication.quantityUnit
                  ? ` ${medication.quantityUnit}`
                  : ''}`
              : '—'
          }
        />


        <MedicationDetail
          label="PRN"
          value={
            medication.asNeeded
              ? 'Yes'
              : 'No'
          }
        />

      </div>


      {/* =================================================
          DATES
      ================================================= */}

      <div className="patient-medication-dates">

        <MedicationDate
          icon={
            <Clock3
              size={12}
            />
          }
          label="Ordered"
          value={
            formatDateTime(
              medication.authoredOn,
            )
          }
        />


        <MedicationDate
          icon={
            <CalendarDays
              size={12}
            />
          }
          label="Start"
          value={
            formatDate(
              medication.startDate,
            )
          }
        />


        <MedicationDate
          icon={
            <CalendarDays
              size={12}
            />
          }
          label="End"
          value={
            formatDate(
              medication.endDate,
            )
          }
        />

      </div>


      {/* =================================================
          INSTRUCTIONS
      ================================================= */}

      {medication.instructions && (

        <div className="patient-medication-instructions">

          <span>
            Instructions
          </span>

          <p>
            {medication.instructions}
          </p>

        </div>

      )}


      {/* =================================================
          REQUESTER
      ================================================= */}

      {medication.requester && (

        <div className="patient-medication-requester">

          Ordered by:

          <strong>
            {formatRequester(
              medication.requester,
            )}
          </strong>

        </div>

      )}


      {/* =================================================
          ACTIONS
      ================================================= */}

      <div className="patient-medication-actions">

        {status ===
          'active' && (

          <>

            <button
              type="button"
              className="medication-action hold"
              disabled={
                updating
              }
              onClick={() =>
                onStatusChange(
                  'on-hold',
                )
              }
            >

              <PauseCircle
                size={12}
              />

              Hold

            </button>


            <button
              type="button"
              className="medication-action complete"
              disabled={
                updating
              }
              onClick={() =>
                onStatusChange(
                  'completed',
                )
              }
            >

              <CheckCircle2
                size={12}
              />

              Complete

            </button>


            <button
              type="button"
              className="medication-action stop"
              disabled={
                updating
              }
              onClick={() =>
                onStatusChange(
                  'stopped',
                )
              }
            >

              <StopCircle
                size={12}
              />

              Stop

            </button>

          </>

        )}


        {status ===
          'on-hold' && (

          <button
            type="button"
            className="medication-action resume"
            disabled={
              updating
            }
            onClick={() =>
              onStatusChange(
                'active',
              )
            }
          >

            <Activity
              size={12}
            />

            Resume

          </button>

        )}


        {updating && (

          <span className="patient-medication-updating">

            Updating...

          </span>

        )}

      </div>

    </article>

  );

}


/* =========================================================
   STATUS
========================================================= */

function MedicationStatus({
  status,
}: {
  status:
    MedicationRequestStatus;
}) {

  return (

    <span
      className={
        `patient-medication-status ${status}`
      }
    >

      {status ===
        'on-hold'
        ? 'On Hold'
        : capitalize(
            status,
          )}

    </span>

  );

}


/* =========================================================
   DETAIL
========================================================= */

function MedicationDetail({
  label,
  value,
}: {
  label:
    string;

  value:
    string;
}) {

  return (

    <div className="patient-medication-detail">

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
   DATE
========================================================= */

function MedicationDate({
  icon,
  label,
  value,
}: {
  icon:
    React.ReactNode;

  label:
    string;

  value:
    string;
}) {

  return (

    <div className="patient-medication-date">

      {icon}

      <span>
        {label}:
      </span>

      <strong>
        {value}
      </strong>

    </div>

  );

}


/* =========================================================
   HELPERS
========================================================= */

function capitalize(
  value:
    string,
) {

  if (!value) {
    return value;
  }


  return (
    value.charAt(0).toUpperCase() +
    value.slice(1)
  );

}


function formatRequester(
  requester:
    string,
) {

  if (
    requester.startsWith(
      'Practitioner/',
    )
  ) {

    return `Practitioner ${requester.replace(
      'Practitioner/',
      '',
    )}`;

  }


  if (
    requester.startsWith(
      'Organization/',
    )
  ) {

    return `Organization ${requester.replace(
      'Organization/',
      '',
    )}`;

  }


  return requester;

}


function formatDate(
  value?: string,
) {

  if (!value) {
    return '—';
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


  return date.toLocaleDateString();

}


function formatDateTime(
  value?: string,
) {

  if (!value) {
    return '—';
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