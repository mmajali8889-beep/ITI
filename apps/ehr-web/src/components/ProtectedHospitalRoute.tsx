import { Navigate, Outlet, useLocation, useParams } from 'react-router-dom';
import { useAuth } from '../context/useAuth';
import { canAccess } from '../auth/permissions';

// Top-level module segments under /hospital/:hospitalId/ that map 1:1 to a permission.
const MODULE_ROUTES = [
  'dashboard', 'patients', 'appointments', 'emergency', 'inpatient', 'nursing', 'rounds',
  'consultations', 'laboratory', 'radiology', 'pharmacy', 'surgery', 'icu', 'bed-management',
  'discharge', 'billing', 'medical-records', 'inventory', 'administration',
];

export default function ProtectedHospitalRoute() {
  const { hospitalId, patientId } = useParams<{ hospitalId: string; patientId: string }>();
  const location = useLocation();
  const { loading, session } = useAuth();

  if (loading) {
    return <main className="route-loading" role="status">Verifying secure session…</main>;
  }

  if (!session || !hospitalId || session.hospitalId !== hospitalId) {
    return <Navigate to="/" replace />;
  }

  const isPatient = session.user.resourceType === 'Patient';
  const isPortal = location.pathname.startsWith('/portal/');

  if (isPortal || isPatient) {
    // The portal is only for the signed-in patient's own record, and patients
    // never get the staff workspace.
    if (isPatient && isPortal && patientId === session.user.id) return <Outlet />;
    if (isPatient) return <Navigate to={`/portal/${hospitalId}/${session.user.id}`} replace />;
    return <Navigate to={`/hospital/${hospitalId}/dashboard`} replace />;
  }

  const prefix = `/hospital/${hospitalId}/`;
  const segments = location.pathname.startsWith(prefix)
    ? location.pathname.slice(prefix.length).split('/').filter(Boolean)
    : [];
  const required = routePermission(segments, location.search);
  if (required && !canAccess(session.user.permissions, required)) {
    const fallback = firstAllowed(session.user.permissions);
    if (!fallback) {
      return <main className="route-loading" role="alert">Your account has no access to any hospital module. Contact an administrator.</main>;
    }
    return <Navigate to={`${prefix}${fallback}`} replace />;
  }

  return <Outlet />;
}

function routePermission(segments: string[], search: string): string | undefined {
  const [first, second] = segments;
  const params = new URLSearchParams(search);

  if (first === 'patient') {
    if (second === 'register') return 'registration';
    const tab = params.get('tab');
    if (tab === 'laboratory') return 'laboratory';
    if (tab === 'radiology') return 'radiology';
    if (tab === 'medications') return 'pharmacy';
    return 'clinical';
  }
  if (first === 'clinical') {
    if (second === 'laboratory') return 'laboratory';
    if (second === 'medications') return 'pharmacy';
    return 'clinical';
  }
  if (first === 'patients') {
    const module = params.get('module');
    return module === 'laboratory' ? 'laboratory' : module === 'medications' ? 'pharmacy' : module === 'clinical' ? 'clinical' : 'patients';
  }
  return first && MODULE_ROUTES.includes(first) ? first : undefined;
}

function firstAllowed(permissions: string[]): string | undefined {
  return MODULE_ROUTES.find(route => canAccess(permissions, route));
}
