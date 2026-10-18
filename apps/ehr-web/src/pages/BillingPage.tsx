import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import {
  BadgeDollarSign,
  CreditCard,
  FileCheck2,
  FileText,
  Landmark,
  ListOrdered,
  Loader2,
  Plus,
  ReceiptText,
  Search,
  ShieldCheck,
  UserRound,
  X,
} from 'lucide-react';
import {
  adjudicateClaim,
  captureCharges,
  createInvoice,
  createTariff,
  getPatientAccount,
  getPatientCoverages,
  getTariffs,
  recordPayment,
  submitClaim,
  type Coverage,
  type PatientAccount,
  type Tariff,
} from '../api/billingApi';
import { getPatient, searchPatients, type PatientSearchResult } from '../api/patientApi';
import { getPatientEncounters } from '../api/encounterApi';
import type { EncounterResponse } from '../types/encounter';
import { HOSPITAL_CURRENCY } from '../utils/currency';
import './BillingPage.css';

type Action = 'capture' | 'tariff' | 'invoice' | 'payment' | 'claim' | 'adjudicate';
type SelectedPatient = Pick<PatientSearchResult, 'id' | 'nameAr' | 'nameEn' | 'hospitalMrn' | 'nationalId'>;

const ACTIONS: Array<{ key: Exclude<Action, 'tariff'>; label: string }> = [
  { key: 'capture', label: 'Capture charges' },
  { key: 'invoice', label: 'Create invoice' },
  { key: 'payment', label: 'Record payment' },
  { key: 'claim', label: 'Submit claim' },
  { key: 'adjudicate', label: 'Record claim result' },
];
const CATEGORIES = ['consultation', 'laboratory', 'radiology', 'medication', 'room-bed', 'surgery', 'consumable', 'procedure'];

function errorMessage(error: unknown, fallback: string): string {
  const message = (error as { response?: { data?: { message?: string | string[] } } }).response?.data?.message;
  return Array.isArray(message) ? message.join(', ') : message || fallback;
}

const patientName = (p: SelectedPatient) => p.nameEn || p.nameAr || p.id;

function encounterLabel(e: EncounterResponse): string {
  const date = e.startDateTime ? new Date(e.startDateTime).toLocaleDateString() : '';
  return [e.visitNumber, e.encounterTypeDisplay ?? e.encounterType, date, e.status].filter(Boolean).join(' · ');
}

export default function BillingPage() {
  const { hospitalId } = useParams<{ hospitalId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PatientSearchResult[]>();
  const [patient, setPatient] = useState<SelectedPatient>();
  const [account, setAccount] = useState<PatientAccount>();
  const [encounters, setEncounters] = useState<EncounterResponse[]>([]);
  const [coverages, setCoverages] = useState<Coverage[]>([]);
  const [tariffs, setTariffs] = useState<Tariff[]>();
  const [action, setAction] = useState<Action>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function loadPatient(selected: SelectedPatient) {
    if (!hospitalId) return;
    setPatient(selected);
    setResults(undefined);
    setBusy(true);
    try {
      const [acc, enc, cov] = await Promise.all([
        getPatientAccount(selected.id, hospitalId),
        getPatientEncounters(selected.id, hospitalId).catch(() => ({ total: 0, encounters: [] })),
        getPatientCoverages(selected.id, hospitalId).catch(() => ({ total: 0, coverages: [] })),
      ]);
      setAccount(acc);
      setEncounters(enc.encounters ?? []);
      setCoverages(cov.coverages ?? []);
      setError('');
    } catch (err) {
      setError(errorMessage(err, 'Unable to load the patient account'));
    } finally {
      setBusy(false);
    }
  }

  // Opened from a patient's file: /billing?patientId=...
  useEffect(() => {
    const id = searchParams.get('patientId');
    if (!id || !hospitalId || patient?.id === id) return;
    getPatient(id, hospitalId)
      .then(p => void loadPatient(p))
      .catch(err => setError(errorMessage(err, 'Patient not found')));
  }, [hospitalId, searchParams]);

  async function search(event: FormEvent) {
    event.preventDefault();
    if (!hospitalId || !query.trim()) return;
    setBusy(true);
    try {
      const found = await searchPatients({ hospitalId, search: query.trim() });
      setResults(found.patients);
      setError(found.patients.length ? '' : 'No patient found');
    } catch (err) {
      setError(errorMessage(err, 'Patient search failed'));
    } finally {
      setBusy(false);
    }
  }

  function choose(p: PatientSearchResult) {
    setSearchParams({ patientId: p.id });
    void loadPatient(p);
  }

  function clearPatient() {
    setPatient(undefined);
    setAccount(undefined);
    setEncounters([]);
    setCoverages([]);
    setSearchParams({});
  }

  async function showTariffs() {
    if (!hospitalId) return;
    if (tariffs) {
      setTariffs(undefined);
      return;
    }
    try {
      setTariffs((await getTariffs(hospitalId)).items);
    } catch (err) {
      setError(errorMessage(err, 'Unable to load the price list'));
    }
  }

  return (
    <main className="billing-page">
      <section className="billing-hero">
        <div>
          <span>REVENUE CYCLE MANAGEMENT</span>
          <h1><BadgeDollarSign />Billing & Patient Accounts</h1>
          <p>Charge capture, invoices, receipts, claims and payer reconciliation.</p>
        </div>
        <div className="billing-hero-actions">
          <button onClick={() => void showTariffs()}><ListOrdered />{tariffs ? 'Hide price list' : 'Price list'}</button>
          <button onClick={() => setAction('tariff')}><Plus />Tariff</button>
        </div>
      </section>

      {tariffs && (
        <section className="tariff-list">
          <header><strong>Price list</strong><span>{tariffs.length} items</span></header>
          {tariffs.length === 0 ? <p>No tariffs yet. Add them with "Tariff".</p> : (
            <table>
              <thead><tr><th>Code</th><th>Description</th><th>Category</th><th>Price</th></tr></thead>
              <tbody>
                {tariffs.map(t => (
                  <tr key={t.id}><td>{t.code}</td><td>{t.description}</td><td>{t.category}</td><td>{t.unitPrice} {t.currency}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {patient ? (
        <section className="billing-patient">
          <UserRound />
          <div>
            <b>{patientName(patient)}</b>
            <small>{[patient.nameAr && patient.nameEn ? patient.nameAr : '', patient.hospitalMrn && `MRN ${patient.hospitalMrn}`, patient.nationalId && `ID ${patient.nationalId}`].filter(Boolean).join(' · ')}</small>
          </div>
          <button type="button" onClick={clearPatient}><X />Change patient</button>
        </section>
      ) : (
        <form className="account-search" onSubmit={search}>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search patient by name, MRN, national ID or phone" />
          <button type="submit" disabled={busy}>{busy ? <Loader2 className="spin" /> : <Search />}Find patient</button>
        </form>
      )}

      {!patient && results && results.length > 0 && (
        <section className="billing-results">
          {results.map(p => (
            <button type="button" key={p.id} onClick={() => choose(p)}>
              <b>{p.nameEn || p.nameAr}</b>
              <small>{[p.nameEn && p.nameAr, p.hospitalMrn && `MRN ${p.hospitalMrn}`, p.nationalId && `ID ${p.nationalId}`, p.birthDate].filter(Boolean).join(' · ')}</small>
            </button>
          ))}
        </section>
      )}

      {error && <p className="billing-error">{error}</p>}
      {busy && patient && !account && <p className="billing-muted"><Loader2 className="spin" /> Loading account…</p>}

      {account && patient && (
        <>
          <section className="billing-stats">
            <Stat icon={<ReceiptText />} label="Captured charges" value={account.summary.charges} />
            <Stat icon={<FileText />} label="Invoiced" value={account.summary.invoiced} />
            <Stat icon={<CreditCard />} label="Paid" value={account.summary.paid} />
            <Stat icon={<Landmark />} label="Balance" value={account.summary.balance} />
            <Stat icon={<ShieldCheck />} label="Active claims" value={account.summary.activeClaims} unit="" />
          </section>
          <nav className="billing-actions">
            {ACTIONS.map(a => <button onClick={() => setAction(a.key)} key={a.key}>{a.label}</button>)}
          </nav>
          <section className="account-grid">
            <article>
              <header><strong>Charge ledger</strong><span>{account.charges.length}</span></header>
              {account.charges.map(c => (
                <div key={c.id}>
                  <span><b>{c.description}</b><small>{c.status} · {c.quantity} × {c.unitPrice}</small></span>
                  <strong>{c.total}</strong>
                </div>
              ))}
            </article>
            <article>
              <header><strong>Invoices</strong><span>{account.invoices.length}</span></header>
              {account.invoices.map(i => (
                <div key={i.id}>
                  <span><b>{i.identifier}</b><small>{i.status} · paid {i.paid}</small></span>
                  <strong>{i.balance} {i.currency}</strong>
                </div>
              ))}
            </article>
            <article>
              <header><strong>Insurance claims</strong><span>{account.claims.length}</span></header>
              {account.claims.map(c => (
                <div key={c.id}>
                  <span><b>{c.identifier}</b><small>{c.status} · payer {c.payerId}</small></span>
                  <strong>{c.amount}</strong>
                </div>
              ))}
            </article>
            <article>
              <header><strong>Receipts / reconciliation</strong><span>{account.payments.length}</span></header>
              {account.payments.map(p => (
                <div key={p.id}>
                  <span><b>{p.reference}</b><small>{p.method} · {new Date(p.date).toLocaleDateString()}</small></span>
                  <strong>{p.amount.value} {p.amount.currency}</strong>
                </div>
              ))}
            </article>
          </section>
        </>
      )}

      {action && hospitalId && (action === 'tariff' || (patient && account)) && (
        <BillingDialog
          action={action}
          hospitalId={hospitalId}
          patientId={patient?.id ?? ''}
          account={account}
          encounters={encounters}
          coverages={coverages}
          close={() => setAction(undefined)}
          saved={async () => {
            setAction(undefined);
            if (action === 'tariff' && tariffs) setTariffs((await getTariffs(hospitalId)).items);
            if (patient) await loadPatient(patient);
          }}
        />
      )}
    </main>
  );
}

function BillingDialog({
  action,
  hospitalId,
  patientId,
  account,
  encounters,
  coverages,
  close,
  saved,
}: {
  action: Action;
  hospitalId: string;
  patientId: string;
  account?: PatientAccount;
  encounters: EncounterResponse[];
  coverages: Coverage[];
  close: () => void;
  saved: () => Promise<void>;
}) {
  const openInvoices = account?.invoices.filter(i => i.balance > 0) ?? [];
  const activeCoverages = coverages.filter(c => c.status === 'active');
  const [f, setF] = useState({
    encounterId: encounters[0]?.id ?? '',
    category: 'consultation',
    code: '',
    description: '',
    unitPrice: '',
    invoiceId: (action === 'claim' ? account?.invoices[0] : openInvoices[0])?.id ?? '',
    amount: String(openInvoices[0]?.balance ?? ''),
    method: 'cash',
    reference: '',
    coverageId: activeCoverages[0]?.id ?? '',
    authorizationNumber: '',
    claimId: account?.claims[0]?.id ?? '',
    outcome: 'complete',
    approvedAmount: String(account?.claims[0]?.amount ?? ''),
    denialReason: '',
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const set = (key: keyof typeof f, value: string) => setF(current => ({ ...current, [key]: value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      if (action === 'capture') {
        const result = await captureCharges(f.encounterId, hospitalId);
        if (result?.skipped?.length) {
          setMessage(`${result.captured.length} charges captured; ${result.skipped.length} skipped (no tariff for them in the price list).`);
          return;
        }
      }
      if (action === 'tariff')
        await createTariff({ hospitalId, category: f.category, code: f.code.trim(), description: f.description.trim(), unitPrice: Number(f.unitPrice), currency: HOSPITAL_CURRENCY });
      if (action === 'invoice') await createInvoice({ hospitalId, patientId, encounterId: f.encounterId });
      if (action === 'payment')
        await recordPayment(f.invoiceId, { hospitalId, amount: Number(f.amount), method: f.method, reference: f.reference.trim() });
      if (action === 'claim') {
        const invoice = account?.invoices.find(i => i.id === f.invoiceId);
        const coverage = coverages.find(c => c.id === f.coverageId);
        await submitClaim({
          hospitalId,
          patientId,
          encounterId: invoice?.encounterId,
          invoiceId: f.invoiceId,
          coverageId: f.coverageId,
          payerId: coverage?.payerId,
          authorizationNumber: f.authorizationNumber.trim() || undefined,
        });
      }
      if (action === 'adjudicate')
        await adjudicateClaim(f.claimId, {
          hospitalId,
          outcome: f.outcome,
          approvedAmount: Number(f.approvedAmount),
          denialReason: f.outcome === 'complete' ? undefined : f.denialReason.trim(),
          adjudicationReference: f.reference.trim(),
        });
      await saved();
    } catch (err) {
      setMessage(errorMessage(err, 'Billing operation failed'));
    } finally {
      setSaving(false);
    }
  }

  const input = (key: keyof typeof f, label: string, type = 'text', required = true) => (
    <label>{label}<input required={required} value={f[key]} type={type} min={type === 'number' ? 0 : undefined} step={type === 'number' ? '0.01' : undefined} onChange={e => set(key, e.target.value)} /></label>
  );
  const select = (key: keyof typeof f, label: string, options: Array<[string, string]>, empty: string) => (
    <label>{label}
      {options.length ? (
        <select required value={f[key]} onChange={e => set(key, e.target.value)}>
          {options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
        </select>
      ) : <span className="billing-empty">{empty}</span>}
    </label>
  );
  const encounterOptions: Array<[string, string]> = encounters.map(e => [e.id, encounterLabel(e)]);
  const title = action === 'tariff' ? 'Add tariff' : ACTIONS.find(a => a.key === action)?.label;
  const missing =
    (['capture', 'invoice'].includes(action) && !encounters.length) ||
    (action === 'payment' && !openInvoices.length) ||
    (action === 'claim' && (!account?.invoices.length || !activeCoverages.length)) ||
    (action === 'adjudicate' && !account?.claims.length);

  return (
    <div className="billing-dialog">
      <form onSubmit={submit}>
        <header><h2>{title}</h2><button type="button" onClick={close}>×</button></header>
        {message && <p className="billing-dialog-message">{message}</p>}
        {['capture', 'invoice'].includes(action) && select('encounterId', 'Visit', encounterOptions, 'This patient has no visits.')}
        {action === 'tariff' && (
          <>
            {select('category', 'Billable category', CATEGORIES.map(c => [c, c]), '')}
            {input('code', 'Tariff code')}
            {input('description', 'Description')}
            {input('unitPrice', `Unit price (${HOSPITAL_CURRENCY})`, 'number')}
          </>
        )}
        {action === 'payment' && (
          <>
            {select('invoiceId', 'Invoice', openInvoices.map(i => [i.id, `${i.identifier} · balance ${i.balance} ${i.currency}`]), 'No invoice with a balance.')}
            {input('amount', 'Amount', 'number')}
            {select('method', 'Payment method', [['cash', 'Cash'], ['card', 'Card'], ['bank-transfer', 'Bank transfer'], ['insurance', 'Insurance']], '')}
            {input('reference', 'Receipt / payment reference')}
          </>
        )}
        {action === 'claim' && (
          <>
            {select('invoiceId', 'Invoice', (account?.invoices ?? []).map(i => [i.id, `${i.identifier} · ${i.total} ${i.currency}`]), 'Create an invoice first.')}
            {select('coverageId', 'Insurance coverage', activeCoverages.map(c => [c.id, `${c.payerName ?? c.payerId} · ${c.planName ?? ''} · member ${c.subscriberId ?? ''}`]), 'This patient has no active coverage (add it at reception).')}
            {input('authorizationNumber', 'Pre-authorization number (if any)', 'text', false)}
          </>
        )}
        {action === 'adjudicate' && (
          <>
            {select('claimId', 'Claim', (account?.claims ?? []).map(c => [c.id, `${c.identifier} · ${c.status} · ${c.amount}`]), 'No claims for this patient.')}
            {select('outcome', 'Payer decision', [['complete', 'Accepted'], ['partial', 'Partially accepted'], ['error', 'Rejected']], '')}
            {input('approvedAmount', 'Approved amount', 'number')}
            {input('reference', 'Payer reference')}
            {f.outcome !== 'complete' && input('denialReason', 'Reason for rejection or reduction')}
          </>
        )}
        <footer>
          <button type="button" onClick={close}>Cancel</button>
          <button className="primary" disabled={saving || missing}>{saving ? <Loader2 className="spin" /> : <FileCheck2 />}Save</button>
        </footer>
      </form>
    </div>
  );
}

function Stat({ icon, label, value, unit = HOSPITAL_CURRENCY }: { icon: ReactNode; label: string; value: number; unit?: string }) {
  return (
    <article>
      <span>{icon}</span>
      <div><b>{value.toLocaleString()}{unit && ` ${unit}`}</b><small>{label}</small></div>
    </article>
  );
}
