import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Appointment, Communication, Composition, Condition, Coverage, DiagnosticReport, Encounter, Invoice, MedicationRequest, Patient, PaymentReconciliation } from '@medplum/fhirtypes';
import { MedplumService } from '../medplum/medplum.service';
const BASE='https://hospital-ehr.local/fhir/StructureDefinition';
const RELEASED=new Set(['final','amended','corrected','appended']);
@Injectable()
export class PatientPortalService{
 constructor(private readonly medplumService:MedplumService){}
 async get(patientId:string,hospitalId:string){
  if(!patientId||!hospitalId)throw new BadRequestException('Patient and hospital are required');
  let patient:Patient;try{patient=await this.medplumService.getClient().readResource('Patient',patientId)}catch{throw new NotFoundException('Patient portal not found')}
  const c=this.medplumService.getClient(),subject=`Patient/${patientId}`;
  const [encounters,appointments,reports,medications,conditions,documents,invoices,payments,coverages,notifications]=await Promise.all([
   c.searchResources('Encounter',{subject,_count:'500'}),c.searchResources('Appointment',{actor:subject,_count:'500'}),c.searchResources('DiagnosticReport',{subject,_count:'500'}),c.searchResources('MedicationRequest',{subject,_count:'500'}),c.searchResources('Condition',{subject,_count:'500'}),c.searchResources('Composition',{subject,_count:'500'}),c.searchResources('Invoice',{subject,_count:'500'}),c.searchResources('PaymentReconciliation',{_count:'500'}),c.searchResources('Coverage',{beneficiary:subject,_count:'200'}),c.searchResources('Communication',{recipient:subject,_count:'500'})]);
  const scopedEncounters=(encounters as Encounter[]).filter(e=>e.serviceProvider?.reference===`Organization/${hospitalId}`),encounterRefs=new Set(scopedEncounters.map(e=>`Encounter/${e.id}`));
  const scopedInvoices=(invoices as Invoice[]).filter(i=>this.hospital(i,hospitalId)),invoiceRefs=new Set(scopedInvoices.map(i=>`Invoice/${i.id}`));
  const finalReports=(reports as DiagnosticReport[]).filter(r=>RELEASED.has(r.status)&&(!r.encounter?.reference||encounterRefs.has(r.encounter.reference)));
  const lab=finalReports.filter(r=>this.category(r).includes('lab')),radiology=finalReports.filter(r=>this.category(r).includes('rad')||this.category(r).includes('imag'));
  const result={patient:{id:patient.id,name:patient.name?.[0]?.text??[patient.name?.[0]?.given?.join(' '),patient.name?.[0]?.family].filter(Boolean).join(' '),mrn:patient.identifier?.find(i=>i.system?.includes('/mrn/'))?.value,photo:patient.photo?.[0]?.data?`data:${patient.photo[0].contentType};base64,${patient.photo[0].data}`:undefined},
   appointments:(appointments as Appointment[]).filter(a=>this.hospital(a,hospitalId)&&a.status!=='entered-in-error').map(a=>({id:a.id,status:a.status,start:a.start,end:a.end,description:a.description,participants:a.participant.filter(p=>p.actor?.reference!==subject).map(p=>p.actor?.display).filter(Boolean)})),
   labResults:lab.map(r=>this.report(r)),radiologyReports:radiology.map(r=>this.report(r)),
   prescriptions:(medications as MedicationRequest[]).filter(m=>m.status!=='entered-in-error'&&(!m.encounter?.reference||encounterRefs.has(m.encounter.reference))).map(m=>({id:m.id,status:m.status,medication:m.medicationCodeableConcept?.text??m.medicationCodeableConcept?.coding?.[0]?.display,authoredOn:m.authoredOn,dosage:m.dosageInstruction?.map(d=>d.text).filter(Boolean)})),
   diagnoses:(conditions as Condition[]).filter(x=>!x.verificationStatus?.coding?.some(v=>v.code==='entered-in-error')&&(!x.encounter?.reference||encounterRefs.has(x.encounter.reference))).map(x=>({id:x.id,code:x.code?.coding?.[0]?.code,name:x.code?.text??x.code?.coding?.[0]?.display,system:x.code?.coding?.[0]?.system,recordedDate:x.recordedDate,clinicalStatus:x.clinicalStatus?.coding?.[0]?.code})),
   dischargeSummaries:(documents as Composition[]).filter(d=>['final','amended'].includes(d.status)&&this.hospital(d,hospitalId)&&d.type?.coding?.some(x=>x.code==='18842-5')).map(d=>this.document(d)),
   medicalReports:(documents as Composition[]).filter(d=>['final','amended'].includes(d.status)&&this.hospital(d,hospitalId)&&!d.type?.coding?.some(x=>x.code==='18842-5')).map(d=>this.document(d)),
   bills:scopedInvoices.map(i=>({id:i.id,number:i.identifier?.[0]?.value,status:i.status,date:i.date,total:i.totalGross,balance:i.extension?.find(e=>e.url===`${BASE}/invoice-balance`)?.valueMoney})),
   payments:(payments as PaymentReconciliation[]).filter(p=>this.hospital(p,hospitalId)&&p.extension?.some(e=>invoiceRefs.has(e.valueReference?.reference??''))).map(p=>({id:p.id,date:p.paymentDate,amount:p.paymentAmount,reference:p.paymentIdentifier?.value})),
   insurance:(coverages as Coverage[]).filter(x=>this.hospital(x,hospitalId)).map(x=>({id:x.id,status:x.status,payer:x.payor?.[0]?.display,memberNumber:x.subscriberId,plan:x.type?.text,validFrom:x.period?.start,validTo:x.period?.end})),
   notifications:(notifications as Communication[]).filter(n=>n.status!=='entered-in-error'&&this.hospital(n,hospitalId)).map(n=>({id:n.id,status:n.status,sent:n.sent,subject:n.topic?.text??n.category?.[0]?.text,message:n.payload?.map(p=>p.contentString).filter(Boolean).join('\n')}))};
  return{hospitalId,generatedAt:new Date().toISOString(),...result,counts:{appointments:result.appointments.length,labResults:result.labResults.length,radiologyReports:result.radiologyReports.length,prescriptions:result.prescriptions.length,notifications:result.notifications.length}};
 }
 private hospital(resource:{extension?:Array<{valueReference?:{reference?:string}}>},hospitalId:string){return resource.extension?.some(e=>e.valueReference?.reference===`Organization/${hospitalId}`)??false}
 private category(r:DiagnosticReport){return `${r.category?.flatMap(x=>x.coding?.map(v=>`${v.code} ${v.display}`)??[]).join(' ')} ${r.code?.text??''}`.toLowerCase()}
 private report(r:DiagnosticReport){return{id:r.id,status:r.status,title:r.code?.text??r.code?.coding?.[0]?.display,effectiveDate:r.effectiveDateTime??r.effectivePeriod?.end,issued:r.issued,conclusion:r.conclusion,results:r.result?.map(x=>({reference:x.reference,display:x.display}))}}
 private document(d:Composition){return{id:d.id,status:d.status,title:d.title,date:d.date,author:d.author?.map(a=>a.display).filter(Boolean),sections:d.section?.map(s=>({title:s.title,text:this.text(s.text?.div)}))}}
 private text(html?:string){return html?.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim()}
}
