import { Printer, X } from 'lucide-react';
import type { RadiologyOrder, RadiologyReport } from '../types/radiology';
import './FinalRadiologyReport.css';

interface Props {
  report: RadiologyReport;
  order?: RadiologyOrder;
  patientName?: string;
  mrn?: string;
  onClose: () => void;
}

const finalLike = (s?: string) => ['final', 'amended', 'corrected', 'appended'].includes(s ?? '');
const fmt = (v?: string) => v ? new Date(v).toLocaleString() : '-';

export default function FinalRadiologyReport({ report, order, patientName, mrn, onClose }: Props) {
  const printable = finalLike(report.status);
  return (
    <div className="final-rad-overlay" role="dialog" aria-modal="true">
      <div className="final-rad-shell">
        <header className="final-rad-toolbar no-print">
          <div><strong>Radiology Report</strong><span>{report.status.toUpperCase()}</span></div>
          <div className="final-rad-actions">
            {printable && <button type="button" onClick={() => window.print()}><Printer size={16}/> Print / PDF</button>}
            <button type="button" className="icon" onClick={onClose} aria-label="Close"><X size={18}/></button>
          </div>
        </header>

        <article className="final-rad-paper">
          <div className="final-rad-brand">
            <div><h1>RADIOLOGY REPORT</h1><p>Diagnostic Imaging Department</p></div>
            <div className={`final-rad-status ${printable ? 'verified' : 'preliminary'}`}>{printable ? 'VERIFIED' : 'PRELIMINARY'}</div>
          </div>

          <section className="final-rad-grid">
            <Info label="Patient" value={patientName ?? report.patientId ?? '-'} />
            <Info label="MRN" value={mrn ?? '-'} />
            <Info label="Exam" value={order?.examName ?? report.examName ?? '-'} />
            <Info label="Modality" value={order?.modality ?? report.modality ?? '-'} />
            <Info label="Order ID" value={report.orderId ?? order?.id ?? '-'} />
            <Info label="Reported" value={fmt(report.issuedAt ?? report.effectiveAt)} />
          </section>

          {order?.clinicalIndication && <ReportSection title="Clinical Indication" text={order.clinicalIndication}/>} 
          {order?.clinicalQuestion && <ReportSection title="Clinical Question" text={order.clinicalQuestion}/>} 
          <ReportSection title="Technique" text={report.technique}/>
          <ReportSection title="Comparison" text={report.comparison}/>
          <ReportSection title="Findings" text={report.findings}/>
          <ReportSection title="Impression" text={report.impression} emphasized/>
          <ReportSection title="Recommendations" text={report.recommendations}/>

          <footer className="final-rad-signature">
            <div><span>Radiologist</span><strong>{report.radiologistName ?? '-'}</strong></div>
            <div><span>Verified by</span><strong>{report.verifierName ?? '-'}</strong></div>
            <div><span>Verified at</span><strong>{fmt(report.verifiedAt)}</strong></div>
          </footer>
          {!printable && <div className="final-rad-watermark">PRELIMINARY</div>}
        </article>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) { return <div className="final-rad-info"><span>{label}</span><strong>{value}</strong></div>; }
function ReportSection({ title, text, emphasized = false }: { title: string; text?: string; emphasized?: boolean }) {
  return <section className={`final-rad-section ${emphasized ? 'emphasized' : ''}`}><h2>{title}</h2><p>{text?.trim() || 'Not documented.'}</p></section>;
}
