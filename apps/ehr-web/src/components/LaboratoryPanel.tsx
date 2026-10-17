import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { ReactNode } from 'react';

import {
  AlertTriangle,
  Beaker,
  CheckCircle2,
  ChevronRight,
  FlaskConical,
  LoaderCircle,
  Plus,
  RefreshCw,
  ShieldAlert,
  TestTube2,
  X,
} from 'lucide-react';

import {
  createLabOrder,
  createLabResultsBatch,
  createLabSpecimen,
  getEncounterLabOrders,
  getEncounterLabResults,
  getOrderLabResults,
  getOrderSpecimens,
  createLabReport,
  finalizeLabReport,
  getOrderLabReports,
  updateLabSpecimenStatus,
  validateLabResultTechnical,
  validateLabResultClinical,
  acknowledgeCriticalLabResult,
} from '../api/laboratoryApi';

import type {
  CreateLabResultRequest,
  LabInterpretation,
  LabOrder,
  LabPriority,
  LabResult,
  LabSpecimen,
  LabReport,
} from '../types/laboratory';

import FinalLabReport from './FinalLabReport';
import './LaboratoryPanel.css';

interface Props {
  patientId: string;
  encounterId: string;
  hospitalId: string;
  practitionerId?: string;
  practitionerName?: string;
}

interface ResultDraft {
  rowId: string;
  testCode: string;
  testName: string;
  value: string;
  unit: string;
  referenceLow: string;
  referenceHigh: string;
  criticalLow: string;
  criticalHigh: string;
}

const COMMON_ORDERS = [
  { code: 'CBC', name: 'Complete Blood Count' },
  { code: 'CMP', name: 'Comprehensive Metabolic Panel' },
  { code: 'BMP', name: 'Basic Metabolic Panel' },
  { code: 'LIPID', name: 'Lipid Profile' },
  { code: 'HBA1C', name: 'Hemoglobin A1c' },
  { code: 'CRP', name: 'C-Reactive Protein' },
];

const CBC_ANALYTES = [
  ['WBC', 'White Blood Cell Count'],
  ['RBC', 'Red Blood Cell Count'],
  ['HGB', 'Hemoglobin'],
  ['HCT', 'Hematocrit'],
  ['MCV', 'Mean Corpuscular Volume'],
  ['MCH', 'Mean Corpuscular Hemoglobin'],
  ['MCHC', 'Mean Corpuscular Hemoglobin Concentration'],
  ['RDW', 'Red Cell Distribution Width'],
  ['PLT', 'Platelet Count'],
] as const;

function newRow(code = '', name = ''): ResultDraft {
  return {
    rowId: crypto.randomUUID(),
    testCode: code,
    testName: name,
    value: '',
    unit: '',
    referenceLow: '',
    referenceHigh: '',
    criticalLow: '',
    criticalHigh: '',
  };
}

export default function LaboratoryPanel({
  patientId,
  encounterId,
  hospitalId,
  practitionerId,
  practitionerName,
}: Props) {
  const [orders, setOrders] = useState<LabOrder[]>([]);
  const [results, setResults] = useState<LabResult[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [orderResults, setOrderResults] = useState<LabResult[]>([]);
  const [specimens, setSpecimens] = useState<LabSpecimen[]>([]);
  const [selectedSpecimenId, setSelectedSpecimenId] = useState('');

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const [orderModal, setOrderModal] = useState(false);
  const [specimenModal, setSpecimenModal] = useState(false);
  const [resultModal, setResultModal] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [report, setReport] = useState<LabReport | null>(null);

  const [orderCode, setOrderCode] = useState('');
  const [orderName, setOrderName] = useState('');
  const [priority, setPriority] = useState<LabPriority>('routine');
  const [clinicalNote, setClinicalNote] = useState('');

  const [specimenTypeCode, setSpecimenTypeCode] = useState('');
  const [specimenTypeName, setSpecimenTypeName] = useState('');
  const [collectorName, setCollectorName] = useState(practitionerName ?? '');

  const [rows, setRows] = useState<ResultDraft[]>([newRow()]);

  const selectedOrder = useMemo(
    () => orders.find((item) => item.id === selectedOrderId),
    [orders, selectedOrderId],
  );

  const abnormal = useMemo(
    () => results.filter((r) => r.interpretation !== 'N'),
    [results],
  );

  const critical = useMemo(
    () => results.filter((r) => ['LL', 'HH'].includes(r.interpretation)),
    [results],
  );

  const loadEncounter = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const [orderData, resultData] = await Promise.all([
        getEncounterLabOrders(encounterId, hospitalId),
        getEncounterLabResults(encounterId, hospitalId),
      ]);

      setOrders(orderData.orders);
      setResults(resultData.results);

      if (!selectedOrderId && orderData.orders[0]?.id) {
        setSelectedOrderId(orderData.orders[0].id);
      }
    } catch (err) {
      console.error(err);
      setError('Unable to load laboratory data.');
    } finally {
      setLoading(false);
    }
  }, [encounterId, hospitalId, selectedOrderId]);

  const loadOrder = useCallback(async () => {
    if (!selectedOrderId) {
      setSpecimens([]);
      setOrderResults([]);
      setReport(null);
      return;
    }

    try {
      const [specimenData, resultData, reportData] = await Promise.all([
        getOrderSpecimens(selectedOrderId, hospitalId),
        getOrderLabResults(selectedOrderId, hospitalId),
        getOrderLabReports(selectedOrderId, hospitalId),
      ]);

      setSpecimens(specimenData.specimens);
      setOrderResults(resultData.results);
      setReport(reportData.reports[0] ?? null);

      if (!selectedSpecimenId && specimenData.specimens[0]?.id) {
        setSelectedSpecimenId(specimenData.specimens[0].id);
      }
    } catch (err) {
      console.error(err);
      setError('Unable to load selected laboratory order.');
    }
  }, [selectedOrderId, selectedSpecimenId, hospitalId]);

  useEffect(() => {
    void loadEncounter();
  }, [loadEncounter]);

  useEffect(() => {
    void loadOrder();
  }, [loadOrder]);

  function toast(text: string) {
    setMessage(text);
    window.setTimeout(() => setMessage(''), 3000);
  }

  async function createOrder() {
    if (!orderCode.trim() || !orderName.trim()) {
      setError('Test code and test name are required.');
      return;
    }

    try {
      setBusy(true);
      setError('');

      const created = await createLabOrder({
        patientId,
        encounterId,
        hospitalId,
        testCode: orderCode.trim(),
        testName: orderName.trim(),
        priority,
        practitionerId,
        practitionerName,
        clinicalNote: clinicalNote.trim() || undefined,
      });

      setOrderModal(false);
      setOrderCode('');
      setOrderName('');
      setClinicalNote('');
      setPriority('routine');

      await loadEncounter();

      if (created.id) {
        setSelectedOrderId(created.id);
      }

      toast('Laboratory order created.');
    } catch (err) {
      console.error(err);
      setError(apiMessage(err, 'Unable to create laboratory order.'));
    } finally {
      setBusy(false);
    }
  }

  async function collectSpecimen() {
    if (!selectedOrderId) {
      setError('Select an order first.');
      return;
    }

    if (!specimenTypeCode.trim() || !specimenTypeName.trim()) {
      setError('Specimen code and specimen name are required.');
      return;
    }

    try {
      setBusy(true);
      setError('');

      const created = await createLabSpecimen({
        orderId: selectedOrderId,
        patientId,
        encounterId,
        hospitalId,
        specimenTypeCode: specimenTypeCode.trim(),
        specimenTypeName: specimenTypeName.trim(),
        collectorId: practitionerId,
        collectorName: collectorName.trim() || undefined,
      });

      setSpecimenModal(false);
      setSpecimenTypeCode('');
      setSpecimenTypeName('');
      await loadOrder();

      if (created.id) {
        setSelectedSpecimenId(created.id);
      }

      toast('Specimen collected.');
    } catch (err) {
      console.error(err);
      setError('Unable to collect specimen.');
    } finally {
      setBusy(false);
    }
  }

  async function receiveSpecimen() {
    const specimen = specimens.find((item) => item.id === selectedSpecimenId);
    if (!specimen?.id) {
      setError('Select a specimen first.');
      return;
    }
    try {
      setBusy(true);
      setError('');
      await updateLabSpecimenStatus(specimen.id, {
        status: 'available', receivedAt: new Date().toISOString(), acceptanceStatus: 'pending',
        receiverId: practitionerId, receiverName: practitionerName,
      });
      await loadOrder();
      toast('Specimen received in the laboratory.');
    } catch (err) {
      setError(apiMessage(err, 'Unable to receive specimen.'));
    } finally {
      setBusy(false);
    }
  }

  async function acceptSpecimen() {
    const specimen = specimens.find((item) => item.id === selectedSpecimenId);
    if (!specimen?.id) {
      setError('Select a specimen first.');
      return;
    }
    try {
      setBusy(true);
      setError('');
      await updateLabSpecimenStatus(specimen.id, {
        status: 'available', receivedAt: specimen.receivedAt ?? new Date().toISOString(), acceptanceStatus: 'accepted',
        receiverId: practitionerId, receiverName: practitionerName,
      });
      await loadOrder();
      toast('Specimen accepted for analysis.');
    } catch (err) {
      setError(apiMessage(err, 'Unable to accept specimen.'));
    } finally {
      setBusy(false);
    }
  }

  async function rejectSpecimen() {
    const specimen = specimens.find((item) => item.id === selectedSpecimenId);
    if (!specimen?.id) {
      setError('Select a specimen first.');
      return;
    }
    const reason = window.prompt('Specimen rejection reason (required):');
    if (!reason?.trim()) return;
    try {
      setBusy(true);
      setError('');
      await updateLabSpecimenStatus(specimen.id, {
        status: 'unsatisfactory', receivedAt: specimen.receivedAt ?? new Date().toISOString(), acceptanceStatus: 'rejected',
        rejectionReason: reason.trim(), recollectionRequired: true,
        receiverId: practitionerId, receiverName: practitionerName,
      });
      await loadOrder();
      toast('Specimen rejected; recollection is required.');
    } catch (err) {
      setError(apiMessage(err, 'Unable to reject specimen.'));
    } finally {
      setBusy(false);
    }
  }

  function setRow(
    rowId: string,
    field: keyof Omit<ResultDraft, 'rowId'>,
    value: string,
  ) {
    setRows((current) =>
      current.map((row) =>
        row.rowId === rowId ? { ...row, [field]: value } : row,
      ),
    );
  }

  function numberOrUndefined(value: string) {
    if (!value.trim()) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  async function saveResults() {
    if (!selectedOrderId || !selectedSpecimenId) {
      setError('Select an order and specimen first.');
      return;
    }

    const complete = rows.filter(
      (row) =>
        row.testCode.trim() &&
        row.testName.trim() &&
        row.value.trim() &&
        row.unit.trim(),
    );

    if (!complete.length) {
      setError('Enter at least one complete result row.');
      return;
    }

    const payload: CreateLabResultRequest[] = complete.map((row) => ({
      orderId: selectedOrderId,
      specimenId: selectedSpecimenId,
      patientId,
      encounterId,
      hospitalId,
      testCode: row.testCode.trim(),
      testName: row.testName.trim(),
      value: Number(row.value),
      unit: row.unit.trim(),
      referenceLow: numberOrUndefined(row.referenceLow),
      referenceHigh: numberOrUndefined(row.referenceHigh),
      criticalLow: numberOrUndefined(row.criticalLow),
      criticalHigh: numberOrUndefined(row.criticalHigh),
      status: 'preliminary',
      performerId: practitionerId,
      performerName: practitionerName,
    }));

    if (payload.some((item) => !Number.isFinite(item.value))) {
      setError('Result values must be valid numbers.');
      return;
    }

    try {
      setBusy(true);
      setError('');
      await createLabResultsBatch(payload);
      setResultModal(false);
      setRows([newRow()]);
      await Promise.all([loadEncounter(), loadOrder()]);
      toast('Preliminary laboratory results saved.');
    } catch (err) {
      console.error(err);
      setError('Unable to save laboratory results.');
    } finally {
      setBusy(false);
    }
  }

  async function finalize() {
    if (!selectedOrder?.id) {
      setError('Select a laboratory order first.');
      return;
    }

    if (!orderResults.length) {
      setError('This order has no laboratory results to finalize.');
      return;
    }

    try {
      setBusy(true);
      setError('');

      let currentReport = report;

      if (!currentReport?.id) {
        currentReport = await createLabReport({
          orderId: selectedOrder.id,
          patientId,
          encounterId,
          hospitalId,
          specimenIds: specimens.map((item) => item.id).filter((id): id is string => Boolean(id)),
          resultIds: orderResults.map((item) => item.id).filter((id): id is string => Boolean(id)),
          performerId: practitionerId,
          performerName: practitionerName,
        });
      }

      if (!currentReport.id) {
        throw new Error('DiagnosticReport was created without an ID.');
      }

      const finalized = ['final', 'amended', 'corrected'].includes(currentReport.status)
        ? currentReport
        : await finalizeLabReport(currentReport.id, {
            verifierId: practitionerId,
            verifierName: practitionerName,
          });

      setReport(finalized);
      await Promise.all([loadEncounter(), loadOrder()]);
      setShowReport(true);
      toast('FHIR DiagnosticReport finalized successfully.');
    } catch (err) {
      console.error(err);
      setError('Unable to create or finalize the laboratory DiagnosticReport.');
    } finally {
      setBusy(false);
    }
  }

  async function runTechnicalValidation() {
    const pending = orderResults.filter((item) => item.id && !item.technicalValidated);
    if (!pending.length) return;
    try {
      setBusy(true);
      setError('');
      for (const result of pending) {
        await validateLabResultTechnical(result.id!, {
          hospitalId,
          validatorId: practitionerId,
          validatorName: practitionerName || 'Laboratory user',
        });
      }
      await Promise.all([loadEncounter(), loadOrder()]);
      toast('Technical validation completed.');
    } catch (err) {
      console.error(err);
      setError('Technical validation failed. Confirm your role and result status.');
    } finally {
      setBusy(false);
    }
  }

  async function runClinicalValidation() {
    const missingTechnical = orderResults.some((item) => !item.technicalValidated);
    if (missingTechnical) {
      setError('Complete technical validation before clinical validation.');
      return;
    }
    const pending = orderResults.filter((item) => item.id && !item.clinicalValidated);
    if (!pending.length) return;
    try {
      setBusy(true);
      setError('');
      for (const result of pending) {
        await validateLabResultClinical(result.id!, {
          hospitalId,
          validatorId: practitionerId,
          validatorName: practitionerName || 'Laboratory supervisor',
        });
      }
      await Promise.all([loadEncounter(), loadOrder()]);
      toast('Clinical validation completed.');
    } catch (err) {
      console.error(err);
      setError('Clinical validation requires a laboratory supervisor or consultant role.');
    } finally {
      setBusy(false);
    }
  }

  async function acknowledgeCriticalResults() {
    const pending = orderResults.filter(
      (item) => item.id && ['LL', 'HH'].includes(item.interpretation) && !item.criticalAcknowledged,
    );
    if (!pending.length) return;
    const notifiedPersonName = window.prompt('Name of the doctor or nurse notified:')?.trim();
    if (!notifiedPersonName) return;
    try {
      setBusy(true);
      setError('');
      for (const result of pending) {
        await acknowledgeCriticalLabResult(result.id!, {
          hospitalId,
          notifiedPersonName,
          notifiedRole: 'doctor',
          notificationMethod: 'phone',
          readBackConfirmed: true,
          acknowledgedById: practitionerId,
          acknowledgedByName: practitionerName || 'Laboratory user',
        });
      }
      await Promise.all([loadEncounter(), loadOrder()]);
      toast('Critical result notification and read-back recorded.');
    } catch (err) {
      console.error(err);
      setError('Unable to record critical-result acknowledgement.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="lab-loading">
        <LoaderCircle className="lab-spin" size={20} />
        Loading laboratory workspace...
      </div>
    );
  }

  return (
    <div className="lab-workspace">
      <header className="lab-header">
        <div>
          <div className="lab-eyebrow">
            <FlaskConical size={15} />
            ENCOUNTER LABORATORY
          </div>
          <h2>Laboratory</h2>
          <p>
            Orders, specimens, result entry, abnormal flags,
            verification and final reporting.
          </p>
        </div>

        <div className="lab-header-actions">
          <button className="lab-btn secondary" type="button" onClick={() => void loadEncounter()}>
            <RefreshCw size={16} /> Refresh
          </button>
          <button className="lab-btn primary" type="button" onClick={() => setOrderModal(true)}>
            <Plus size={16} /> New Order
          </button>
        </div>
      </header>

      {error && (
        <div className="lab-alert error">
          <AlertTriangle size={17} />
          <span>{error}</span>
          <button type="button" onClick={() => setError('')}>
            <X size={15} />
          </button>
        </div>
      )}

      {message && (
        <div className="lab-alert success">
          <CheckCircle2 size={17} /> {message}
        </div>
      )}

      {critical.length > 0 && (
        <div className="lab-critical">
          <ShieldAlert size={22} />
          <div>
            <strong>Critical laboratory result</strong>
            <span>
              {critical.length} critical result
              {critical.length === 1 ? '' : 's'} require attention.
            </span>
          </div>
          <div className="lab-critical-list">
            {critical.slice(0, 4).map((result) => (
              <span key={result.id ?? result.testCode}>
                {result.testCode}: {result.value} {result.unit}{' '}
                <b>{result.interpretation}</b>
              </span>
            ))}
          </div>
        </div>
      )}

      <section className="lab-stats">
        <Stat label="Orders" value={orders.length} />
        <Stat label="Results" value={results.length} />
        <Stat label="Abnormal" value={abnormal.length} tone={abnormal.length ? 'warning' : 'normal'} />
        <Stat label="Critical" value={critical.length} tone={critical.length ? 'critical' : 'normal'} />
      </section>

      <div className="lab-grid">
        <aside className="lab-orders">
          <div className="lab-section-title">
            <span>LAB ORDERS</span>
            <strong>{orders.length}</strong>
          </div>

          {orders.length === 0 ? (
            <Empty icon={<Beaker size={30} />} title="No laboratory orders" />
          ) : (
            <div className="lab-order-list">
              {orders.map((order) => (
                <button
                  type="button"
                  key={order.id}
                  className={order.id === selectedOrderId ? 'lab-order selected' : 'lab-order'}
                  onClick={() => {
                    setSelectedOrderId(order.id ?? '');
                    setSelectedSpecimenId('');
                    setShowReport(false);
                    setReport(null);
                  }}
                >
                  <div>
                    <span className="lab-code">{order.testCode ?? 'LAB'}</span>
                    <Pill value={order.status} />
                  </div>
                  <strong>{order.testName}</strong>
                  <small>
                    {order.priority.toUpperCase()} · {formatDate(order.authoredOn)}
                  </small>
                  <ChevronRight size={16} />
                </button>
              ))}
            </div>
          )}
        </aside>

        <main className="lab-detail">
          {!selectedOrder ? (
            <Empty icon={<FlaskConical size={34} />} title="Select a laboratory order" />
          ) : (
            <>
              <div className="lab-detail-header">
                <div>
                  <div className="lab-inline">
                    <span className="lab-code">{selectedOrder.testCode ?? 'LAB'}</span>
                    <Pill value={selectedOrder.priority} />
                    <Pill value={selectedOrder.status} />
                  </div>
                  <h3>{selectedOrder.testName}</h3>
                  <p>Ordered {formatDateTime(selectedOrder.authoredOn)}</p>
                </div>

                <div className="lab-header-actions">
                  <button className="lab-btn secondary" type="button" onClick={() => setSpecimenModal(true)}>
                    <TestTube2 size={16} /> Collect Specimen
                  </button>
                  <button
                    className="lab-btn primary"
                    type="button"
                    onClick={() => setResultModal(true)}
                    disabled={!specimens.length}
                  >
                    <Beaker size={16} /> Enter Results
                  </button>
                </div>
              </div>

              <section className="lab-subsection">
                <div className="lab-subsection-head">
                  <div><TestTube2 size={16} /><strong>Specimens</strong><span>{specimens.length}</span></div>
                </div>

                {specimens.length === 0 ? (
                  <div className="lab-inline-empty">No specimen collected yet.</div>
                ) : (
                  <div className="lab-specimens">
                    {specimens.map((specimen) => (
                      <button
                        type="button"
                        key={specimen.id}
                        className={specimen.id === selectedSpecimenId ? 'lab-specimen selected' : 'lab-specimen'}
                        onClick={() => setSelectedSpecimenId(specimen.id ?? '')}
                      >
                        <TestTube2 size={17} />
                        <div>
                          <strong>{specimen.specimenTypeName ?? 'Specimen'}</strong>
                          <span>{specimen.accessionNumber ?? 'No accession'}</span>
                          <small>{formatDateTime(specimen.collectedAt)}</small>
                        </div>
                        <Pill value={specimen.status} />
                      </button>
                    ))}
                  </div>
                )}

                {selectedSpecimenId && (() => {
                  const selected = specimens.find((item) => item.id === selectedSpecimenId);
                  if (!selected) return null;
                  return (
                    <div className="lab-specimen-workflow">
                      <div>
                        <strong>Specimen workflow</strong>
                        <span>{selected.barcode ?? selected.accessionNumber ?? 'Barcode pending'} · {selected.workflowStatus ?? 'collected'}</span>
                        {selected.rejectionReason && <small>Rejected: {selected.rejectionReason}</small>}
                      </div>
                      {!selected.receivedAt && <button type="button" className="lab-btn secondary" disabled={busy} onClick={() => void receiveSpecimen()}>Receive in Lab</button>}
                      {selected.acceptanceStatus !== 'accepted' && selected.acceptanceStatus !== 'rejected' && <button type="button" className="lab-btn primary" disabled={busy} onClick={() => void acceptSpecimen()}>Accept Specimen</button>}
                      {selected.acceptanceStatus !== 'rejected' && <button type="button" className="lab-btn danger" disabled={busy} onClick={() => void rejectSpecimen()}>Reject / Recollect</button>}
                    </div>
                  );
                })()}
              </section>

              <section className="lab-subsection">
                <div className="lab-subsection-head">
                  <div><Beaker size={16} /><strong>Results</strong><span>{orderResults.length}</span></div>
                  {orderResults.length > 0 && (
                    <div className="lab-header-actions">
                      {orderResults.some((item) => !item.technicalValidated) && (
                        <button className="lab-btn secondary" type="button" onClick={() => void runTechnicalValidation()} disabled={busy}>
                          Technical Validation
                        </button>
                      )}
                      {orderResults.every((item) => item.technicalValidated) && orderResults.some((item) => !item.clinicalValidated) && (
                        <button className="lab-btn secondary" type="button" onClick={() => void runClinicalValidation()} disabled={busy}>
                          Clinical Validation
                        </button>
                      )}
                      {orderResults.some((item) => ['LL', 'HH'].includes(item.interpretation) && !item.criticalAcknowledged) && (
                        <button className="lab-btn danger" type="button" onClick={() => void acknowledgeCriticalResults()} disabled={busy}>
                          Acknowledge Critical
                        </button>
                      )}
                      <button
                        className="lab-btn verify"
                        type="button"
                        onClick={() => void finalize()}
                        disabled={busy || orderResults.some((item) => !item.technicalValidated || !item.clinicalValidated || (['LL', 'HH'].includes(item.interpretation) && !item.criticalAcknowledged))}
                      >
                        <CheckCircle2 size={16} /> {report && ['final', 'amended', 'corrected'].includes(report.status) ? 'View Final Report' : 'Finalize Report'}
                      </button>
                    </div>
                  )}
                </div>

                {orderResults.length === 0 ? (
                  <div className="lab-inline-empty">No results entered for this order.</div>
                ) : (
                  <ResultsTable results={orderResults} />
                )}
              </section>

              {showReport && report && orderResults.length > 0 && (
                <FinalLabReport
                  report={report}
                  order={selectedOrder}
                  specimens={specimens}
                  results={orderResults}
                  patientId={patientId}
                  encounterId={encounterId}
                  onClose={() => setShowReport(false)}
                />
              )}
            </>
          )}
        </main>
      </div>

      {orderModal && (
        <Modal title="New Laboratory Order" onClose={() => setOrderModal(false)}>
          <div className="lab-quick">
            {COMMON_ORDERS.map((test) => (
              <button
                key={test.code}
                type="button"
                onClick={() => {
                  setOrderCode(test.code);
                  setOrderName(test.name);
                }}
              >
                <b>{test.code}</b>
                <span>{test.name}</span>
              </button>
            ))}
          </div>

          <div className="lab-form">
            <Field label="Test Code">
              <input value={orderCode} onChange={(e) => setOrderCode(e.target.value)} />
            </Field>
            <Field label="Priority">
              <select value={priority} onChange={(e) => setPriority(e.target.value as LabPriority)}>
                <option value="routine">Routine</option>
                <option value="urgent">Urgent</option>
                <option value="asap">ASAP</option>
                <option value="stat">STAT</option>
              </select>
            </Field>
            <Field label="Test Name" wide>
              <input value={orderName} onChange={(e) => setOrderName(e.target.value)} />
            </Field>
            <Field label="Clinical Note" wide>
              <textarea rows={3} value={clinicalNote} onChange={(e) => setClinicalNote(e.target.value)} />
            </Field>
          </div>

          <Actions busy={busy} label="Create Order" cancel={() => setOrderModal(false)} submit={() => void createOrder()} />
        </Modal>
      )}

      {specimenModal && (
        <Modal title="Collect Specimen" onClose={() => setSpecimenModal(false)}>
          <div className="lab-form">
            <Field label="Specimen Type Code">
              <input value={specimenTypeCode} onChange={(e) => setSpecimenTypeCode(e.target.value)} />
            </Field>
            <Field label="Specimen Type Name">
              <input value={specimenTypeName} onChange={(e) => setSpecimenTypeName(e.target.value)} placeholder="e.g. EDTA whole blood" />
            </Field>
            <Field label="Collector" wide>
              <input value={collectorName} onChange={(e) => setCollectorName(e.target.value)} />
            </Field>
          </div>

          <div className="lab-note">
            Use the specimen code configured by your laboratory terminology/catalog.
          </div>

          <Actions busy={busy} label="Collect Specimen" cancel={() => setSpecimenModal(false)} submit={() => void collectSpecimen()} />
        </Modal>
      )}

      {resultModal && (
        <Modal title="Laboratory Result Entry" large onClose={() => setResultModal(false)}>
          <div className="lab-result-toolbar">
            <div>
              <strong>{selectedOrder?.testName}</strong>
              <span>
                Specimen: {specimens.find((s) => s.id === selectedSpecimenId)?.accessionNumber ?? 'Selected specimen'}
              </span>
            </div>

            {selectedOrder?.testCode?.toUpperCase() === 'CBC' && (
              <button
                className="lab-btn secondary"
                type="button"
                onClick={() => setRows(CBC_ANALYTES.map(([code, name]) => newRow(code, name)))}
              >
                Load CBC Parameters
              </button>
            )}
          </div>

          <div className="lab-entry-wrap">
            <table className="lab-entry">
              <thead>
                <tr>
                  <th>Code</th><th>Analyte</th><th>Result</th><th>Unit</th>
                  <th>Ref Low</th><th>Ref High</th><th>Crit Low</th><th>Crit High</th><th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.rowId}>
                    {(['testCode','testName','value','unit','referenceLow','referenceHigh','criticalLow','criticalHigh'] as const).map((field) => (
                      <td key={field}>
                        <input
                          type={['value','referenceLow','referenceHigh','criticalLow','criticalHigh'].includes(field) ? 'number' : 'text'}
                          step="any"
                          value={row[field]}
                          onChange={(e) => setRow(row.rowId, field, e.target.value)}
                        />
                      </td>
                    ))}
                    <td>
                      <button
                        className="lab-remove"
                        type="button"
                        onClick={() =>
                          setRows((current) => {
                            const next = current.filter((item) => item.rowId !== row.rowId);
                            return next.length ? next : [newRow()];
                          })
                        }
                      >
                        <X size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button className="lab-add-row" type="button" onClick={() => setRows((current) => [...current, newRow()])}>
            <Plus size={15} /> Add Result Row
          </button>

          <div className="lab-note">
            Reference and critical limits are entered explicitly for now. Later they should be populated from the validated lab test catalog.
          </div>

          <Actions busy={busy} label="Save Preliminary Results" cancel={() => setResultModal(false)} submit={() => void saveResults()} />
        </Modal>
      )}
    </div>
  );
}

function apiMessage(error: unknown, fallback: string) {
  const message = (error as { response?: { data?: { message?: string | { message?: string } } } }).response?.data?.message;
  return typeof message === 'string' ? message : message?.message ?? fallback;
}

function ResultsTable({ results }: { results: LabResult[] }) {
  return (
    <div className="lab-table-wrap">
      <table className="lab-table">
        <thead>
          <tr>
            <th>Test</th><th>Result</th><th>Reference</th>
            <th>Flag</th><th>Status</th><th>Performed</th>
          </tr>
        </thead>
        <tbody>
          {results.map((result) => (
            <tr key={result.id ?? `${result.testCode}-${result.performedAt}`} className={flagClass(result.interpretation)}>
              <td><strong>{result.testName}</strong><span>{result.testCode}</span></td>
              <td className="lab-value">{result.value ?? '—'} <small>{result.unit}</small></td>
              <td>{reference(result)}</td>
              <td><Flag value={result.interpretation} /></td>
              <td><Pill value={result.status} /></td>
              <td>{formatDateTime(result.performedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = 'normal',
}: {
  label: string;
  value: number;
  tone?: 'normal' | 'warning' | 'critical';
}) {
  return (
    <div className={`lab-stat ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Pill({ value }: { value?: string }) {
  const cls = String(value ?? 'unknown').toLowerCase().replaceAll(' ', '-');
  return <span className={`lab-pill ${cls}`}>{value ?? 'unknown'}</span>;
}

function Flag({ value }: { value: LabInterpretation }) {
  return <span className={`lab-flag ${flagClass(value)}`}>{value}</span>;
}

function Empty({
  icon,
  title,
}: {
  icon: ReactNode;
  title: string;
}) {
  return (
    <div className="lab-empty">
      {icon}
      <strong>{title}</strong>
    </div>
  );
}

function Field({
  label,
  children,
  wide = false,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <label className={wide ? 'lab-field wide' : 'lab-field'}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function Modal({
  title,
  children,
  onClose,
  large = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  large?: boolean;
}) {
  return (
    <div className="lab-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={large ? 'lab-modal large' : 'lab-modal'}>
        <header>
          <h3>{title}</h3>
          <button type="button" onClick={onClose}><X size={18} /></button>
        </header>
        <div className="lab-modal-body">{children}</div>
      </div>
    </div>
  );
}

function Actions({
  busy,
  label,
  cancel,
  submit,
}: {
  busy: boolean;
  label: string;
  cancel: () => void;
  submit: () => void;
}) {
  return (
    <div className="lab-actions">
      <button className="lab-btn secondary" type="button" onClick={cancel} disabled={busy}>Cancel</button>
      <button className="lab-btn primary" type="button" onClick={submit} disabled={busy}>
        {busy && <LoaderCircle className="lab-spin" size={15} />}
        {label}
      </button>
    </div>
  );
}

function flagClass(value?: string) {
  if (value === 'LL' || value === 'HH') return 'critical';
  if (value === 'L' || value === 'H') return 'abnormal';
  return 'normal';
}

function reference(result: LabResult) {
  if (result.referenceLow !== undefined && result.referenceHigh !== undefined) {
    return `${result.referenceLow} – ${result.referenceHigh} ${result.unit ?? ''}`.trim();
  }
  if (result.referenceLow !== undefined) return `≥ ${result.referenceLow} ${result.unit ?? ''}`.trim();
  if (result.referenceHigh !== undefined) return `≤ ${result.referenceHigh} ${result.unit ?? ''}`.trim();
  return '—';
}

function formatDate(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString();
}

function formatDateTime(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}
