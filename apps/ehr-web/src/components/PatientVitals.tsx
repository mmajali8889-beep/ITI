import {
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  Gauge,
  HeartPulse,
  RefreshCw,
  Ruler,
  Scale,
  Stethoscope,
  Thermometer,
  Wind,
} from 'lucide-react';

import {
  useNavigate,
} from 'react-router-dom';

import {
  getPatientVitals,
} from '../api/vitalsApi';

import type {
  VitalResult,
} from '../types/vitals';

import './PatientVitals.css';


interface PatientVitalsProps {
  patientId: string;
  hospitalId: string;
}


interface VitalDefinition {
  type: string;
  label: string;
  shortLabel: string;
  icon: React.ReactNode;
}


const VITAL_DEFINITIONS: VitalDefinition[] = [
  {
    type: 'blood-pressure',
    label: 'Blood Pressure',
    shortLabel: 'BP',
    icon: <Gauge size={19} />,
  },
  {
    type: 'pulse',
    label: 'Pulse',
    shortLabel: 'HR',
    icon: <HeartPulse size={19} />,
  },
  {
    type: 'temperature',
    label: 'Temperature',
    shortLabel: 'Temp',
    icon: <Thermometer size={19} />,
  },
  {
    type: 'respiratory-rate',
    label: 'Respiratory Rate',
    shortLabel: 'RR',
    icon: <Wind size={19} />,
  },
  {
    type: 'spo2',
    label: 'Oxygen Saturation',
    shortLabel: 'SpO₂',
    icon: <Activity size={19} />,
  },
  {
    type: 'weight',
    label: 'Weight',
    shortLabel: 'Weight',
    icon: <Scale size={19} />,
  },
  {
    type: 'height',
    label: 'Height',
    shortLabel: 'Height',
    icon: <Ruler size={19} />,
  },
  {
    type: 'bmi',
    label: 'Body Mass Index',
    shortLabel: 'BMI',
    icon: <Scale size={19} />,
  },
  {
    type: 'pain-score',
    label: 'Pain Score',
    shortLabel: 'Pain',
    icon: <Stethoscope size={19} />,
  },
];


export default function PatientVitals({
  patientId,
  hospitalId,
}: PatientVitalsProps) {

  const navigate =
    useNavigate();


  const [
    vitals,
    setVitals,
  ] =
    useState<VitalResult[]>([]);


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

    void loadVitals();

  }, [patientId]);


  async function loadVitals(
    manual = false,
  ) {

    try {

      if (manual) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }


      setError('');


      const result =
        await getPatientVitals(
          patientId,
        );


      setVitals(
        result.vitals ?? [],
      );


    } catch (err) {

      console.error(
        'Unable to load patient vitals:',
        err,
      );


      setError(
        'Unable to load patient vital signs.',
      );


    } finally {

      setLoading(false);
      setRefreshing(false);

    }

  }


  /* =====================================================
     LATEST
  ===================================================== */

  const latestVitals =
    useMemo(
      () =>
        getLatestVitals(
          vitals,
        ),
      [vitals],
    );


  const abnormalCount =
    useMemo(
      () =>
        Object.values(
          latestVitals,
        ).filter(
          (
            vital,
          ) =>
            getVitalStatus(
              vital,
            ).abnormal,
        ).length,
      [latestVitals],
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
     LOADING
  ===================================================== */

  if (loading) {

    return (

      <section className="patient-vitals-state">

        <div className="patient-vitals-spinner" />

        <strong>
          Loading vital signs
        </strong>

        <span>
          Retrieving the patient's clinical measurements...
        </span>

      </section>

    );

  }


  /* =====================================================
     ERROR
  ===================================================== */

  if (error) {

    return (

      <section className="patient-vitals-state error">

        <AlertTriangle size={25} />

        <strong>
          Unable to load vital signs
        </strong>

        <span>
          {error}
        </span>

        <button
          type="button"
          onClick={() =>
            void loadVitals()
          }
        >
          Try Again
        </button>

      </section>

    );

  }


  return (

    <div className="patient-vitals">

      {/* =================================================
          HEADER
      ================================================= */}

      <header className="patient-vitals-header">

        <div>

          <div className="patient-vitals-title-row">

            <div className="patient-vitals-title-icon">

              <Activity size={20} />

            </div>

            <div>

              <h2>
                Vital Signs
              </h2>

              <p>
                Longitudinal vital-sign history across all patient encounters
              </p>

            </div>

          </div>

        </div>


        <button
          type="button"
          className="patient-vitals-refresh"
          disabled={refreshing}
          onClick={() =>
            void loadVitals(true)
          }
        >

          <RefreshCw
            size={14}
            className={
              refreshing
                ? 'spin'
                : undefined
            }
          />

          {refreshing
            ? 'Refreshing...'
            : 'Refresh'}

        </button>

      </header>


      {/* =================================================
          CLINICAL ALERT
      ================================================= */}

      {abnormalCount > 0 && (

        <div className="patient-vitals-alert">

          <div className="patient-vitals-alert-icon">

            <AlertTriangle size={18} />

          </div>

          <div>

            <strong>
              Abnormal Vital Signs Detected
            </strong>

            <span>
              {abnormalCount}{' '}
              latest measurement
              {abnormalCount > 1
                ? 's are'
                : ' is'}{' '}
              outside the configured adult reference range.
            </span>

          </div>

        </div>

      )}


      {/* =================================================
          LATEST CARDS
      ================================================= */}

      <section className="patient-vitals-section">

        <div className="patient-vitals-section-heading">

          <div>

            <h3>
              Latest Measurements
            </h3>

            <p>
              Most recent value recorded for each vital sign
            </p>

          </div>

          <span className="patient-vitals-total">

            {vitals.length}
            {' '}
            measurements

          </span>

        </div>


        <div className="patient-vital-cards">

          {VITAL_DEFINITIONS.map(
            (
              definition,
            ) => {

              const vital =
                latestVitals[
                  definition.type
                ];


              return (

                <VitalCard
                  key={
                    definition.type
                  }
                  definition={
                    definition
                  }
                  vital={
                    vital
                  }
                  onOpenEncounter={
                    openEncounter
                  }
                />

              );

            },
          )}

        </div>

      </section>


      {/* =================================================
          HISTORY
      ================================================= */}

      <section className="patient-vitals-history">

        <div className="patient-vitals-section-heading">

          <div>

            <h3>
              Vital Signs History
            </h3>

            <p>
              Complete chronological measurement history
            </p>

          </div>

        </div>


        {vitals.length === 0 ? (

          <div className="patient-vitals-empty">

            <Activity size={30} />

            <strong>
              No vital signs recorded
            </strong>

            <span>
              Vital signs recorded during encounters will appear here.
            </span>

          </div>

        ) : (

          <div className="patient-vitals-table-wrapper">

            <table className="patient-vitals-table">

              <thead>

                <tr>

                  <th>
                    Date / Time
                  </th>

                  <th>
                    Measurement
                  </th>

                  <th>
                    Value
                  </th>

                  <th>
                    Status
                  </th>

                  <th>
                    Encounter
                  </th>

                </tr>

              </thead>


              <tbody>

                {vitals.map(
                  (
                    vital,
                    index,
                  ) => {

                    const status =
                      getVitalStatus(
                        vital,
                      );


                    return (

                      <tr
                        key={
                          vital.id ??
                          `${vital.type}-${index}`
                        }
                        className={
                          status.abnormal
                            ? 'abnormal-row'
                            : undefined
                        }
                      >

                        <td>

                          <div className="vital-history-date">

                            <CalendarClock
                              size={14}
                            />

                            <span>

                              {formatDateTime(
                                getVitalDate(
                                  vital,
                                ),
                              )}

                            </span>

                          </div>

                        </td>


                        <td>

                          <div className="vital-history-name">

                            <strong>
                              {getVitalLabel(
                                vital.type,
                              )}
                            </strong>

                            <span>
                              {getVitalShortLabel(
                                vital.type,
                              )}
                            </span>

                          </div>

                        </td>


                        <td>

                          <strong
                            className={
                              status.abnormal
                                ? 'vital-history-value abnormal'
                                : 'vital-history-value'
                            }
                          >

                            {formatVitalValue(
                              vital,
                            )}

                          </strong>

                        </td>


                        <td>

                          <span
                            className={
                              status.abnormal
                                ? 'vital-status abnormal'
                                : 'vital-status normal'
                            }
                          >

                            {status.abnormal && (
                              <AlertTriangle
                                size={11}
                              />
                            )}


                            {status.label}

                          </span>

                        </td>


                        <td>

                          {vital.encounterId ? (

                            <button
                              type="button"
                              className="open-vital-encounter"
                              onClick={() =>
                                openEncounter(
                                  vital.encounterId,
                                )
                              }
                            >

                              Open Encounter

                              <ArrowRight
                                size={12}
                              />

                            </button>

                          ) : (

                            <span className="no-encounter">
                              —
                            </span>

                          )}

                        </td>

                      </tr>

                    );

                  },
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
  definition,
  vital,
  onOpenEncounter,
}: {
  definition: VitalDefinition;

  vital?: VitalResult;

  onOpenEncounter:
    (encounterId?: string) => void;
}) {

  const status =
    vital
      ? getVitalStatus(
          vital,
        )
      : {
          abnormal: false,
          label: 'No Data',
        };


  return (

    <article
      className={
        vital &&
        status.abnormal
          ? 'patient-vital-card abnormal'
          : 'patient-vital-card'
      }
    >

      <div className="patient-vital-card-top">

        <div className="patient-vital-icon">

          {definition.icon}

        </div>


        <span
          className={
            vital
              ? status.abnormal
                ? 'patient-vital-state abnormal'
                : 'patient-vital-state normal'
              : 'patient-vital-state empty'
          }
        >

          {vital &&
            status.abnormal && (

              <AlertTriangle
                size={10}
              />

            )}


          {status.label}

        </span>

      </div>


      <div className="patient-vital-label">

        <span>
          {definition.shortLabel}
        </span>

        <strong>
          {definition.label}
        </strong>

      </div>


      <div
        className={
          vital &&
          status.abnormal
            ? 'patient-vital-value abnormal'
            : 'patient-vital-value'
        }
      >

        {vital
          ? formatVitalValue(
              vital,
            )
          : '—'}

      </div>


      <div className="patient-vital-footer">

        <span>

          {vital
            ? formatDateTime(
                getVitalDate(
                  vital,
                ),
              )
            : 'No measurement recorded'}

        </span>


        {vital?.encounterId && (

          <button
            type="button"
            onClick={() =>
              onOpenEncounter(
                vital.encounterId,
              )
            }
          >

            View

            <ArrowRight
              size={11}
            />

          </button>

        )}

      </div>

    </article>

  );

}


/* =========================================================
   LATEST VALUES
========================================================= */

function getLatestVitals(
  vitals: VitalResult[],
) {

  const latest:
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
      !latest[vital.type]
    ) {

      latest[vital.type] =
        vital;

    }

  }


  return latest;

}


/* =========================================================
   STATUS
========================================================= */

function getVitalStatus(
  vital: VitalResult,
): {
  abnormal: boolean;
  label: string;
} {

  switch (vital.type) {

    /* BLOOD PRESSURE */

    case 'blood-pressure': {

      const bp =
        getBloodPressure(
          vital,
        );


      if (!bp) {

        return {
          abnormal: false,
          label: 'Unknown',
        };

      }


      const abnormal =
        bp.systolic < 90 ||
        bp.systolic >= 140 ||
        bp.diastolic < 60 ||
        bp.diastolic >= 90;


      return {
        abnormal,
        label:
          abnormal
            ? 'Abnormal'
            : 'Normal',
      };

    }


    /* PULSE */

    case 'pulse': {

      const value =
        toNumber(
          vital.value,
        );


      if (
        value === undefined
      ) {

        return unknownStatus();

      }


      const abnormal =
        value < 60 ||
        value > 100;


      return statusResult(
        abnormal,
      );

    }


    /* TEMPERATURE */

    case 'temperature': {

      const value =
        toNumber(
          vital.value,
        );


      if (
        value === undefined
      ) {

        return unknownStatus();

      }


      const abnormal =
        value < 35 ||
        value >= 38;


      return statusResult(
        abnormal,
      );

    }


    /* RESPIRATORY RATE */

    case 'respiratory-rate': {

      const value =
        toNumber(
          vital.value,
        );


      if (
        value === undefined
      ) {

        return unknownStatus();

      }


      const abnormal =
        value < 12 ||
        value > 20;


      return statusResult(
        abnormal,
      );

    }


    /* SPO2 */

    case 'spo2': {

      const value =
        toNumber(
          vital.value,
        );


      if (
        value === undefined
      ) {

        return unknownStatus();

      }


      return statusResult(
        value < 95,
      );

    }


    /* BMI */

    case 'bmi': {

      const value =
        toNumber(
          vital.value,
        );


      if (
        value === undefined
      ) {

        return unknownStatus();

      }


      return statusResult(
        value < 18.5 ||
        value >= 25,
      );

    }


    /* PAIN */

    case 'pain-score': {

      const value =
        toNumber(
          vital.value,
        );


      if (
        value === undefined
      ) {

        return unknownStatus();

      }


      return statusResult(
        value >= 7,
      );

    }


    /*
     * Height and weight are not marked
     * abnormal without clinical context.
     */

    default:

      return {
        abnormal: false,
        label: 'Recorded',
      };

  }

}


function statusResult(
  abnormal: boolean,
) {

  return {
    abnormal,
    label:
      abnormal
        ? 'Abnormal'
        : 'Normal',
  };

}


function unknownStatus() {

  return {
    abnormal: false,
    label: 'Unknown',
  };

}


/* =========================================================
   BLOOD PRESSURE
========================================================= */

function getBloodPressure(
  vital: VitalResult,
) {

  if (
    vital.systolic !== undefined &&
    vital.diastolic !== undefined
  ) {

    return {
      systolic:
        vital.systolic,

      diastolic:
        vital.diastolic,
    };

  }


  if (
    typeof vital.value ===
    'string'
  ) {

    const match =
      vital.value.match(
        /(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/,
      );


    if (!match) {
      return undefined;
    }


    return {
      systolic:
        Number(match[1]),

      diastolic:
        Number(match[2]),
    };

  }


  return undefined;

}


/* =========================================================
   FORMAT VALUE
========================================================= */

function formatVitalValue(
  vital: VitalResult,
) {

  if (
    vital.type ===
    'blood-pressure'
  ) {

    const bp =
      getBloodPressure(
        vital,
      );


    if (bp) {

      return `${bp.systolic}/${bp.diastolic} mmHg`;

    }

  }


  if (
    vital.value === undefined ||
    vital.value === null ||
    vital.value === ''
  ) {

    return '—';

  }


  const unit =
    normalizeUnit(
      vital.type,
      vital.unit,
    );


  return unit
    ? `${vital.value} ${unit}`
    : `${vital.value}`;

}


/* =========================================================
   UNIT
========================================================= */

function normalizeUnit(
  type?: string,
  unit?: string,
) {

  if (unit) {

    switch (unit) {

      case 'Cel':
        return '°C';

      case 'kg/m2':
        return 'kg/m²';

      default:
        return unit;

    }

  }


  switch (type) {

    case 'pulse':
      return 'bpm';

    case 'temperature':
      return '°C';

    case 'respiratory-rate':
      return '/min';

    case 'spo2':
      return '%';

    case 'weight':
      return 'kg';

    case 'height':
      return 'cm';

    case 'bmi':
      return 'kg/m²';

    case 'pain-score':
      return '/10';

    default:
      return '';

  }

}


/* =========================================================
   LABELS
========================================================= */

function getVitalLabel(
  type?: string,
) {

  return (
    VITAL_DEFINITIONS.find(
      (
        item,
      ) =>
        item.type === type,
    )?.label ??
    type ?? 'Vital sign'
  );

}


function getVitalShortLabel(
  type?: string,
) {

  return (
    VITAL_DEFINITIONS.find(
      (
        item,
      ) =>
        item.type === type,
    )?.shortLabel ??
    type ?? '—'
  );

}


/* =========================================================
   DATE
========================================================= */

function getVitalDate(
  vital: VitalResult,
) {

  return (
    vital.effectiveDateTime ??
    vital.issued
  );

}


function formatDateTime(
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


  return date.toLocaleString();

}


/* =========================================================
   NUMBER
========================================================= */

function toNumber(
  value?: number | string,
) {

  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {

    return undefined;

  }


  const number =
    Number(value);


  return Number.isNaN(number)
    ? undefined
    : number;

}
