import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  AlertTriangle,
  Beaker,
  FileText,
  FlaskConical,
  RefreshCw,
  Search,
  ShieldAlert,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import {
  getOrderSpecimens,
  getPatientLabOrders,
  getPatientLabReports,
  getPatientLabResults,
} from '../api/laboratoryApi';
import type {
  LabOrder,
  LabReport,
  LabResult,
  LabSpecimen,
} from '../types/laboratory';
import FinalLabReport from './FinalLabReport';
import './PatientLaboratory.css';

interface Props {
  patientId: string;
  hospitalId: string;
}

type Filter = 'all' | 'abnormal' | 'critical' | 'final' | 'reports';

export default function PatientLaboratory({ patientId, hospitalId }: Props) {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<LabOrder[]>([]);
  const [results, setResults] = useState<LabResult[]>([]);
  const [reports, setReports] = useState<LabReport[]>([]);
  const [selectedReport, setSelectedReport] = useState<LabReport | null>(null);
  const [reportSpecimens, setReportSpecimens] = useState<LabSpecimen[]>([]);
  const [reportLoading, setReportLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const [orderData, resultData, reportData] = await Promise.all([
        getPatientLabOrders(patientId, hospitalId),
        getPatientLabResults(patientId, hospitalId),
        getPatientLabReports(patientId, hospitalId),
      ]);
      setOrders(orderData.orders ?? []);
      setResults(resultData.results ?? []);
      setReports(reportData.reports ?? []);
    } catch (err) {
      console.error(err);
      setError('Unable to load patient laboratory history.');
    } finally {
      setLoading(false);
    }
  }, [patientId, hospitalId]);

  useEffect(() => { void load(); }, [load]);

  const orderMap = useMemo(
    () => new Map(orders.filter((o) => o.id).map((o) => [o.id!, o])),
    [orders],
  );

  const reportMap = useMemo(() => {
    const map = new Map<string, LabReport>();
    for (const report of reports) {
      if (!report.orderId) continue;
      const current = map.get(report.orderId);
      if (!current || dateValue(report.issuedAt) >= dateValue(current.issuedAt)) {
        map.set(report.orderId, report);
      }
    }
    return map;
  }, [reports]);

  const abnormalCount = results.filter((r) => r.interpretation !== 'N').length;
  const criticalCount = results.filter((r) => r.interpretation === 'LL' || r.interpretation === 'HH').length;
  const finalReportCount = reports.filter((r) => isFinalReport(r.status)).length;

  const visibleResults = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return results.filter((result) => {
      const order = orderMap.get(result.orderId ?? '');
      const report = reportMap.get(result.orderId ?? '');
      const matchesText =
        !needle ||
        result.testName.toLowerCase().includes(needle) ||
        result.testCode?.toLowerCase().includes(needle) ||
        order?.testName.toLowerCase().includes(needle) ||
        report?.testName.toLowerCase().includes(needle);
      const matchesFilter =
        filter === 'all' ||
        (filter === 'abnormal' && result.interpretation !== 'N') ||
        (filter === 'critical' && (result.interpretation === 'LL' || result.interpretation === 'HH')) ||
        (filter === 'final' && result.status === 'final') ||
        (filter === 'reports' && Boolean(report));
      return matchesText && matchesFilter;
    });
  }, [results, orderMap, reportMap, query, filter]);

  const groups = useMemo(() => {
    const map = new Map<string, LabResult[]>();
    for (const result of visibleResults) {
      const key = result.orderId ?? 'unlinked';
      map.set(key, [...(map.get(key) ?? []), result]);
    }
    return [...map.entries()]
      .map(([orderId, groupResults]) => ({
        orderId,
        order: orderMap.get(orderId),
        report: reportMap.get(orderId),
        results: groupResults.sort((a, b) => dateValue(b.performedAt) - dateValue(a.performedAt)),
      }))
      .sort((a, b) => dateValue(b.results[0]?.performedAt) - dateValue(a.results[0]?.performedAt));
  }, [visibleResults, orderMap, reportMap]);

  const openReport = useCallback(async (report: LabReport) => {
    if (!report.orderId) {
      setError('This DiagnosticReport is not linked to a laboratory order.');
      return;
    }
    try {
      setReportLoading(true);
      setError('');
      const specimenData = await getOrderSpecimens(report.orderId, hospitalId);
      setReportSpecimens(specimenData.specimens ?? []);
      setSelectedReport(report);
    } catch (err) {
      console.error(err);
      setError('Unable to load specimens for this laboratory report.');
    } finally {
      setReportLoading(false);
    }
  }, [hospitalId]);

  const selectedOrder = selectedReport?.orderId
    ? orderMap.get(selectedReport.orderId)
    : undefined;

  const selectedResults = useMemo(() => {
    if (!selectedReport) return [];
    if (selectedReport.resultIds?.length) {
      const ids = new Set(selectedReport.resultIds);
      return results.filter((r) => r.id && ids.has(r.id));
    }
    return results.filter((r) => r.orderId === selectedReport.orderId);
  }, [selectedReport, results]);

  if (loading) {
    return <div className="patient-lab-loading">Loading laboratory history...</div>;
  }

  return (
    <div className="patient-lab">
      <header className="patient-lab-header">
        <div>
          <div className="patient-lab-eyebrow"><FlaskConical size={15} /> LONGITUDINAL LABORATORY</div>
          <h2>Laboratory History</h2>
          <p>Orders, results and persisted FHIR DiagnosticReports across patient encounters.</p>
        </div>
        <button type="button" className="patient-lab-refresh" onClick={() => void load()}>
          <RefreshCw size={16} /> Refresh
        </button>
      </header>

      {error && <div className="patient-lab-error"><AlertTriangle size={17} />{error}</div>}

      {criticalCount > 0 && (
        <div className="patient-lab-critical">
          <ShieldAlert size={19} />
          <div>
            <strong>{criticalCount} critical laboratory result{criticalCount === 1 ? '' : 's'} in the record</strong>
            <span>Historical critical flags are shown in context below.</span>
          </div>
        </div>
      )}

      <section className="patient-lab-stats">
        <Stat label="Orders" value={orders.length} icon={<Beaker size={17} />} />
        <Stat label="Results" value={results.length} icon={<FlaskConical size={17} />} />
        <Stat label="Abnormal" value={abnormalCount} icon={<AlertTriangle size={17} />} tone={abnormalCount ? 'warning' : 'normal'} />
        <Stat label="Critical" value={criticalCount} icon={<ShieldAlert size={17} />} tone={criticalCount ? 'critical' : 'normal'} />
        <Stat label="Final Reports" value={finalReportCount} icon={<FileText size={17} />} tone="success" />
      </section>

      <section className="patient-lab-toolbar">
        <label className="patient-lab-search">
          <Search size={16} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search test, code or panel..." />
        </label>
        <div className="patient-lab-filters">
          {([
            ['all', 'All'],
            ['abnormal', 'Abnormal'],
            ['critical', 'Critical'],
            ['final', 'Final Results'],
            ['reports', 'Reports'],
          ] as const).map(([value, label]) => (
            <button type="button" key={value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>
              {label}
            </button>
          ))}
        </div>
      </section>

      {reportLoading && <div className="patient-lab-report-loading">Loading report specimens...</div>}

      {groups.length === 0 ? (
        <div className="patient-lab-empty">
          <FlaskConical size={34} />
          <strong>No laboratory results found</strong>
          <span>Results will appear here after laboratory processing.</span>
        </div>
      ) : (
        <div className="patient-lab-groups">
          {groups.map(({ orderId, order, report, results: groupResults }) => {
            const groupCritical = groupResults.some((r) => r.interpretation === 'LL' || r.interpretation === 'HH');
            const groupAbnormal = groupResults.some((r) => r.interpretation !== 'N');
            return (
              <article className={groupCritical ? 'patient-lab-group critical' : groupAbnormal ? 'patient-lab-group abnormal' : 'patient-lab-group'} key={orderId}>
                <header>
                  <div>
                    <span className="patient-lab-order-code">{order?.testCode ?? 'LAB'}</span>
                    <h3>{order?.testName ?? groupResults[0]?.testName ?? 'Laboratory Results'}</h3>
                    <p>{formatDateTime(order?.authoredOn ?? groupResults[0]?.performedAt)}</p>
                  </div>
                  <div className="patient-lab-group-actions">
                    {groupCritical && <span className="patient-lab-badge critical">CRITICAL</span>}
                    {!groupCritical && groupAbnormal && <span className="patient-lab-badge abnormal">ABNORMAL</span>}
                    {report && <span className={`patient-lab-report-status ${report.status}`}>{report.status.toUpperCase()}</span>}
                    {report && (
                      <button type="button" className="patient-lab-report-button" onClick={() => void openReport(report)}>
                        <FileText size={15} /> {isFinalReport(report.status) ? 'View Final Report' : 'View Preliminary'}
                      </button>
                    )}
                    {order?.encounterId && (
                      <button type="button" onClick={() => navigate(`/hospital/${hospitalId}/clinical/laboratory/patient/${patientId}/encounter/${order.encounterId}`)}>
                        Open Lab Workflow
                      </button>
                    )}
                  </div>
                </header>

                <div className="patient-lab-result-grid">
                  {groupResults.map((result) => (
                    <div className={`patient-lab-result ${flagClass(result.interpretation)}`} key={result.id ?? `${result.testCode}-${result.performedAt}`}>
                      <div><strong>{result.testName}</strong><span>{result.testCode}</span></div>
                      <div className="patient-lab-value"><strong>{result.value ?? '—'}</strong><span>{result.unit}</span></div>
                      <div className="patient-lab-reference"><span>Reference</span><strong>{reference(result)}</strong></div>
                      <span className={`patient-lab-flag ${flagClass(result.interpretation)}`}>{result.interpretation}</span>
                    </div>
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {selectedReport && selectedOrder && (
        <div className="patient-lab-report-overlay" role="dialog" aria-modal="true" aria-label="Laboratory report">
          <div className="patient-lab-report-modal">
            <FinalLabReport
              report={selectedReport}
              order={selectedOrder}
              specimens={reportSpecimens}
              results={selectedResults}
              patientId={selectedReport.patientId ?? patientId}
              encounterId={selectedReport.encounterId ?? selectedOrder.encounterId ?? ''}
              onClose={() => {
                setSelectedReport(null);
                setReportSpecimens([]);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, icon, tone = 'normal' }: {
  label: string; value: number; icon: ReactNode;
  tone?: 'normal' | 'warning' | 'critical' | 'success';
}) {
  return <div className={`patient-lab-stat ${tone}`}><div>{icon}</div><span>{label}</span><strong>{value}</strong></div>;
}

function isFinalReport(status?: string) {
  return status === 'final' || status === 'amended' || status === 'corrected' || status === 'appended';
}

function flagClass(flag?: string) {
  if (flag === 'LL' || flag === 'HH') return 'critical';
  if (flag === 'L' || flag === 'H') return 'abnormal';
  return 'normal';
}

function reference(result: LabResult) {
  if (result.referenceLow !== undefined && result.referenceHigh !== undefined) return `${result.referenceLow} – ${result.referenceHigh} ${result.unit ?? ''}`.trim();
  if (result.referenceLow !== undefined) return `≥ ${result.referenceLow} ${result.unit ?? ''}`.trim();
  if (result.referenceHigh !== undefined) return `≤ ${result.referenceHigh} ${result.unit ?? ''}`.trim();
  return '—';
}

function formatDateTime(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

function dateValue(value?: string) {
  if (!value) return 0;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}
