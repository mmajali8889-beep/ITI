import type {
  ReactNode,
} from 'react';
import { useState } from 'react';

import {
  Activity,
  BedDouble,
  Building2,
  ChevronRight,
  FlaskConical,
  HeartPulse,
  LayoutDashboard,
  LogOut,
  Microscope,
  Pill,
  RadioTower,
  Stethoscope,
  ClipboardPlus,
  FolderLock,
  Settings2,
  PackageSearch,
  Pin,
  PinOff,
  UserPlus,
  Users,
} from 'lucide-react';

import {
  Outlet,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router-dom';

import {
  useHospital,
} from '../context/HospitalContext';

import QuickSwitch2026 from './QuickSwitch2026';
import BrandLogo from './BrandLogo';
import { useAuth } from '../context/useAuth';
import { canAccess } from '../auth/permissions';

import './HospitalLayout.css';

type NavItem = {
  key: string;
  label: string;
  icon: ReactNode;
  path?: string;
  disabled?: boolean;
  accent?: string;
  permission: string;
};

const PRIMARY_NAV: NavItem[] = [
  {
    key: 'dashboard',
    label: 'Dashboard',
    accent: '#1769e0',
    icon: <LayoutDashboard size={17} />,
    path: 'dashboard',
    permission: 'dashboard',
  },
  {
    key: 'registry',
    label: 'Patient Registry',
    accent: '#2563eb',
    icon: <Users size={17} />,
    path: 'patients?module=registry',
    permission: 'patients',
  },
  {
    key: 'register',
    label: 'Register Patient',
    accent: '#0ea5a4',
    icon: <UserPlus size={17} />,
    path: 'patient/register',
    permission: 'registration',
  },
  {
    key: 'clinical',
    label: 'Clinical Workspace',
    accent: '#059669',
    icon: <Stethoscope size={17} />,
    path: 'patients?module=clinical',
    permission: 'clinical',
  },
  {
    key: 'laboratory',
    label: 'Laboratory',
    accent: '#7c3aed',
    icon: <FlaskConical size={17} />,
    path: 'patients?module=laboratory',
    permission: 'laboratory',
  },
  {
    key: 'medications',
    label: 'Medications',
    accent: '#dc4760',
    icon: <Pill size={17} />,
    path: 'patients?module=medications',
    permission: 'pharmacy',
  },
  {
    key: 'radiology',
    label: 'Radiology & PACS',
    accent: '#0f6fca',
    icon: <Microscope size={17} />,
    path: 'radiology',
    permission: 'radiology',
  },
  {
    key: 'stations',
    label: 'Modality Stations',
    accent: '#d97706',
    icon: <RadioTower size={17} />,
    path: 'radiology/stations',
    permission: 'radiology',
  },
];


const QUICK_SWITCH_OPTIONS = [
  {
    value: 'dashboard',
    label: 'Dashboard',
    description: 'Clinical operations overview',
    accent: '#1769e0',
  },
  {
    value: 'registry',
    label: 'Patient Registry',
    description: 'Search and open patient records',
    accent: '#2563eb',
  },
  {
    value: 'register',
    label: 'Register Patient',
    description: 'Create a new patient record',
    accent: '#0ea5a4',
  },
  {
    value: 'clinical',
    label: 'Clinical Workspace',
    description: 'Patient chart and encounters',
    accent: '#059669',
  },
  {
    value: 'laboratory',
    label: 'Laboratory',
    description: 'Orders, specimens and results',
    accent: '#7c3aed',
  },
  {
    value: 'medications',
    label: 'Medications',
    description: 'Medication history and requests',
    accent: '#dc4760',
  },
  {
    value: 'radiology',
    label: 'Radiology & PACS',
    description: 'RIS worklist, PACS and reporting',
    accent: '#0f6fca',
  },
  {
    value: 'stations',
    label: 'Modality Stations',
    description: 'DICOM modality configuration',
    accent: '#d97706',
  },
  {
    value: 'appointments',
    label: 'Appointments',
    description: 'Clinic scheduling and patient arrival',
    accent: '#2563eb',
  },
  {
    value: 'emergency',
    label: 'Emergency',
    description: 'Arrival, triage and tracking board',
    accent: '#dc334b',
  },
  {
    value: 'pharmacy',
    label: 'Pharmacy Operations',
    description: 'Dispensing, formulary and inventory',
    accent: '#07946c',
  },
] as const;

const QUICK_SWITCH_PATHS: Record<
  string,
  string
> = {
  dashboard: 'dashboard',
  registry: 'patients?module=registry',
  register: 'patient/register',
  clinical: 'patients?module=clinical',
  laboratory: 'patients?module=laboratory',
  medications: 'patients?module=medications',
  radiology: 'radiology',
  stations: 'radiology/stations',
  appointments: 'appointments',
  emergency: 'emergency',
  pharmacy: 'pharmacy',
};

const SECONDARY_NAV: NavItem[] = [
  {
    key: 'appointments',
    label: 'Appointments',
    icon: <Activity size={17} />,
    path: 'appointments',
    permission: 'appointments',
  },
  {
    key: 'emergency',
    label: 'Emergency',
    icon: <HeartPulse size={17} />,
    path: 'emergency',
    permission: 'emergency',
  },
  {
    key: 'inpatient',
    label: 'Inpatient / ADT',
    icon: <BedDouble size={17} />,
    path: 'inpatient',
    permission: 'inpatient',
  },
  {
    key: 'pharmacy',
    label: 'Pharmacy Operations',
    icon: <Pill size={17} />,
    path: 'pharmacy',
    permission: 'pharmacy',
  },
  {
    key: 'nursing',
    label: 'Nursing / Ward',
    icon: <ClipboardPlus size={17} />,
    path: 'nursing',
    permission: 'nursing',
  },
  {
    key: 'rounds',
    label: 'Physician Rounds',
    icon: <Stethoscope size={17} />,
    path: 'rounds',
    permission: 'rounds',
  },
  {
    key: 'surgery',
    label: 'Surgery / OR',
    icon: <Activity size={17} />,
    path: 'surgery',
    permission: 'surgery',
  },
  {
    key: 'icu',
    label: 'Intensive Care',
    icon: <HeartPulse size={17} />,
    path: 'icu',
    permission: 'icu',
  },
  {
    key: 'consultations',
    label: 'Consultations',
    icon: <Stethoscope size={17} />,
    path: 'consultations',
    permission: 'consultations',
  },
  {
    key: 'bed-management',
    label: 'Bed Management',
    icon: <BedDouble size={17} />,
    path: 'bed-management',
    permission: 'bed-management',
  },
  {
    key: 'discharge',
    label: 'Discharge',
    icon: <LogOut size={17} />,
    path: 'discharge',
    permission: 'discharge',
  },
  {
    key: 'billing',
    label: 'Billing & Claims',
    icon: <Activity size={17} />,
    path: 'billing',
    permission: 'billing',
  },
  {
    key: 'medical-records',
    label: 'Medical Records / HIM',
    icon: <FolderLock size={17} />,
    path: 'medical-records',
    permission: 'medical-records',
  },
  {
    key: 'administration',
    label: 'Administration',
    icon: <Settings2 size={17} />,
    path: 'administration',
    permission: 'administration',
  },
  {
    key: 'inventory',
    label: 'Inventory & Supply',
    icon: <PackageSearch size={17} />,
    path: 'inventory',
    permission: 'inventory',
  },
];

export default function HospitalLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { hospitalId } = useParams<{
    hospitalId: string;
  }>();
  const { hospital } = useHospital();
  const { signOut, session } = useAuth();
  const permissions = session?.user.permissions;
  const [sidebarPinned, setSidebarPinned] = useState(() =>
    localStorage.getItem('unitech-sidebar-pinned') !== 'false'
  );
  const visiblePrimary = PRIMARY_NAV.filter(item => canAccess(permissions, item.permission));
  const visibleSecondary = SECONDARY_NAV.filter(item => canAccess(permissions, item.permission));
  const quickPermission: Record<string, string> = { registry: 'patients', register: 'registration', medications: 'pharmacy', stations: 'radiology' };
  const visibleQuickOptions = QUICK_SWITCH_OPTIONS.filter(option => canAccess(permissions, quickPermission[option.value] ?? option.value));

  const activeKey = resolveActiveKey(
    location.pathname,
    location.search,
  );

  function go(path: string) {
    if (!hospitalId) {
      return;
    }

    navigate(
      `/hospital/${hospitalId}/${path}`,
    );
  }

  function handleQuickSwitch(
    value: string,
  ) {
    const path =
      QUICK_SWITCH_PATHS[value];

    if (path) {
      go(path);
    }
  }

  function toggleSidebarPin() {
    setSidebarPinned((current) => {
      const next = !current;
      localStorage.setItem('unitech-sidebar-pinned', String(next));
      return next;
    });
  }

  return (
    <div className={`hospital-shell${sidebarPinned ? '' : ' sidebar-collapsed'}`}>
      <aside className="hospital-left-tabs">
        <div className="hospital-left-brand">
          <BrandLogo inverse compact />
          <button
            type="button"
            className="hospital-sidebar-pin"
            onClick={toggleSidebarPin}
            aria-label={sidebarPinned ? 'Hide sidebar' : 'Show sidebar'}
            aria-pressed={sidebarPinned}
            title={sidebarPinned ? 'إخفاء القائمة' : 'إظهار القائمة'}
          >
            {sidebarPinned ? <Pin size={15} /> : <PinOff size={15} />}
          </button>
        </div>

        <div className="hospital-left-context">
          <span className="hospital-left-context-icon">
            <Building2 size={15} />
          </span>

          <div>
            <small>Current Hospital</small>
            <strong>
              {hospital?.name ?? 'Hospital'}
            </strong>
          </div>
        </div>

        <div className="hospital-left-quick-switch">
          <QuickSwitch2026
            value={activeKey}
            options={[...visibleQuickOptions]}
            onChange={handleQuickSwitch}
            label="Clinical quick switch"
          />
        </div>

        <nav className="hospital-left-nav">
          <div className="hospital-left-section-label">
            Clinical Navigation
          </div>

          {visiblePrimary.map((item) => (
            <LeftTab
              key={item.key}
              item={item}
              active={activeKey === item.key}
              onClick={() =>
                item.path && go(item.path)
              }
            />
          ))}

          <div className="hospital-left-section-label spaced">
            Hospital Operations
          </div>

          {visibleSecondary.map((item) => (
            <LeftTab
              key={item.key}
              item={item}
              active={activeKey === item.key}
              onClick={() => item.path && go(item.path)}
            />
          ))}
        </nav>

        <div className="hospital-left-footer">
          <span className="hospital-left-staging">
            STAGING
          </span>

          <button
            type="button"
            className="hospital-left-change"
            onClick={async () => {
              await signOut();
              navigate('/', { replace: true });
            }}
          >
            <LogOut size={15} />
            Change Hospital
          </button>
        </div>
      </aside>

      <section className="hospital-shell-content">
        <Outlet />
      </section>
    </div>
  );
}

function LeftTab({
  item,
  active,
  onClick,
}: {
  item: NavItem;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={[
        'hospital-left-tab',
        active ? 'active' : '',
        item.disabled ? 'disabled' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      disabled={item.disabled}
      onClick={onClick}
      title={item.label}
      data-accent={
        item.accent ?? '#1769e0'
      }
    >
      <span className="hospital-left-tab-icon">
        {item.icon}
      </span>

      <span className="hospital-left-tab-label">
        {item.label}
      </span>

      {item.disabled ? (
        <small>SOON</small>
      ) : (
        <ChevronRight
          size={14}
          className="hospital-left-tab-arrow"
        />
      )}
    </button>
  );
}

function resolveActiveKey(
  pathname: string,
  search: string,
) {
  if (pathname.includes('/inpatient')) {
    return 'inpatient';
  }
  if (pathname.includes('/nursing')) {
    return 'nursing';
  }
  if (pathname.includes('/rounds')) {
    return 'rounds';
  }
  if (pathname.includes('/surgery')) {
    return 'surgery';
  }
  if (pathname.includes('/icu')) {
    return 'icu';
  }
  if (pathname.includes('/consultations')) {
    return 'consultations';
  }
  if (pathname.includes('/bed-management')) {
    return 'bed-management';
  }
  if (pathname.includes('/discharge')) {
    return 'discharge';
  }
  if (pathname.includes('/billing')) {
    return 'billing';
  }
  if (pathname.includes('/medical-records')) {
    return 'medical-records';
  }
  if (pathname.includes('/administration')) {
    return 'administration';
  }
  if (pathname.includes('/inventory')) {
    return 'inventory';
  }
  if (pathname.includes('/appointments')) {
    return 'appointments';
  }
  if (pathname.includes('/emergency')) {
    return 'emergency';
  }
  if (pathname.includes('/pharmacy')) {
    return 'pharmacy';
  }
  if (pathname.endsWith('/dashboard')) {
    return 'dashboard';
  }

  if (
    pathname.includes('/patient/register')
  ) {
    return 'register';
  }

  if (
    pathname.includes('/radiology/stations')
  ) {
    return 'stations';
  }

  if (
    pathname.includes('/radiology')
  ) {
    return 'radiology';
  }

  if (
    pathname.includes('/clinical/laboratory/')
  ) {
    return 'laboratory';
  }

  if (
    pathname.includes('/clinical/medications/')
  ) {
    return 'medications';
  }

  if (pathname.includes('/patients')) {
    const params = new URLSearchParams(search);
    const moduleName = params.get('module');

    if (moduleName === 'laboratory') {
      return 'laboratory';
    }

    if (moduleName === 'medications') {
      return 'medications';
    }

    if (moduleName === 'clinical') {
      return 'clinical';
    }

    return 'registry';
  }

  if (
    pathname.includes('/patient/') ||
    pathname.includes('/encounter/')
  ) {
    return 'clinical';
  }

  return 'dashboard';
}
