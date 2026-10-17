import { AlertTriangle, CheckCircle2, Printer, ShieldAlert, X } from 'lucide-react';
import type { LabOrder, LabReport, LabResult, LabSpecimen } from '../types/laboratory';
import './FinalLabReport.css';

interface Props {
  report: LabReport;
  order: LabOrder;
  specimens: LabSpecimen[];
  results: LabResult[];
  patientId: string;
  encounterId: string;
  onClose?: () => void;
}

export default function FinalLabReport({ report, order, specimens, results, patientId, encounterId, onClose }: Props) {
  const critical = results.some((r) => r.interpretation === 'LL' || r.interpretation === 'HH');
  const abnormal = results.filter((r) => r.interpretation !== 'N').length;
  const accession = specimens.map((s) => s.accessionNumber).filter(Boolean).join(', ') || '—';

  return (
    <section className="final-lab-report" id="final-lab-report">
      <div className="flr-toolbar no-print">
        <div>
          <span className="flr-kicker">FHIR DIAGNOSTIC REPORT</span>
          <strong>{isFinalReport(report.status) ? 'Final Laboratory Report' : 'Preliminary Laboratory Report'}</strong>
        </div>
        <div className="flr-actions">
          {isFinalReport(report.status) && <button type="button" onClick={() => window.print()}><Printer size={16} /> Print / PDF</button>}
          {onClose && <button type="button" className="icon" onClick={onClose}><X size={17} /></button>}
        </div>
      </div>

      <div className="flr-paper">
        <header className="flr-head">
          <div>
            <div className="flr-brand">HOSPITAL EHR</div>
            <h2>Laboratory Report</h2>
            <p>FHIR R4 DiagnosticReport</p>
          </div>
          <div className={`flr-status ${report.status}`}>
            <CheckCircle2 size={18} /> {report.status.toUpperCase()}
          </div>
        </header>

        <section className="flr-meta">
          <Meta label="Patient ID" value={shortId(patientId)} />
          <Meta label="Encounter" value={shortId(encounterId)} />
          <Meta label="Order" value={shortId(order.id)} />
          <Meta label="Accession" value={accession} />
          <Meta label="Test" value={`${order.testCode ?? 'LAB'} · ${order.testName}`} />
          <Meta label="Priority" value={order.priority.toUpperCase()} />
          <Meta label="Collected" value={formatDateTime(specimens[0]?.collectedAt)} />
          <Meta label="Issued" value={formatDateTime(report.issuedAt)} />
          <Meta label="Verified by" value={report.verifierName ?? report.performerName ?? 'Authorized user'} />
          <Meta label="Report ID" value={shortId(report.id)} />
        </section>

        {critical && (
          <div className="flr-critical"><ShieldAlert size={19} /><strong>Critical result present</strong><span>Immediate clinical review may be required.</span></div>
        )}

        <div className="flr-summary">
          <span>{results.length} results</span><span>{abnormal} abnormal</span><span>{specimens.length} specimen(s)</span>
        </div>

        <div className="flr-table-wrap">
          <table className="flr-table">
            <thead><tr><th>Test</th><th>Result</th><th>Unit</th><th>Reference Range</th><th>Flag</th><th>Status</th></tr></thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.id ?? `${r.testCode}-${r.performedAt}`} className={tone(r.interpretation)}>
                  <td><strong>{r.testName}</strong><small>{r.testCode ?? '—'}</small></td>
                  <td className="value">{r.value ?? '—'}</td>
                  <td>{r.unit ?? '—'}</td>
                  <td>{reference(r)}</td>
                  <td><span className={`flr-flag ${tone(r.interpretation)}`}>{r.interpretation}</span></td>
                  <td>{r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {report.conclusion && <section className="flr-conclusion"><span>Conclusion</span><p>{report.conclusion}</p></section>}

        {abnormal > 0 && !critical && <div className="flr-warning"><AlertTriangle size={16} /> Abnormal laboratory values are present.</div>}

        <footer className="flr-footer">
          <div><span>Verified by</span><strong>{report.verifierName ?? 'Authorized user'}</strong></div>
          <div><span>Verification date</span><strong>{formatDateTime(report.issuedAt)}</strong></div>
          <p>This report is generated from persisted FHIR DiagnosticReport, Observation, Specimen and ServiceRequest resources.</p>
        </footer>
      </div>
    </section>
  );
}

function isFinalReport(status?: string) { return status === 'final' || status === 'amended' || status === 'corrected' || status === 'appended'; }
function Meta({ label, value }: { label: string; value: string }) { return <div><span>{label}</span><strong>{value}</strong></div>; }
function tone(v?: string) { return v === 'LL' || v === 'HH' ? 'critical' : v === 'L' || v === 'H' ? 'abnormal' : 'normal'; }
function reference(r: LabResult) { if (r.referenceLow !== undefined && r.referenceHigh !== undefined) return `${r.referenceLow} – ${r.referenceHigh}`; if (r.referenceLow !== undefined) return `≥ ${r.referenceLow}`; if (r.referenceHigh !== undefined) return `≤ ${r.referenceHigh}`; return '—'; }
function formatDateTime(v?: string) { if (!v) return '—'; const d = new Date(v); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(); }
function shortId(v?: string) { if (!v) return '—'; return v.length > 14 ? `${v.slice(0, 12)}…` : v; }
