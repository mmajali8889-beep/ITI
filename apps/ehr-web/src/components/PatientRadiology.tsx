import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AlertCircle, CheckCircle2, ExternalLink, FileText, Image, Loader2, Search, ShieldCheck, Stethoscope } from 'lucide-react';
import axios from 'axios';
import { getPatientRadiologyOrders, getPatientRadiologyReports } from '../api/radiologyApi';
import { getPacsStudies, openPacsStudy, type PacsStudy } from '../api/radiologyPacsApi';
import type { RadiologyOrder, RadiologyReport } from '../types/radiology';
import FinalRadiologyReport from './FinalRadiologyReport';
import './PatientRadiology.css';

interface Props { patientId: string; patientName?: string; mrn?: string; }
type Filter = 'all' | 'active' | 'urgent' | 'final';
const finalLike = (s?: string) => ['final','amended','corrected','appended'].includes(s ?? '');
const fmt = (v?: string) => v ? new Date(v).toLocaleString() : '-';

function apiMessage(error: unknown) {
  if (axios.isAxiosError(error)) {
    const m = (error.response?.data as {message?: string|string[]} | undefined)?.message;
    if (Array.isArray(m)) return m.join(', '); if (m) return m;
  }
  return 'Unable to load radiology history.';
}

export default function PatientRadiology({ patientId, patientName, mrn }: Props) {
  const [orders,setOrders]=useState<RadiologyOrder[]>([]); const [reports,setReports]=useState<RadiologyReport[]>([]); const [pacsStudies,setPacsStudies]=useState<PacsStudy[]>([]);
  const [loading,setLoading]=useState(true); const [error,setError]=useState(''); const [query,setQuery]=useState('');
  const [filter,setFilter]=useState<Filter>('all'); const [selected,setSelected]=useState<RadiologyReport|null>(null);

  const load=useCallback(async()=>{setLoading(true);setError('');try{
    const [o,r,p]=await Promise.all([
      getPatientRadiologyOrders(patientId),
      getPatientRadiologyReports(patientId),
      getPacsStudies().catch(()=>({count:0,studies:[] as PacsStudy[]})),
    ]);
    setOrders(o.orders??[]);
    setReports(r.reports??[]);
    setPacsStudies((p.studies??[]).filter(s=>!s.patientId||s.patientId===patientId||s.patientId===mrn));
  }catch(e){setError(apiMessage(e));}finally{setLoading(false)}},[patientId,mrn]);
  useEffect(()=>{void load()},[load]);

  const reportByOrder=useMemo(()=>new Map(reports.filter(r=>r.orderId).map(r=>[r.orderId!,r])),[reports]);
  const finalCount=reports.filter(r=>finalLike(r.status)).length;
  const urgentCount=orders.filter(o=>o.priority==='stat'||o.priority==='asap'||o.priority==='urgent').length;
  const activeCount=orders.filter(o=>o.status==='active'||o.status==='on-hold').length;
  const visible=useMemo(()=>orders.filter(o=>{const r=reportByOrder.get(o.id);const text=[o.examName,o.examCode,o.modality,o.bodySiteName,o.clinicalIndication,r?.impression].filter(Boolean).join(' ').toLowerCase();if(query&&!text.includes(query.toLowerCase()))return false;if(filter==='active')return o.status==='active'||o.status==='on-hold';if(filter==='urgent')return ['stat','asap','urgent'].includes(o.priority);if(filter==='final')return finalLike(r?.status);return true}),[orders,reportByOrder,query,filter]);
  const selectedOrder=selected?.orderId?orders.find(o=>o.id===selected.orderId):undefined;
  const studyForOrder=useCallback((order:RadiologyOrder)=>{
    const accession=(order as RadiologyOrder & {accessionNumber?:string}).accessionNumber;
    return pacsStudies.find(s=>
      (accession&&s.accessionNumber===accession) ||
      (s.studyDescription&&order.examName&&s.studyDescription.toLowerCase().includes(order.examName.toLowerCase()))
    );
  },[pacsStudies]);

  if(loading)return <div className="prad-state"><Loader2 className="spin" size={20}/> Loading radiology history...</div>;
  return <div className="prad-root">
    <div className="prad-heading"><div><h2>Radiology</h2><p>Longitudinal imaging orders and diagnostic reports</p></div><button onClick={()=>void load()}>Refresh</button></div>
    {error&&<div className="prad-error"><AlertCircle size={17}/>{error}</div>}
    <div className="prad-stats"><Stat icon={<Image size={18}/>} label="Studies" value={orders.length}/><Stat icon={<Stethoscope size={18}/>} label="Active" value={activeCount}/><Stat icon={<AlertCircle size={18}/>} label="Urgent / STAT" value={urgentCount}/><Stat icon={<ShieldCheck size={18}/>} label="Final Reports" value={finalCount}/></div>
    <div className="prad-tools"><label><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search exam, modality, body site or impression..."/></label><div className="prad-filters">{(['all','active','urgent','final'] as Filter[]).map(f=><button key={f} className={filter===f?'active':''} onClick={()=>setFilter(f)}>{f==='all'?'All':f==='final'?'Final Reports':f[0].toUpperCase()+f.slice(1)}</button>)}</div></div>
    <div className="prad-list">{visible.length===0?<div className="prad-empty"><FileText size={28}/><strong>No radiology studies found</strong><span>No studies match the selected filters.</span></div>:visible.map(order=>{const report=reportByOrder.get(order.id);return <article className="prad-card" key={order.id}><div className="prad-modality">{order.modality}</div><div className="prad-main"><div className="prad-title"><h3>{order.examName}</h3><span className={`priority ${order.priority}`}>{order.priority.toUpperCase()}</span><span className={`status ${order.status}`}>{order.status.replaceAll('-',' ')}</span></div><div className="prad-meta"><span>{fmt(order.authoredOn)}</span>{order.bodySiteName&&<span>{order.bodySiteName}</span>}<span>Order: {order.id}</span></div>{order.clinicalIndication&&<p><b>Indication:</b> {order.clinicalIndication}</p>}{report?.impression&&<div className="prad-impression"><b>Impression</b><span>{report.impression}</span></div>}</div><div className="prad-report">{report?<><span className={`report-badge ${finalLike(report.status)?'final':'preliminary'}`}>{finalLike(report.status)?<CheckCircle2 size={14}/>:<FileText size={14}/>} {report.status}</span><button onClick={()=>setSelected(report)}>View Report</button></>:<span className="no-report">No report</span>}{(()=>{const study=studyForOrder(order);return study?.studyInstanceUid?<button onClick={()=>openPacsStudy(study)} title="Open DICOM images in OHIF"><ExternalLink size={14}/> View Images</button>:<span className="no-report">Awaiting Images</span>})()}</div></article>})}</div>
    {selected&&<FinalRadiologyReport report={selected} order={selectedOrder} patientName={patientName} mrn={mrn} onClose={()=>setSelected(null)}/>} 
  </div>;
}
function Stat({icon,label,value}:{icon:ReactNode;label:string;value:number}){return <div className="prad-stat"><div>{icon}</div><span>{label}</span><strong>{value}</strong></div>}
