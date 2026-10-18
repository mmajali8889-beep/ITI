import { useEffect, useState } from 'react';
import { Loader2, RotateCcw, Save } from 'lucide-react';
import {
  getJourneyPathways,
  saveJourneyPathways,
  type JourneyPathwaySettings,
} from '../api/administrationApi';
import './JourneyPathwaysEditor.css';

function errorMessage(error: unknown, fallback: string): string {
  const message = (error as { response?: { data?: { message?: string | string[] } } })
    .response?.data?.message;
  return Array.isArray(message) ? message.join(', ') : message || fallback;
}

/**
 * Administration → Care pathways (27.3): which patient-journey milestones are
 * mandatory for each service line. Unticked milestones still show on the
 * journey as optional but do not block it or lower its completion.
 */
export default function JourneyPathwaysEditor({ hospitalId }: { hospitalId: string }) {
  const [settings, setSettings] = useState<JourneyPathwaySettings>();
  const [draft, setDraft] = useState<Record<string, Set<string>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');

  function apply(result: JourneyPathwaySettings) {
    setSettings(result);
    setDraft(Object.fromEntries(result.pathways.map(p => [p.code, new Set(p.required)])));
  }

  useEffect(() => {
    setBusy(true);
    getJourneyPathways(hospitalId)
      .then(result => {
        apply(result);
        setError('');
      })
      .catch(err => setError(errorMessage(err, 'Unable to load care pathways')))
      .finally(() => setBusy(false));
  }, [hospitalId]);

  function toggle(code: string, key: string) {
    setSaved('');
    setDraft(current => {
      const next = new Set(current[code]);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { ...current, [code]: next };
    });
  }

  function resetPathway(code: string) {
    const pathway = settings?.pathways.find(p => p.code === code);
    if (!pathway) return;
    setSaved('');
    setDraft(current => ({ ...current, [code]: new Set(pathway.defaults) }));
  }

  async function save() {
    if (!settings) return;
    setBusy(true);
    setError('');
    try {
      // A pathway equal to its defaults is stored as "use the defaults".
      const payload = Object.fromEntries(
        settings.pathways.map(p => {
          const chosen = settings.milestones.map(m => m.key).filter(k => draft[p.code]?.has(k));
          const isDefault =
            chosen.length === p.defaults.length && chosen.every(k => p.defaults.includes(k));
          return [p.code, isDefault ? null : chosen];
        }),
      );
      apply(await saveJourneyPathways(hospitalId, payload));
      setSaved('Care pathways saved. Open journeys use them on their next refresh.');
    } catch (err) {
      setError(errorMessage(err, 'Unable to save care pathways'));
    } finally {
      setBusy(false);
    }
  }

  if (!settings) {
    return (
      <div className="pathways-editor">
        {busy && <p className="pathways-muted"><Loader2 size={14} className="spin" /> Loading care pathways…</p>}
        {error && <p className="pathways-error" role="alert">{error}</p>}
      </div>
    );
  }

  return (
    <div className="pathways-editor">
      <p className="pathways-muted">
        Ticked milestones are mandatory for that service line: until done they hold the journey and count against
        completion. Unticked ones are shown as optional. Ordered tests, treatments and admissions only apply when
        ordered.
      </p>
      <div className="pathways-table-wrap">
        <table className="pathways-table">
          <thead>
            <tr>
              <th scope="col">Milestone</th>
              {settings.pathways.map(p => (
                <th scope="col" key={p.code}>
                  <span>{p.label}</span>
                  {p.customized && <em>customised</em>}
                  <button type="button" title="Back to the default" onClick={() => resetPathway(p.code)} disabled={busy}>
                    <RotateCcw size={12} /> Default
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {settings.milestones.map(m => (
              <tr key={m.key}>
                <th scope="row">{m.label}{m.locked && <small> (always)</small>}</th>
                {settings.pathways.map(p => (
                  <td key={p.code}>
                    <input
                      type="checkbox"
                      aria-label={`${m.label} mandatory for ${p.label}`}
                      checked={m.locked || Boolean(draft[p.code]?.has(m.key))}
                      disabled={m.locked || busy}
                      onChange={() => toggle(p.code, m.key)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="pathways-actions">
        <button type="button" onClick={() => void save()} disabled={busy}>
          {busy ? <Loader2 size={14} className="spin" /> : <Save size={14} />} Save care pathways
        </button>
        {saved && <span className="pathways-saved" role="status">{saved}</span>}
      </div>
      {error && <p className="pathways-error" role="alert">{error}</p>}
    </div>
  );
}
