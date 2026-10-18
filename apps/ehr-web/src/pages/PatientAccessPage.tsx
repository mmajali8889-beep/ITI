import {
  useEffect,
  useState,
} from 'react';

import {
  Activity,
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  FlaskConical,
  HeartPulse,
  Loader2,
  Pill,
  RefreshCw,
  Search,
  Stethoscope,
  UserRound,
  Users,
} from 'lucide-react';

import { api } from '../api/configureAxios';

import {
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';

import {
  useHospital,
} from '../context/HospitalContext';

import { getPatientEncounters } from '../api/encounterApi';

import './PatientAccessPage.css';

type ModuleKey =
  | 'registry'
  | 'clinical'
  | 'laboratory'
  | 'medications';

interface PatientRow {
  id: string;
  nameEn?: string;
  nameAr?: string;
  hospitalMrn?: string;
  enterpriseMrn?: string;
  nationalId?: string;
  passportNumber?: string;
  gender?: string;
  birthDate?: string;
  phone?: string;
  hospitalId?: string;
}

interface RawFhirIdentifier {
  system?: string;
  value?: string;
  assigner?: {
    reference?: string;
  };
  type?: {
    text?: string;
  };
}

interface RawFhirName {
  use?: string;
  text?: string;
  family?: string;
  given?: string[];
  extension?: Array<{
    url?: string;
    valueCode?: string;
  }>;
}

interface RawFhirPatient {
  resourceType?: string;
  id?: string;
  identifier?: RawFhirIdentifier[];
  name?: RawFhirName[];
  gender?: string;
  birthDate?: string;
  telecom?: Array<{
    system?: string;
    value?: string;
  }>;
  managingOrganization?: {
    reference?: string;
  };
  [key: string]: unknown;
}


const MODULE_INFO: Record<
  ModuleKey,
  {
    eyebrow: string;
    title: string;
    description: string;
    accent: string;
    icon: React.ReactNode;
  }
> = {
  registry: {
    eyebrow: 'Patient Registry',
    title: 'Find a patient record',
    description:
      'Search by name, MRN, national ID, passport or phone and open the longitudinal patient chart.',
    accent: 'blue',
    icon: <Users size={22} />,
  },
  clinical: {
    eyebrow: 'Clinical Workspace',
    title: 'Select a patient for clinical care',
    description:
      'Open the patient chart, review encounters and continue the clinical documentation workflow.',
    accent: 'teal',
    icon: <Stethoscope size={22} />,
  },
  laboratory: {
    eyebrow: 'Laboratory',
    title: 'Select a patient for laboratory processing',
    description:
      'Open the active visit for collection, barcode, receipt, acceptance, results and final reporting.',
    accent: 'violet',
    icon: <FlaskConical size={22} />,
  },
  medications: {
    eyebrow: 'Medication Management',
    title: 'Select a patient for medication review',
    description:
      'Review the patient medication history and open the full patient chart when needed.',
    accent: 'rose',
    icon: <Pill size={22} />,
  },
};

export default function PatientAccessPage() {
  const navigate = useNavigate();
  const { hospitalId } = useParams<{
    hospitalId: string;
  }>();
  const [searchParams, setSearchParams] =
    useSearchParams();
  const { hospital } = useHospital();

  const moduleParam =
    searchParams.get('module');

  const moduleKey: ModuleKey =
    moduleParam === 'clinical' ||
    moduleParam === 'laboratory' ||
    moduleParam === 'medications' ||
    moduleParam === 'registry'
      ? moduleParam
      : 'registry';

  const moduleInfo = MODULE_INFO[moduleKey];

  const [patients, setPatients] =
    useState<PatientRow[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] =
    useState(true);
  const [refreshing, setRefreshing] =
    useState(false);
  const [error, setError] = useState('');

  // The server searches (name, MRN, national ID, passport, phone) within the
  // hospital; a short pause while typing avoids a request per keystroke.
  useEffect(() => {
    const timer = window.setTimeout(() => void loadPatients(), query.trim() ? 350 : 0);
    return () => window.clearTimeout(timer);
  }, [hospitalId, query]);

  async function loadPatients(manual = false) {
    if (!hospitalId) {
      setError('Hospital ID is missing.');
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
        `/patients`,
        {
          params: {
            hospitalId,
            ...(query.trim() && { search: query.trim() }),
          },
        },
      );

      const normalized = normalizePatients(
        response.data,
        hospitalId,
      );

      setPatients(normalized);
    } catch (err) {
      console.error(
        'Unable to load patient registry:',
        err,
      );
      setError(
        'Unable to load the patient registry from the Hospital API.',
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  // Already searched and scoped by the server.
  const visiblePatients = patients;

  function selectModule(next: ModuleKey) {
    const params = new URLSearchParams(
      searchParams,
    );
    params.set('module', next);
    setSearchParams(params);
  }

  async function openPatient(patientId: string) {
    if (!hospitalId) {
      return;
    }

    if (moduleKey === 'laboratory') {
      try {
        setError('');
        const response = await getPatientEncounters(patientId, hospitalId);
        const activeEncounter = response.encounters.find((encounter) =>
          ['arrived', 'triaged', 'in-progress', 'onleave'].includes(encounter.status ?? ''),
        );
        if (activeEncounter?.id) {
          navigate(`/hospital/${hospitalId}/clinical/laboratory/patient/${patientId}/encounter/${activeEncounter.id}`);
        } else {
          navigate(`/hospital/${hospitalId}/clinical/laboratory/patient/${patientId}`);
        }
      } catch (cause) {
        console.error('Unable to resolve the active laboratory encounter:', cause);
        setError('Unable to open the laboratory workflow for this patient.');
      }
      return;
    }

    if (moduleKey === 'medications') {
      navigate(
        `/hospital/${hospitalId}/clinical/medications/patient/${patientId}`,
      );
      return;
    }

    navigate(
      `/hospital/${hospitalId}/patient/${patientId}`,
    );
  }

  function actionLabel() {
    switch (moduleKey) {
      case 'clinical':
        return 'Open Clinical Chart';
      case 'laboratory':
        return 'Open Laboratory';
      case 'medications':
        return 'Open Medications';
      default:
        return 'Open Patient Chart';
    }
  }

  return (
    <main className="patient-access-page">
      <header className="patient-access-topbar">
        <button
          type="button"
          className="patient-access-back"
          onClick={() =>
            navigate(
              `/hospital/${hospitalId}/dashboard`,
            )
          }
        >
          <ArrowLeft size={16} />
          Dashboard
        </button>

        <div className="patient-access-hospital">
          <HeartPulse size={16} />
          <span>
            {hospital?.name ?? 'Hospital'}
          </span>
          <small>STAGING</small>
        </div>
      </header>

      <section
        className={`patient-access-hero ${moduleInfo.accent}`}
      >
        <div className="patient-access-hero-icon">
          {moduleInfo.icon}
        </div>

        <div>
          <span>{moduleInfo.eyebrow}</span>
          <h1>{moduleInfo.title}</h1>
          <p>{moduleInfo.description}</p>
        </div>
      </section>

      <section className="patient-access-switcher">
        <ModuleButton
          active={moduleKey === 'registry'}
          label="Patient Registry"
          icon={<Users size={17} />}
          onClick={() =>
            selectModule('registry')
          }
        />

        <ModuleButton
          active={moduleKey === 'clinical'}
          label="Clinical Workspace"
          icon={<Stethoscope size={17} />}
          onClick={() =>
            selectModule('clinical')
          }
        />

        <ModuleButton
          active={moduleKey === 'laboratory'}
          label="Laboratory"
          icon={<FlaskConical size={17} />}
          onClick={() =>
            selectModule('laboratory')
          }
        />

        <ModuleButton
          active={moduleKey === 'medications'}
          label="Medications"
          icon={<Pill size={17} />}
          onClick={() =>
            selectModule('medications')
          }
        />
      </section>

      <section className="patient-access-panel">
        <div className="patient-access-toolbar">
          <label className="patient-access-search">
            <Search size={18} />
            <input
              value={query}
              onChange={(event) =>
                setQuery(event.target.value)
              }
              placeholder="Search by patient name, MRN, national ID, passport or phone..."
            />
          </label>

          <button
            type="button"
            className="patient-access-refresh"
            disabled={refreshing}
            onClick={() =>
              void loadPatients(true)
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

        <div className="patient-access-summary">
          <span>
            <Users size={15} />
            {visiblePatients.length} patient
            {visiblePatients.length === 1
              ? ''
              : 's'}
          </span>

          <span>
            <Activity size={15} />
            Clinical data from Hospital API
          </span>
        </div>

        {loading ? (
          <div className="patient-access-state">
            <Loader2
              size={24}
              className="spin"
            />
            <strong>
              Loading patient registry...
            </strong>
          </div>
        ) : error ? (
          <div className="patient-access-state error">
            <Activity size={24} />
            <strong>{error}</strong>
            <button
              type="button"
              onClick={() =>
                void loadPatients()
              }
            >
              Try Again
            </button>
          </div>
        ) : visiblePatients.length === 0 ? (
          <div className="patient-access-state">
            <Search size={25} />
            <strong>No patients found</strong>
            <span>
              Change the search text or refresh the registry.
            </span>
          </div>
        ) : (
          <div className="patient-access-list">
            {visiblePatients.map(
              (patient) => (
                <article
                  key={patient.id}
                  className="patient-access-card"
                >
                  <div className="patient-access-avatar">
                    {patientInitial(patient)}
                  </div>

                  <div className="patient-access-main">
                    <div className="patient-access-name-row">
                      <div>
                        <h2>
                          {patient.nameEn ||
                            patient.nameAr ||
                            'Unnamed Patient'}
                        </h2>

                        {patient.nameAr &&
                          patient.nameAr !==
                            patient.nameEn && (
                            <span
                              dir="rtl"
                              className="patient-access-arabic-name"
                            >
                              {patient.nameAr}
                            </span>
                          )}
                      </div>

                      <span className="patient-access-mrn">
                        {patient.hospitalMrn ||
                          patient.enterpriseMrn ||
                          'No MRN'}
                      </span>
                    </div>

                    <div className="patient-access-demographics">
                      <span>
                        <UserRound size={14} />
                        {formatGender(
                          patient.gender,
                        )}
                      </span>

                      <span>
                        <CalendarDays size={14} />
                        {patient.birthDate ||
                          'DOB not recorded'}
                      </span>

                      {patient.nationalId && (
                        <span>
                          National ID:{' '}
                          {patient.nationalId}
                        </span>
                      )}

                      {patient.phone && (
                        <span>
                          {patient.phone}
                        </span>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    className="patient-access-open"
                    onClick={() =>
                      openPatient(patient.id)
                    }
                  >
                    {actionLabel()}
                    <ArrowRight size={16} />
                  </button>
                </article>
              ),
            )}
          </div>
        )}
      </section>
    </main>
  );
}

function ModuleButton({
  active,
  label,
  icon,
  onClick,
}: {
  active: boolean;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={
        active
          ? 'patient-module-button active'
          : 'patient-module-button'
      }
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );
}

function normalizePatients(
  payload: unknown,
  hospitalId: string,
): PatientRow[] {
  const candidates = extractCandidates(payload);

  return candidates
    .map(normalizePatient)
    .filter(
      (patient): patient is PatientRow =>
        Boolean(patient?.id),
    )
    .filter(
      (patient) =>
        !patient.hospitalId ||
        patient.hospitalId === hospitalId,
    )
    .sort((a, b) =>
      String(
        a.nameEn || a.nameAr || '',
      ).localeCompare(
        String(
          b.nameEn || b.nameAr || '',
        ),
      ),
    );
}

function extractCandidates(
  payload: unknown,
): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (!payload || typeof payload !== 'object') {
    return [];
  }

  const value = payload as Record<
    string,
    unknown
  >;

  for (const key of [
    'patients',
    'items',
    'results',
    'data',
  ]) {
    const list = value[key];
    if (Array.isArray(list)) {
      return list;
    }
  }

  const entries = value.entry;
  if (Array.isArray(entries)) {
    return entries
      .map((entry) => {
        if (
          entry &&
          typeof entry === 'object' &&
          'resource' in entry
        ) {
          return (
            entry as {
              resource?: unknown;
            }
          ).resource;
        }
        return entry;
      })
      .filter(Boolean);
  }

  return [];
}

function normalizePatient(
  value: unknown,
): PatientRow | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const patient = value as
    | RawFhirPatient
    | Record<string, unknown>;

  const id = text(patient.id);
  if (!id) {
    return undefined;
  }

  const raw = patient as RawFhirPatient;

  const isRawFhirPatient =
    raw.resourceType === 'Patient' &&
    (Array.isArray(raw.name) ||
      Array.isArray(raw.identifier));

  if (isRawFhirPatient) {
    const identifiers =
      raw.identifier ?? [];
    const names = raw.name ?? [];

    const arabicName = names.find(
      (name) =>
        name.extension?.some(
          (extension) =>
            extension.valueCode === 'ar',
        ),
    );

    const englishName = names.find(
      (name) =>
        name.extension?.some(
          (extension) =>
            extension.valueCode === 'en',
        ),
    );

    return {
      id,
      nameAr:
        displayName(arabicName) ||
        undefined,
      nameEn:
        displayName(englishName) ||
        displayName(
          names.find(
            (name) =>
              name.use === 'usual',
          ),
        ) ||
        displayName(names[0]) ||
        undefined,
      enterpriseMrn:
        identifierValue(
          identifiers,
          (identifier) =>
            identifier.system?.includes(
              '/mrn/enterprise',
            ) ?? false,
        ),
      hospitalMrn:
        identifierValue(
          identifiers,
          (identifier) =>
            (identifier.type?.text
              ?.toLowerCase()
              .includes('hospital mrn') ??
              false) ||
            (identifier.system?.includes(
              '/mrn/',
            ) ??
              false) &&
              !identifier.system?.includes(
                '/mrn/enterprise',
              ),
        ),
      nationalId:
        identifierValue(
          identifiers,
          (identifier) =>
            identifier.system?.includes(
              'national-id',
            ) ?? false,
        ),
      passportNumber:
        identifierValue(
          identifiers,
          (identifier) =>
            identifier.system?.includes(
              'passport',
            ) ?? false,
        ),
      gender: raw.gender,
      birthDate: raw.birthDate,
      phone:
        raw.telecom?.find(
          (item) =>
            item.system === 'phone',
        )?.value,
      hospitalId:
        raw.managingOrganization?.reference?.replace(
          'Organization/',
          '',
        ),
    };
  }

  const mapped = patient as Record<
    string,
    unknown
  >;

  return {
    id,
    nameEn:
      text(mapped.nameEn) ||
      text(mapped.displayName) ||
      text(mapped.name),
    nameAr: text(mapped.nameAr),
    hospitalMrn:
      text(mapped.hospitalMrn) ||
      text(mapped.mrn),
    enterpriseMrn: text(
      mapped.enterpriseMrn,
    ),
    nationalId: text(mapped.nationalId),
    passportNumber: text(
      mapped.passportNumber,
    ),
    gender: text(mapped.gender),
    birthDate: text(mapped.birthDate),
    phone:
      text(mapped.phone) ||
      text(mapped.mobile),
    hospitalId:
      text(mapped.hospitalId) ||
      text(mapped.organizationId),
  };
}

function identifierValue(
  identifiers: RawFhirIdentifier[],
  predicate: (
    identifier: RawFhirIdentifier,
  ) => boolean,
) {
  return identifiers.find(predicate)?.value;
}

function displayName(
  name?: RawFhirName,
) {
  if (!name) {
    return '';
  }

  if (name.text?.trim()) {
    return name.text.trim();
  }

  return [
    ...(name.given ?? []),
    name.family,
  ]
    .filter(Boolean)
    .join(' ')
    .trim();
}

function text(value: unknown) {
  return typeof value === 'string'
    ? value.trim()
    : '';
}

function patientInitial(patient: PatientRow) {
  const value =
    patient.nameEn ||
    patient.nameAr ||
    'P';

  return value.charAt(0).toUpperCase();
}

function formatGender(gender?: string) {
  if (!gender) {
    return 'Gender not recorded';
  }

  return (
    gender.charAt(0).toUpperCase() +
    gender.slice(1)
  );
}
