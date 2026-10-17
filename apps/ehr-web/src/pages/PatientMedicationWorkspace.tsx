import {
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  ArrowLeft,
  ExternalLink,
  Loader2,
  Pill,
  RefreshCw,
  Search,
} from 'lucide-react';

import { api } from '../api/configureAxios';

import {
  useNavigate,
  useParams,
} from 'react-router-dom';

import './PatientModuleWorkspace.css';

interface MedicationRow {
  id?: string;
  medicationName?: string;
  medicationCode?: string;
  status?: string;
  intent?: string;
  priority?: string;
  authoredOn?: string;
  dosageText?: string;
  dose?: number | string;
  doseUnit?: string;
  route?: string;
  frequency?: string;
  duration?: number | string;
  durationUnit?: string;
  requesterName?: string;
  [key: string]: unknown;
}


export default function PatientMedicationWorkspace() {
  const navigate = useNavigate();
  const { hospitalId, patientId } =
    useParams<{
      hospitalId: string;
      patientId: string;
    }>();

  const [medications, setMedications] =
    useState<MedicationRow[]>([]);
  const [loading, setLoading] =
    useState(true);
  const [refreshing, setRefreshing] =
    useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    void loadMedications();
  }, [patientId]);

  async function loadMedications(
    manual = false,
  ) {
    if (!patientId) {
      setError('Patient ID is missing.');
      setLoading(false);
      return;
    }

    try {
      if (manual) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError('');

      const response = await api.get(
        `/medications/patient/${patientId}`,
      );

      const data = response.data as
        | {
            medications?: MedicationRow[];
          }
        | MedicationRow[];

      setMedications(
        Array.isArray(data)
          ? data
          : data.medications ?? [],
      );
    } catch (err) {
      console.error(
        'Unable to load medications:',
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

  const visible = useMemo(() => {
    const needle = query
      .trim()
      .toLowerCase();

    if (!needle) {
      return medications;
    }

    return medications.filter(
      (medication) =>
        [
          medication.medicationName,
          medication.medicationCode,
          medication.status,
          medication.route,
          medication.frequency,
          medication.requesterName,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(needle),
    );
  }, [medications, query]);

  if (!hospitalId || !patientId) {
    return (
      <div className="patient-module-state">
        Missing hospital or patient ID.
      </div>
    );
  }

  return (
    <main className="patient-module-workspace">
      <header className="patient-module-header">
        <div>
          <button
            type="button"
            className="patient-module-back"
            onClick={() =>
              navigate(
                `/hospital/${hospitalId}/patients?module=medications`,
              )
            }
          >
            <ArrowLeft size={16} />
            Patient Selection
          </button>

          <div className="patient-module-title">
            <span className="patient-module-icon rose">
              <Pill size={20} />
            </span>
            <div>
              <span>Clinical Medication Record</span>
              <h1>Medication Management</h1>
            </div>
          </div>
        </div>

        <button
          type="button"
          className="patient-module-chart"
          onClick={() =>
            navigate(
              `/hospital/${hospitalId}/patient/${patientId}`,
            )
          }
        >
          Open Full Patient Chart
          <ExternalLink size={15} />
        </button>
      </header>

      <section className="patient-module-body">
        <div className="medication-workspace-tools">
          <label>
            <Search size={17} />
            <input
              value={query}
              onChange={(event) =>
                setQuery(event.target.value)
              }
              placeholder="Search medications, route or status..."
            />
          </label>

          <button
            type="button"
            disabled={refreshing}
            onClick={() =>
              void loadMedications(true)
            }
          >
            <RefreshCw
              size={16}
              className={
                refreshing ? 'spin' : ''
              }
            />
            Refresh
          </button>
        </div>

        {loading ? (
          <div className="patient-module-state">
            <Loader2
              size={24}
              className="spin"
            />
            Loading medications...
          </div>
        ) : error ? (
          <div className="patient-module-state error">
            {error}
          </div>
        ) : visible.length === 0 ? (
          <div className="patient-module-state">
            <Pill size={25} />
            <strong>
              No medication records found
            </strong>
          </div>
        ) : (
          <div className="medication-workspace-list">
            {visible.map((medication, index) => (
              <article
                className="medication-workspace-card"
                key={
                  medication.id ||
                  `${medication.medicationName}-${index}`
                }
              >
                <div className="medication-pill-icon">
                  <Pill size={18} />
                </div>

                <div className="medication-card-copy">
                  <div className="medication-card-title">
                    <h2>
                      {medication.medicationName ||
                        'Medication'}
                    </h2>

                    <span>
                      {medication.status ||
                        'unknown'}
                    </span>
                  </div>

                  <p>
                    {medication.dosageText ||
                      medicationSummary(
                        medication,
                      )}
                  </p>

                  <div className="medication-card-meta">
                    {medication.medicationCode && (
                      <span>
                        Code:{' '}
                        {medication.medicationCode}
                      </span>
                    )}
                    {medication.route && (
                      <span>
                        Route: {medication.route}
                      </span>
                    )}
                    {medication.frequency && (
                      <span>
                        {medication.frequency}
                      </span>
                    )}
                    {medication.authoredOn && (
                      <span>
                        {new Date(
                          medication.authoredOn,
                        ).toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function medicationSummary(
  medication: MedicationRow,
) {
  const dose = [
    medication.dose,
    medication.doseUnit,
  ]
    .filter(Boolean)
    .join(' ');

  const duration = [
    medication.duration,
    medication.durationUnit,
  ]
    .filter(Boolean)
    .join(' ');

  return [
    dose,
    medication.frequency,
    duration
      ? `for ${duration}`
      : undefined,
  ]
    .filter(Boolean)
    .join(' · ') ||
    'No dosage details documented.';
}
