import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileText, Loader2, Pencil, Save, ShieldCheck, X } from 'lucide-react';
import axios from 'axios';

import {
  amendRadiologyReport,
  createRadiologyReport,
  finalizeRadiologyReport,
  getOrderRadiologyReports,
  updateRadiologyReport,
} from '../api/radiologyApi';
import type { RadiologyOrder, RadiologyReport as Report } from '../types/radiology';
import './RadiologyReport.css';

interface Props {
  order: RadiologyOrder;
  patientId: string;
  encounterId: string;
  hospitalId: string;
  practitionerId?: string;
  practitionerName?: string;
  readOnly?: boolean;
  onClose: () => void;
  onChanged?: () => void;
}

type FormState = {
  technique: string;
  comparison: string;
  findings: string;
  impression: string;
  recommendations: string;
};

const EMPTY: FormState = { technique: '', comparison: '', findings: '', impression: '', recommendations: '' };
const finalLike = (status?: string) => ['final', 'amended', 'corrected', 'appended'].includes(status ?? '');

function messageFrom(error: unknown, fallback: string) {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { message?: string | string[]; error?: string } | undefined;
    if (Array.isArray(data?.message)) return data.message.join(', ');
    if (typeof data?.message === 'string') return data.message;
    if (typeof data?.error === 'string') return data.error;
    if (!error.response) return 'Unable to reach the hospital API.';
  }
  return fallback;
}

export default function RadiologyReport({
  order, patientId, encounterId, hospitalId, practitionerId, practitionerName,
  readOnly = false, onClose, onChanged,
}: Props) {
  const [report, setReport] = useState<Report | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [amendMode, setAmendMode] = useState(false);

  const locked =
    readOnly ||
    (finalLike(report?.status) && !amendMode);

  const hydrate = useCallback((value: Report | null) => {
    setReport(value);
    setForm({
      technique: value?.technique ?? '',
      comparison: value?.comparison ?? '',
      findings: value?.findings ?? '',
      impression: value?.impression ?? '',
      recommendations: value?.recommendations ?? '',
    });
    setAmendMode(false);
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await getOrderRadiologyReports(order.id);
      hydrate(response.reports?.[0] ?? null);
    } catch (e) {
      setError(messageFrom(e, 'Unable to load radiology report.'));
    } finally { setLoading(false); }
  }, [hydrate, order.id]);

  useEffect(() => { void load(); }, [load]);

  const statusLabel = useMemo(() => (report?.status ?? 'not-started').replaceAll('-', ' ').toUpperCase(), [report?.status]);

  function setField(key: keyof FormState, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
    setSuccess('');
  }

  async function save() {
    if (locked) return;
    setSaving(true); setError(''); setSuccess('');
    try {
      const payload = { ...form, radiologistId: practitionerId, radiologistName: practitionerName };
      const updated = report
        ? await updateRadiologyReport(report.id, payload)
        : await createRadiologyReport({ orderId: order.id, patientId, encounterId, hospitalId, ...payload });
      hydrate(updated); setSuccess('Preliminary report saved.'); onChanged?.();
    } catch (e) { setError(messageFrom(e, 'Unable to save radiology report.')); }
    finally { setSaving(false); }
  }

  async function finalize() {
    if (readOnly) return;
    if (!form.findings.trim()) {
      setError('Findings are required before finalizing the report.');
      return;
    }
    if (!form.impression.trim()) {
      setError('Impression is required before finalizing the report.');
      return;
    }
    setSaving(true); setError(''); setSuccess('');
    try {
      let current = report;
      const payload = { ...form, radiologistId: practitionerId, radiologistName: practitionerName };
      current = current
        ? await updateRadiologyReport(current.id, payload)
        : await createRadiologyReport({ orderId: order.id, patientId, encounterId, hospitalId, ...payload });
      const finalized = await finalizeRadiologyReport(current.id, {
        verifierId: practitionerId,
        verifierName: practitionerName,
        verificationConfirmed: true,
        impression: form.impression.trim(),
      });
      hydrate(finalized); setSuccess('Radiology report finalized.'); onChanged?.();
    } catch (e) { setError(messageFrom(e, 'Unable to finalize radiology report.')); }
    finally { setSaving(false); }
  }

  function beginAmendment() {
    if (!report || readOnly || !finalLike(report.status)) {
      return;
    }

    setAmendMode(true);
    setError('');
    setSuccess(
      'Amendment mode enabled. Save Amendment will preserve the finalized report status history.',
    );
  }

  function cancelAmendment() {
    if (report) {
      hydrate(report);
    } else {
      setAmendMode(false);
    }

    setError('');
    setSuccess('');
  }

  async function amend() {
    if (
      !report ||
      readOnly ||
      !finalLike(report.status) ||
      !amendMode
    ) {
      return;
    }

    if (!form.findings.trim()) {
      setError('Findings are required for an amended report.');
      return;
    }

    if (!form.impression.trim()) {
      setError('Impression is required for an amended report.');
      return;
    }

    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const updated = await amendRadiologyReport(
        report.id,
        {
          ...form,
          radiologistId: practitionerId,
          radiologistName: practitionerName,
        },
      );

      hydrate(updated);
      setSuccess('Radiology report amended.');
      onChanged?.();
    } catch (e) {
      setError(
        messageFrom(
          e,
          'Unable to amend radiology report.',
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rr-backdrop" role="presentation">
      <section className="rr-modal" role="dialog" aria-modal="true" aria-label="Radiology report">
        <header className="rr-header">
          <div><div className="rr-kicker"><FileText size={15} /> RADIOLOGIST REPORT</div><h2>{order.examName}</h2>
            <div className="rr-meta"><span>{order.modality}</span><span>{order.examCode || 'No code'}</span><span>{order.bodySiteName || 'Body site not specified'}</span></div>
          </div>
          <div className="rr-header-right"><span className={`rr-status rr-status-${report?.status ?? 'new'}`}>{statusLabel}</span><button className="rr-close" onClick={onClose} type="button"><X size={19} /></button></div>
        </header>

        <div className="rr-context">
          <div><strong>Clinical indication</strong><p>{order.clinicalIndication || '—'}</p></div>
          <div><strong>Clinical question</strong><p>{order.clinicalQuestion || '—'}</p></div>
        </div>

        {error && <div className="rr-alert error"><AlertTriangle size={17} />{error}</div>}
        {success && <div className="rr-alert success"><CheckCircle2 size={17} />{success}</div>}

        {loading ? <div className="rr-loading"><Loader2 className="rr-spin" /> Loading report…</div> : (
          <div className="rr-body">
            <label><span>Technique</span><textarea rows={3} value={form.technique} disabled={locked} onChange={(e) => setField('technique', e.target.value)} placeholder="Imaging technique, contrast, sequences or views…" /></label>
            <label><span>Comparison</span><textarea rows={2} value={form.comparison} disabled={locked} onChange={(e) => setField('comparison', e.target.value)} placeholder="Prior examinations used for comparison…" /></label>
            <label className="wide"><span>Findings</span><textarea rows={8} value={form.findings} disabled={locked} onChange={(e) => setField('findings', e.target.value)} placeholder="Describe relevant imaging findings…" /></label>
            <label className="wide impression"><span>Impression *</span><textarea rows={5} value={form.impression} disabled={locked} onChange={(e) => setField('impression', e.target.value)} placeholder="Concise diagnostic impression…" /></label>
            <label className="wide"><span>Recommendations</span><textarea rows={3} value={form.recommendations} disabled={locked} onChange={(e) => setField('recommendations', e.target.value)} placeholder="Follow-up or additional imaging recommendations…" /></label>
          </div>
        )}

        <footer className="rr-footer">
          <div className="rr-verification">{report?.verifierName && <><ShieldCheck size={16} /><span>Verified by <strong>{report.verifierName}</strong>{report.verifiedAt ? ` · ${new Date(report.verifiedAt).toLocaleString()}` : ''}</span></>}</div>
          <div className="rr-actions">
            <button
              type="button"
              className="secondary"
              onClick={onClose}
            >
              Close
            </button>

            {!readOnly &&
              !finalLike(report?.status) && (
                <>
                  <button
                    type="button"
                    className="secondary"
                    disabled={saving || loading}
                    onClick={() => void save()}
                  >
                    {saving ? (
                      <Loader2
                        className="rr-spin"
                        size={16}
                      />
                    ) : (
                      <Save size={16} />
                    )}
                    Save Draft
                  </button>

                  <button
                    type="button"
                    className="primary"
                    disabled={saving || loading}
                    onClick={() => void finalize()}
                  >
                    <ShieldCheck size={16} />
                    Finalize Report
                  </button>
                </>
              )}

            {!readOnly &&
              finalLike(report?.status) &&
              !amendMode && (
                <button
                  type="button"
                  className="primary"
                  disabled={saving || loading}
                  onClick={beginAmendment}
                >
                  <Pencil size={16} />
                  Amend Report
                </button>
              )}

            {!readOnly &&
              finalLike(report?.status) &&
              amendMode && (
                <>
                  <button
                    type="button"
                    className="secondary"
                    disabled={saving || loading}
                    onClick={cancelAmendment}
                  >
                    Cancel Amendment
                  </button>

                  <button
                    type="button"
                    className="primary"
                    disabled={saving || loading}
                    onClick={() => void amend()}
                  >
                    <ShieldCheck size={16} />
                    Save Amendment
                  </button>
                </>
              )}
          </div>
        </footer>
      </section>
    </div>
  );
}
