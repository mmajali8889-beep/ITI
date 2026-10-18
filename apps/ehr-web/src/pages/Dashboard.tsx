import { HOSPITAL_CURRENCY } from '../utils/currency';
import type {
  ReactNode,
} from 'react';
import { useEffect, useState } from 'react';

import {
  Activity,
  ArrowRight,
  BedDouble,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Database,
  FileText,
  FlaskConical,
  HeartPulse,
  Microscope,
  Pill,
  Radio,
  Search,
  Settings2,
  ShieldCheck,
  Stethoscope,
  UserPlus,
  Users,
  PackageSearch,
  WalletCards,
  ClipboardCheck,
  UserCog,
  Scissors,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react';

import {
  useNavigate,
} from 'react-router-dom';

import {
  useHospital,
} from '../context/HospitalContext';

import './Dashboard.css';
import { getOperationsDashboard, type OperationsDashboard } from '../api/dashboardApi';
import { useAuth } from '../context/useAuth';
import { canAccess } from '../auth/permissions';
import hospitalSlide from '../assets/unitech-dashboard-hospital.png';
import digitalHealthcareSlide from '../assets/unitech-dashboard-digital-healthcare.png';
import patientCareSlide from '../assets/unitech-dashboard-patient-care.png';
import surgerySlide from '../assets/unitech-dashboard-surgery.png';

const HERO_SLIDES = [
  { title: 'Connected hospital operations', image: hospitalSlide },
  { title: 'Digital clinical intelligence', image: digitalHealthcareSlide },
  { title: 'Compassionate nursing care', image: patientCareSlide },
  { title: 'Advanced surgical services', image: surgerySlide },
] as const;

type ModuleTone =
  | 'blue'
  | 'teal'
  | 'violet'
  | 'amber'
  | 'rose'
  | 'slate';

type ModuleState =
  | 'live'
  | 'integrated'
  | 'patient-chart'
  | 'coming-soon';

interface ModuleDefinition {
  title: string;
  description: string;
  detail: string;
  icon: ReactNode;
  tone: ModuleTone;
  state: ModuleState;
  path?: string;
}

const LIVE_MODULES: ModuleDefinition[] = [
  {
    title: 'Patient Registry',
    description: 'Search, registration and longitudinal patient chart',
    detail: 'MRN · demographics · encounters · clinical history',
    icon: <Users size={21} />,
    tone: 'blue',
    state: 'live',
    path: 'patients?module=registry',
  },
  {
    title: 'Clinical Workspace',
    description: 'Encounter-centered physician and nursing documentation',
    detail: 'Vitals · diagnosis · allergies · notes · medications',
    icon: <Stethoscope size={21} />,
    tone: 'teal',
    state: 'integrated',
    path: 'patients?module=clinical',
  },
  {
    title: 'Laboratory',
    description: 'Clinical laboratory workflow inside the patient chart',
    detail: 'Orders · specimens · results · final reports',
    icon: <FlaskConical size={21} />,
    tone: 'violet',
    state: 'patient-chart',
    path: 'patients?module=laboratory',
  },
  {
    title: 'Radiology & PACS',
    description: 'Central RIS worklist with imaging and reporting',
    detail: 'RIS · MWL · PACS · OHIF · diagnostic reports',
    icon: <Microscope size={21} />,
    tone: 'blue',
    state: 'live',
    path: 'radiology',
  },
  {
    title: 'Modality Stations',
    description: 'Imaging modality configuration and Orthanc integration',
    detail: 'AE Title · DICOM echo · MWL · Orthanc sync',
    icon: <Radio size={21} />,
    tone: 'amber',
    state: 'live',
    path: 'radiology/stations',
  },
  {
    title: 'Medication Management',
    description: 'Medication requests and clinical medication history',
    detail: 'Orders · dosage · route · allergy-aware workflow',
    icon: <Pill size={21} />,
    tone: 'rose',
    state: 'patient-chart',
    path: 'patients?module=medications',
  },
  {
    title: 'Inpatient & ADT',
    description: 'Admissions, transfers, discharge and visual bed management',
    detail: 'ADT · wards · green/available · red/occupied',
    icon: <BedDouble size={21} />,
    tone: 'teal',
    state: 'live',
    path: 'inpatient',
  },
  {
    title: 'Appointments',
    description: 'Clinic scheduling, conflict prevention and patient arrival',
    detail: 'Booking · daily schedule · check-in · cancellation',
    icon: <CalendarDays size={21} />,
    tone: 'blue',
    state: 'live',
    path: 'appointments',
  },
  {
    title: 'Emergency Department',
    description: 'Arrival, triage, clinical care and disposition tracking',
    detail: 'Registration · acuity · physician · disposition',
    icon: <Activity size={21} />,
    tone: 'rose',
    state: 'live',
    path: 'emergency',
  },
  {
    title: 'Pharmacy Operations',
    description: 'Prescription dispensing and batch-level medication inventory',
    detail: 'Queue · formulary · FEFO stock · returns',
    icon: <Pill size={21} />,
    tone: 'violet',
    state: 'live',
    path: 'pharmacy',
  },
  { title: 'Nursing & Ward', description: 'Patient worklist, care plans and overdue tasks', detail: 'Assessments · MAR · observations · care plans', icon: <ClipboardCheck size={21}/>, tone: 'teal', state: 'live', path: 'nursing' },
  { title: 'Physician Rounds', description: 'Unified inpatient rounding and progress notes', detail: 'Timeline · results · medication · new orders', icon: <Stethoscope size={21}/>, tone: 'blue', state: 'live', path: 'rounds' },
  { title: 'Surgery & OR', description: 'Complete perioperative theatre workflow', detail: 'Scheduling · checklist · anesthesia · PACU', icon: <Scissors size={21}/>, tone: 'rose', state: 'live', path: 'surgery' },
  { title: 'Intensive Care', description: 'High-acuity monitoring and ICU daily plans', detail: 'Vitals · ventilator · infusions · ABG', icon: <HeartPulse size={21}/>, tone: 'rose', state: 'live', path: 'icu' },
  { title: 'Bed Management', description: 'Hospital-wide visual capacity and movement board', detail: 'Available · occupied · cleaning · isolation', icon: <BedDouble size={21}/>, tone: 'teal', state: 'live', path: 'bed-management' },
  { title: 'Discharge', description: 'Clearance-driven discharge and summaries', detail: 'Reconciliation · summary · follow-up · bed release', icon: <CheckCircle2 size={21}/>, tone: 'amber', state: 'live', path: 'discharge' },
  { title: 'Billing & Claims', description: 'Patient accounts, invoices and payer claims', detail: 'Charges · receipts · claims · reconciliation', icon: <WalletCards size={21}/>, tone: 'blue', state: 'live', path: 'billing' },
  { title: 'Medical Records / HIM', description: 'Deficiency review, signature, lock and archive', detail: 'Review · attest · lock · retention · audit', icon: <FileText size={21}/>, tone: 'violet', state: 'live', path: 'medical-records' },
  { title: 'Inventory & Supply', description: 'Procurement and lot-level hospital stock', detail: 'PR · PO · receipt · transfer · FEFO · wastage', icon: <PackageSearch size={21}/>, tone: 'amber', state: 'live', path: 'inventory' },
  { title: 'Administration', description: 'RBAC-governed hospital configuration', detail: 'Users · roles · catalogs · audit logs', icon: <UserCog size={21}/>, tone: 'slate', state: 'live', path: 'administration' },
];

const UPCOMING_MODULES: ModuleDefinition[] = [
];

export default function Dashboard() {
  const navigate = useNavigate();
  const { hospital } = useHospital();
  const { session } = useAuth();
  const visibleModules = LIVE_MODULES.filter(module => canAccess(session?.user.permissions, permissionForPath(module.path)));

  const hospitalId = hospital?.id;
  const [operations, setOperations] = useState<OperationsDashboard>();
  const [operationsLoading, setOperationsLoading] = useState(false);
  const [heroSlide, setHeroSlide] = useState(0);
  const [heroPaused, setHeroPaused] = useState(false);

  async function refreshOperations() {
    if (!hospitalId) return;
    setOperationsLoading(true);
    try { setOperations(await getOperationsDashboard(hospitalId)); }
    finally { setOperationsLoading(false); }
  }

  useEffect(() => { void refreshOperations(); }, [hospitalId]);
  useEffect(() => {
    if (heroPaused) return;
    const timer = window.setInterval(() => {
      setHeroSlide((current) => (current + 1) % HERO_SLIDES.length);
    }, 6000);
    return () => window.clearInterval(timer);
  }, [heroPaused]);
  const hospitalName =
    hospital?.name ??
    'Hospital';

  const dateLabel =
    new Intl.DateTimeFormat(
      'en',
      {
        weekday: 'long',
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      },
    ).format(new Date());

  function go(path: string) {
    if (!hospitalId) {
      return;
    }

    navigate(
      `/hospital/${hospitalId}/${path}`,
    );
  }

  return (
    <main className="medical-dashboard">
      <section
        className="medical-hero"
        onMouseEnter={() => setHeroPaused(true)}
        onMouseLeave={() => setHeroPaused(false)}
        aria-roledescription="carousel"
        aria-label="UNITECH hospital services"
      >
        <div className="medical-hero-slides" aria-hidden="true">
          {HERO_SLIDES.map((slide, index) => (
            <div
              key={slide.title}
              className={`medical-hero-slide${heroSlide === index ? ' active' : ''}`}
              style={{
                backgroundImage: `url(${slide.image})`,
              }}
            />
          ))}
        </div>
        <div className="medical-hero-glow medical-hero-glow-one" />
        <div className="medical-hero-glow medical-hero-glow-two" />

        <div className="medical-hero-content">
          <div className="medical-kicker">
            <span className="medical-kicker-icon">
              <HeartPulse size={16} />
            </span>

            Clinical Operations Center

            <span className="medical-live-chip">
              <span className="medical-live-dot" />
              STAGING
            </span>
          </div>

          <h1>
            {hospitalName}
            <span> Care Dashboard</span>
          </h1>

          <p>
            One operational view across clinical care, diagnostics,
            inpatient services, revenue cycle, HIM and supply chain.
          </p>

          <div className="medical-hero-meta">
            <span>
              <Clock3 size={15} />
              {dateLabel}
            </span>

            <span>
              <ShieldCheck size={15} />
              FHIR clinical platform
            </span>

            <span>
              <Database size={15} />
              Medplum connected
            </span>
          </div>

          <div className="medical-hero-actions">
            {canAccess(session?.user.permissions, 'patients') && <button
              type="button"
              className="medical-primary-button"
              onClick={() =>
                go('patients?module=registry')
              }
            >
              <Search size={17} />
              Find Patient
            </button>}

            {canAccess(session?.user.permissions, 'patients') && <button
              type="button"
              className="medical-secondary-button"
              onClick={() =>
                go('patients?module=registry')
              }
            >
              <UserPlus size={17} />
              Patient Registry
            </button>}

            {canAccess(session?.user.permissions, 'radiology') && <button
              type="button"
              className="medical-ghost-button"
              onClick={() =>
                go('radiology')
              }
            >
              <Microscope size={17} />
              Open RIS
              <ArrowRight size={16} />
            </button>}
          </div>
        </div>

        <div className="medical-hero-carousel-control" aria-label="Select dashboard image">
          {HERO_SLIDES.map((slide, index) => (
            <button
              key={slide.title}
              type="button"
              className={heroSlide === index ? 'active' : ''}
              onClick={() => setHeroSlide(index)}
              aria-label={`Show ${slide.title}`}
              aria-current={heroSlide === index ? 'true' : undefined}
            >
              <span />
            </button>
          ))}
        </div>
      </section>

      <nav
        className="dashboard-section-nav"
        aria-label="Dashboard sections"
      >
        <a href="#clinical-overview">
          Operations Overview
        </a>
        <a href="#clinical-modules">
          Live Modules
        </a>
      </nav>

      <section className="command-metrics" aria-label="Live hospital operations">
        <CommandMetric icon={<Users/>} label="Registered Patients" value={operations?.analytics?.patients} loading={operationsLoading}/>
        <CommandMetric icon={<Activity/>} label="Active Encounters" value={operations?.analytics?.encounters.active} loading={operationsLoading} tone="blue"/>
        <CommandMetric icon={<CalendarDays/>} label="Appointments" value={operations?.analytics?.appointments} loading={operationsLoading}/>
        <CommandMetric icon={<BedDouble/>} label="Inpatients / Ward" value={operations?.nursing?.summary.patients} loading={operationsLoading} tone="teal"/>
        <CommandMetric icon={<HeartPulse/>} label="ICU Patients" value={operations?.icu?.summary.patients} loading={operationsLoading} tone="rose"/>
        <CommandMetric icon={<WalletCards/>} label={`Outstanding ${HOSPITAL_CURRENCY}`} value={operations?.analytics?.finance.outstanding} loading={operationsLoading} tone="amber" money/>
      </section>

      <section className="command-strip">
        <div className="command-alerts">
          <header><span><AlertTriangle size={18}/><b>Operational Attention</b></span><button onClick={() => void refreshOperations()}><RefreshCw className={operationsLoading ? 'spin' : ''}/></button></header>
          <div className="command-alert-grid">
            <AlertItem value={operations?.nursing?.summary.overdue ?? 0} label="Overdue nursing tasks" path="nursing" go={go}/>
            <AlertItem value={operations?.analytics?.records.openDeficiencies ?? 0} label="Open record deficiencies" path="medical-records" go={go}/>
            <AlertItem value={operations?.analytics?.records.pendingResultReviews ?? 0} label="Results awaiting review" path="patients?module=clinical" go={go}/>
            <AlertItem value={operations?.inventory?.summary.lowStock ?? 0} label="Low-stock items" path="inventory" go={go}/>
            <AlertItem value={operations?.inventory?.summary.expiringLots ?? 0} label="Expiring inventory lots" path="inventory" go={go}/>
            <AlertItem value={operations?.icu?.summary.withoutDailyPlan ?? 0} label="ICU plans required" path="icu" go={go}/>
          </div>
        </div>
        <div className="command-cycle">
          <span>COMPLETE CARE CYCLE</span>
          <div><i>MPI</i><b>→</b><i>Encounter</i><b>→</b><i>Clinical</i><b>→</b><i>Disposition</i><b>→</b><i>Revenue</i><b>→</b><i>HIM</i></div>
          <small>Live orchestration across {visibleModules.length} authorized workspaces</small>
        </div>
      </section>

      <section
        id="clinical-overview"
        className="medical-overview-grid medical-overview-rail"
        aria-label="Clinical capability highlights"
      >
        <CapabilityCard
          eyebrow="Patient Care"
          title="Registry + Clinical Chart"
          description="Patient demographics, encounters and the longitudinal clinical record."
          icon={<Users size={21} />}
          tone="blue"
        />

        <CapabilityCard
          eyebrow="Diagnostics"
          title="Laboratory Workflow"
          description="Orders, specimens, results and final diagnostic reporting."
          icon={<FlaskConical size={21} />}
          tone="violet"
        />

        <CapabilityCard
          eyebrow="Medical Imaging"
          title="RIS + PACS + OHIF"
          description="Worklist, DICOM MWL, PACS synchronization, images and reports."
          icon={<Microscope size={21} />}
          tone="teal"
        />

        <CapabilityCard
          eyebrow="Clinical Record"
          title="Encounter Documentation"
          description="Vitals, diagnosis, allergies, notes and medication workflows."
          icon={<FileText size={21} />}
          tone="amber"
        />
      </section>

      <section className="medical-dashboard-grid">
        <div className="medical-main-column">
          <section
            id="clinical-modules"
            className="medical-panel"
          >
            <PanelHeader
              eyebrow="Live Workspaces"
              title="Clinical Modules"
              description="Open the modules currently available in this staging environment."
              action={
                <span className="panel-count">
                  {visibleModules.length} available
                </span>
              }
            />

            <div className="medical-module-grid">
              {visibleModules.map(
                (module) => (
                  <ClinicalModuleCard
                    key={module.title}
                    module={module}
                    onClick={
                      module.path
                        ? () =>
                            go(
                              module.path!,
                            )
                        : undefined
                    }
                  />
                ),
              )}
            </div>
          </section>

          {UPCOMING_MODULES.length > 0 && <section id="clinical-roadmap" className="medical-panel medical-roadmap-panel"><PanelHeader eyebrow="Roadmap" title="Next Hospital Workspaces" description="Planned operational modules after the current clinical core."/><div className="medical-roadmap-grid">{UPCOMING_MODULES.map((module)=><RoadmapCard key={module.title} module={module}/>)}</div></section>}
        </div>

        <aside className="medical-side-column">
          <section className="medical-panel medical-readiness-panel">
            <PanelHeader
              eyebrow="Clinical Core"
              title="Implemented Coverage"
              description="Current patient-chart and diagnostic capabilities."
            />

            <div className="readiness-list">
              <ReadinessItem
                title="Patient registration"
                description="Patient identity and hospital record"
              />

              <ReadinessItem
                title="Encounter workspace"
                description="Visit-specific clinical workflow"
              />

              <ReadinessItem
                title="Vitals & problem list"
                description="Observations and diagnoses"
              />

              <ReadinessItem
                title="Allergies & medications"
                description="Clinical safety information"
              />

              <ReadinessItem
                title="Clinical notes"
                description="Documentation and addenda"
              />

              <ReadinessItem
                title="Laboratory"
                description="Order-to-report workflow"
              />

              <ReadinessItem
                title="Radiology / PACS"
                description="RIS-to-image-to-report workflow"
              />

              <ReadinessItem title="Inpatient care" description="ADT, beds, nursing, rounds, OR and ICU" />
              <ReadinessItem title="Revenue cycle" description="Automatic charges, invoices and claims" />
              <ReadinessItem title="HIM & audit" description="Deficiencies, signature, lock and archive" />
              <ReadinessItem title="Supply chain" description="Procurement, lots, expiry and consumption" />
            </div>
          </section>

          <section className="medical-panel medical-shortcuts-panel">
            <PanelHeader
              eyebrow="Diagnostics"
              title="Imaging Shortcuts"
              description="Fast access to the imaging operations center."
            />

            <button
              type="button"
              className="medical-shortcut"
              onClick={() =>
                go('radiology')
              }
            >
              <span className="medical-shortcut-icon blue">
                <Microscope size={19} />
              </span>

              <span>
                <strong>RIS Worklist</strong>
                <small>
                  Orders, workflow, images and reports
                </small>
              </span>

              <ArrowRight size={17} />
            </button>

            <button
              type="button"
              className="medical-shortcut"
              onClick={() =>
                go('radiology/stations')
              }
            >
              <span className="medical-shortcut-icon amber">
                <Settings2 size={19} />
              </span>

              <span>
                <strong>Modality Stations</strong>
                <small>
                  DICOM stations and Orthanc connectivity
                </small>
              </span>

              <ArrowRight size={17} />
            </button>
          </section>

          <section className="medical-environment-note">
            <div className="environment-note-icon">
              <CheckCircle2 size={20} />
            </div>

            <div>
              <strong>Staging clinical environment</strong>
              <p>
                The dashboard intentionally focuses on
                implemented clinical workflows and removes
                empty production metrics until their services
                are built.
              </p>
            </div>
          </section>
        </aside>
      </section>
    </main>
  );
}

function CapabilityCard({
  eyebrow,
  title,
  description,
  icon,
  tone,
}: {
  eyebrow: string;
  title: string;
  description: string;
  icon: ReactNode;
  tone: ModuleTone;
}) {
  return (
    <article
      className={`capability-card ${tone}`}
      data-accent={toneColor(tone)}
    >
      <div className="capability-icon">
        {icon}
      </div>

      <div className="capability-content">
        <span>{eyebrow}</span>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>

      <div className="capability-check">
        <CheckCircle2 size={17} />
      </div>
    </article>
  );
}

function PanelHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="medical-panel-header">
      <div>
        <span>{eyebrow}</span>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>

      {action}
    </div>
  );
}

function ClinicalModuleCard({
  module,
  onClick,
}: {
  module: ModuleDefinition;
  onClick?: () => void;
}) {
  const stateLabel =
    module.state === 'live'
      ? 'Live'
      : module.state === 'integrated'
        ? 'Integrated'
        : module.state === 'patient-chart'
          ? 'Patient Chart'
          : 'Coming Soon';

  return (
    <button
      type="button"
      className="medical-module-card"
      onClick={onClick}
      disabled={!onClick}
      data-accent={toneColor(
        module.tone,
      )}
    >
      <div className={`medical-module-icon ${module.tone}`}>
        {module.icon}
      </div>

      <div className="medical-module-copy">
        <div className="medical-module-title-row">
          <strong>{module.title}</strong>

          <span
            className={`medical-module-status ${module.state}`}
          >
            <span />
            {stateLabel}
          </span>
        </div>

        <p>{module.description}</p>
        <small>{module.detail}</small>
      </div>

      <span className="medical-module-arrow">
        <ArrowRight size={18} />
      </span>
    </button>
  );
}

function RoadmapCard({
  module,
}: {
  module: ModuleDefinition;
}) {
  return (
    <article
      className="roadmap-card"
      data-accent={toneColor(
        module.tone,
      )}
    >
      <div className={`roadmap-icon ${module.tone}`}>
        {module.icon}
      </div>

      <div>
        <span className="roadmap-status">
          Planned
        </span>

        <strong>{module.title}</strong>
        <p>{module.description}</p>
      </div>
    </article>
  );
}

function CommandMetric({ icon, label, value, loading, tone = 'blue', money = false }: { icon: ReactNode; label: string; value?: number; loading: boolean; tone?: ModuleTone; money?: boolean }) {
  return <article className={`command-metric ${tone}`}><span>{icon}</span><div><b>{loading && value === undefined ? '—' : `${(value ?? 0).toLocaleString()}${money ? '' : ''}`}</b><small>{label}</small></div></article>;
}

function AlertItem({ value, label, path, go }: { value: number; label: string; path: string; go: (path: string) => void }) {
  return <button type="button" className={value > 0 ? 'attention' : 'clear'} onClick={() => go(path)}><b>{value}</b><span>{label}</span><ArrowRight size={15}/></button>;
}

function permissionForPath(path?: string): string {
  if (!path) return 'dashboard';
  if (path.startsWith('patients?module=laboratory')) return 'laboratory';
  if (path.startsWith('patients?module=medications') || path.startsWith('pharmacy')) return 'pharmacy';
  if (path.startsWith('patients?module=clinical')) return 'clinical';
  if (path.startsWith('patients')) return 'patients';
  if (path.startsWith('radiology')) return 'radiology';
  return path.split('/')[0];
}


function toneColor(
  tone: ModuleTone,
) {
  const colors: Record<
    ModuleTone,
    string
  > = {
    blue: '#1769e0',
    teal: '#059669',
    violet: '#7c3aed',
    amber: '#d97706',
    rose: '#dc4760',
    slate: '#64748b',
  };

  return colors[tone];
}

function ReadinessItem({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="readiness-item">
      <span className="readiness-check">
        <CheckCircle2 size={16} />
      </span>

      <div>
        <strong>{title}</strong>
        <span>{description}</span>
      </div>
    </div>
  );
}
