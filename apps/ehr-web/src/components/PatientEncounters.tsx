import {
  useEffect,
  useState,
} from 'react';

import {
  useNavigate,
} from 'react-router-dom';

import {
  Activity,
  ArrowRight,
  Calendar,
  CheckCircle2,
  ClipboardList,
  RefreshCw,
  Stethoscope,
  UserRound,
} from 'lucide-react';

import axios from 'axios';

import './PatientEncounters.css';


interface PatientEncountersProps {
  patientId: string;
  hospitalId: string;
}


interface PatientEncounter {
  id?: string;

  status?: string;

  encounterType?: string;

  encounterTypeDisplay?: string;

  classDisplay?: string;

  department?: string;

  practitionerName?: string;

  reason?: string;

  startDateTime?: string;

  endDateTime?: string;
}


interface EncounterListResponse {
  total?: number;

  encounters?: PatientEncounter[];
}


const api =
  axios.create({
    baseURL:
      'http://localhost:4000/api',
    withCredentials: true,
  });


export default function PatientEncounters({
  patientId,
  hospitalId,
}: PatientEncountersProps) {

  const navigate =
    useNavigate();


  const [
    encounters,
    setEncounters,
  ] =
    useState<PatientEncounter[]>(
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


  /* =====================================================
     LOAD
  ===================================================== */

  useEffect(() => {

    void loadEncounters();

  }, [patientId, hospitalId]);


  async function loadEncounters(
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
        await api.get<EncounterListResponse>(
          '/encounters',
          {
            params: {
              patientId,
              hospitalId,
            },
          },
        );


      setEncounters(
        response.data.encounters ??
        [],
      );


    } catch (err) {

      console.error(
        'Unable to load patient encounters:',
        err,
      );


      setError(
        axios.isAxiosError(err)
          ? err.response?.data?.message ??
              'Unable to load patient encounters.'
          : 'Unable to load patient encounters.',
      );


    } finally {

      setLoading(false);
      setRefreshing(false);

    }

  }


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
     LOADING
  ===================================================== */

  if (loading) {

    return (

      <div className="patient-encounters-state">

        <div className="patient-encounters-spinner" />

        <strong>
          Loading Encounters
        </strong>

        <span>
          Retrieving patient encounter history...
        </span>

      </div>

    );

  }


  return (

    <div className="patient-encounters">

      {/* =================================================
          HEADER
      ================================================= */}

      <header className="patient-encounters-header">

        <div className="patient-encounters-title">

          <div className="patient-encounters-title-icon">

            <ClipboardList
              size={20}
            />

          </div>


          <div>

            <h2>
              Encounter History
            </h2>

            <p>
              All clinical encounters for this patient
            </p>

          </div>

        </div>


        <button
          type="button"
          className="patient-encounters-refresh"
          disabled={
            refreshing
          }
          onClick={() =>
            void loadEncounters(
              true,
            )
          }
        >

          <RefreshCw
            size={14}
            className={
              refreshing
                ? 'encounter-spin'
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

        <div className="patient-encounters-error">

          {error}

        </div>

      )}


      {/* =================================================
          LIST
      ================================================= */}

      {encounters.length ===
      0 ? (

        <div className="patient-encounters-empty">

          <Stethoscope
            size={30}
          />

          <strong>
            No encounters found
          </strong>

          <span>
            Encounters created for this patient will appear here.
          </span>

        </div>

      ) : (

        <div className="patient-encounter-list">

          {encounters.map(
            (
              encounter,
              index,
            ) => (

              <EncounterCard
                key={
                  encounter.id ??
                  index
                }
                encounter={
                  encounter
                }
                onOpen={() =>
                  openEncounter(
                    encounter.id,
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
   ENCOUNTER CARD
========================================================= */

function EncounterCard({
  encounter,
  onOpen,
}: {
  encounter:
    PatientEncounter;

  onOpen:
    () => void;
}) {

  const finished =
    encounter.status ===
    'finished';


  return (

    <article className="patient-encounter-card">

      <div className="patient-encounter-main">

        <div
          className={
            finished
              ? 'patient-encounter-icon finished'
              : 'patient-encounter-icon active'
          }
        >

          {finished ? (

            <CheckCircle2
              size={20}
            />

          ) : (

            <Activity
              size={20}
            />

          )}

        </div>


        <div className="patient-encounter-content">

          <div className="patient-encounter-top">

            <div>

              <div className="patient-encounter-type-row">

                <h3>

                  {encounter
                    .encounterTypeDisplay ??
                    encounter
                      .classDisplay ??
                    encounter
                      .encounterType ??
                    'Clinical Encounter'}

                </h3>


                <span
                  className={
                    finished
                      ? 'patient-encounter-status finished'
                      : 'patient-encounter-status active'
                  }
                >

                  {finished
                    ? 'Finished'
                    : 'In Progress'}

                </span>

              </div>


              {encounter.department && (

                <span className="patient-encounter-department">

                  {
                    encounter.department
                  }

                </span>

              )}

            </div>

          </div>


          <div className="patient-encounter-details">

            <EncounterDetail
              icon={
                <Calendar
                  size={13}
                />
              }
              label="Started"
              value={
                formatDateTime(
                  encounter.startDateTime,
                )
              }
            />


            <EncounterDetail
              icon={
                <UserRound
                  size={13}
                />
              }
              label="Physician"
              value={
                encounter
                  .practitionerName ??
                'Not assigned'
              }
            />


            <EncounterDetail
              icon={
                <Stethoscope
                  size={13}
                />
              }
              label="Reason"
              value={
                encounter.reason ??
                'Not documented'
              }
            />

          </div>

        </div>

      </div>


      <div className="patient-encounter-actions">

        <button
          type="button"
          onClick={
            onOpen
          }
        >

          {finished
            ? 'View Chart'
            : 'Open Chart'}

          <ArrowRight
            size={13}
          />

        </button>

      </div>

    </article>

  );

}


/* =========================================================
   DETAIL
========================================================= */

function EncounterDetail({
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

    <div className="patient-encounter-detail">

      <div>
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
   DATE
========================================================= */

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
