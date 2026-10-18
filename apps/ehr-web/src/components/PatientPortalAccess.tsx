import { useEffect, useState } from 'react';
import { Copy, KeyRound, Loader2, RotateCcw, ShieldOff, UserPlus } from 'lucide-react';
import {
  createPortalAccess,
  disablePortalAccess,
  getPortalAccess,
  resetPortalAccess,
  type PortalAccess,
} from '../api/medicalRecordsApi';
import './PatientPortalAccess.css';

function errorMessage(error: unknown, fallback: string): string {
  const message = (error as { response?: { data?: { message?: string | string[] } } })
    .response?.data?.message;
  return Array.isArray(message) ? message.join(', ') : message || fallback;
}

/**
 * Staff view of the patient's portal login (27.2): create one, or disable it.
 * Rendered only for users with the 'medical-records' permission. A generated
 * password is shown once and never stored in the page beyond this view.
 */
export default function PatientPortalAccess({
  hospitalId,
  patientId,
  suggestedUsername,
}: {
  hospitalId: string;
  patientId: string;
  suggestedUsername?: string;
}) {
  const [access, setAccess] = useState<PortalAccess>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [username, setUsername] = useState(suggestedUsername ?? '');
  const [password, setPassword] = useState('');
  const [issued, setIssued] = useState<{ username: string; password?: string; action: 'created' | 'reset' }>();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getPortalAccess(patientId, hospitalId)
      .then(result => {
        if (!cancelled) {
          setAccess(result);
          setError('');
        }
      })
      .catch(err => {
        if (!cancelled) setError(errorMessage(err, 'Unable to load portal access'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [hospitalId, patientId]);

  async function create() {
    setBusy(true);
    setError('');
    try {
      const result = await createPortalAccess(patientId, {
        hospitalId,
        username: username.trim(),
        password: password || undefined,
      });
      setAccess(result);
      setIssued({ username: result.username, password: result.temporaryPassword, action: 'created' });
      setCreating(false);
      setPassword('');
    } catch (err) {
      setError(errorMessage(err, 'Unable to create the portal login'));
    } finally {
      setBusy(false);
    }
  }

  async function reset(reEnable: boolean) {
    const question = reEnable
      ? 'Re-enable this portal login with a new one-time password?'
      : 'Reset the portal password? The patient is signed out and must use the new one-time password.';
    if (!window.confirm(question)) return;
    setBusy(true);
    setError('');
    try {
      const result = await resetPortalAccess(patientId, { hospitalId });
      setAccess(result);
      setIssued({ username: result.username, password: result.temporaryPassword, action: 'reset' });
      setCreating(false);
    } catch (err) {
      setError(errorMessage(err, 'Unable to reset the portal login'));
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    if (!window.confirm('Disable this patient\'s portal login? They will no longer be able to sign in.')) return;
    setBusy(true);
    setError('');
    try {
      setAccess(await disablePortalAccess(patientId, hospitalId));
      setIssued(undefined);
    } catch (err) {
      setError(errorMessage(err, 'Unable to disable the portal login'));
    } finally {
      setBusy(false);
    }
  }

  const portalUrl = `${window.location.origin}/portal/${hospitalId}/${patientId}`;
  const status = access?.status ?? 'none';

  return (
    <section className="portal-access-card" aria-label="Portal access">
      <header>
        <h3><KeyRound size={16} /> Portal access</h3>
        {!loading && (
          <span className={`portal-access-status ${status}`}>
            {status === 'active' ? 'Active' : status === 'disabled' ? 'Disabled' : 'No login'}
          </span>
        )}
      </header>

      {loading && <p className="portal-access-muted"><Loader2 size={14} className="spin" /> Checking portal access…</p>}

      {!loading && access && (
        <>
          {access.logins.length > 0 && (
            <ul className="portal-access-logins">
              {access.logins.map(login => (
                <li key={login.id}>
                  <b>{login.username ?? 'Unknown username'}</b>
                  <span>{login.active ? 'active' : 'disabled'}</span>
                </li>
              ))}
            </ul>
          )}

          {issued && (
            <div className="portal-access-issued" role="status">
              <p>
                {issued.action === 'created' ? 'Portal login created for' : 'New password set for'} <b>{issued.username}</b>.
              </p>
              {issued.password && (
                <p>
                  One-time password: <code>{issued.password}</code>
                  <button type="button" onClick={() => void navigator.clipboard?.writeText(issued.password ?? '')}>
                    <Copy size={13} /> Copy
                  </button>
                  <small>Give it to the patient now; it is not shown again.</small>
                </p>
              )}
              <small>Sign-in page: {portalUrl}</small>
            </div>
          )}

          {status === 'active' ? (
            <div className="portal-access-actions">
              <button type="button" className="portal-access-secondary" disabled={busy} onClick={() => void reset(false)}>
                <RotateCcw size={14} /> Reset password
              </button>
              <button type="button" className="portal-access-danger" disabled={busy} onClick={() => void disable()}>
                <ShieldOff size={14} /> Disable portal login
              </button>
            </div>
          ) : creating ? (
            <form
              className="portal-access-form"
              onSubmit={event => {
                event.preventDefault();
                void create();
              }}
            >
              <label>
                Username
                <input value={username} onChange={event => setUsername(event.target.value)} required autoComplete="off" />
              </label>
              <label>
                Password <small>(leave blank to generate a one-time password)</small>
                <input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="new-password" />
              </label>
              <div>
                <button type="submit" disabled={busy || !username.trim()}>
                  {busy ? <Loader2 size={14} className="spin" /> : <UserPlus size={14} />} Create login
                </button>
                <button type="button" className="portal-access-secondary" disabled={busy} onClick={() => setCreating(false)}>
                  Cancel
                </button>
              </div>
            </form>
          ) : status === 'disabled' ? (
            <div className="portal-access-actions">
              <button type="button" disabled={busy} onClick={() => void reset(true)}>
                <RotateCcw size={14} /> Re-enable with new password
              </button>
              <button type="button" className="portal-access-secondary" disabled={busy} onClick={() => setCreating(true)}>
                <UserPlus size={14} /> Create a new login
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => setCreating(true)}>
              <UserPlus size={14} /> Create portal login
            </button>
          )}
        </>
      )}

      {error && <p className="portal-access-error" role="alert">{error}</p>}
    </section>
  );
}
