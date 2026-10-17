import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Check, CheckCircle2, ClipboardCheck, ContactRound, FileSearch, FileSpreadsheet, HeartPulse, LoaderCircle, Printer, ShieldCheck, UserRoundPlus, UsersRound } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import { checkPatientDuplicates, createPatient } from '../api/patientApi';
import { useHospital } from '../context/HospitalContext';
import type { CreatePatientRequest, CreatePatientResponse, PatientDuplicateMatch } from '../types/patient';
import { exportPatientRegistration, printPatientRegistration } from '../utils/printExport';
import { transliterateArabicName } from '../utils/arabicTransliteration';
import './PatientRegistrationPage.css';

const steps = [
  { label: 'Identity', icon: FileSearch }, { label: 'Demographics', icon: UserRoundPlus },
  { label: 'Contact', icon: ContactRound }, { label: 'Review', icon: ClipboardCheck },
];
type Errors = Partial<Record<keyof CreatePatientRequest | 'form', string>>;
type Update = <K extends keyof CreatePatientRequest>(key: K, value: CreatePatientRequest[K]) => void;

export default function PatientRegistrationPage() {
  const navigate = useNavigate();
  const { hospitalId } = useParams<{ hospitalId: string }>();
  const { hospital } = useHospital();
  const [step, setStep] = useState(0), [saving, setSaving] = useState(false), [checking, setChecking] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [matches, setMatches] = useState<PatientDuplicateMatch[]>([]);
  const [created, setCreated] = useState<CreatePatientResponse>();
  const initial = useMemo<CreatePatientRequest>(() => ({
    hospitalId: hospital?.id ?? hospitalId ?? '', hospitalCode: hospital?.code ?? '', enterpriseMrn: '',
    nationalId: '', passportNumber: '', firstNameAr: '', middleNameAr: '', familyNameAr: '', firstNameEn: '', middleNameEn: '', familyNameEn: '',
    gender: 'unknown', birthDate: '', nationality: 'Jordanian', preferredLanguage: 'ar', maritalStatus: 'unknown',
    phone: '', email: '', addressLine: '', city: '', country: 'JO', nextOfKinName: '', nextOfKinRelationship: '', nextOfKinPhone: '', registrationConfirmed: false,
  }), [hospital, hospitalId]);
  const [form, setForm] = useState<CreatePatientRequest>(initial);

  const update: Update = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined, form: undefined }));
    if (['nationalId', 'passportNumber'].includes(key)) setMatches([]);
  };

  const updateArabicName = (
    arabicKey: 'firstNameAr' | 'middleNameAr' | 'familyNameAr',
    englishKey: 'firstNameEn' | 'middleNameEn' | 'familyNameEn',
    value: string,
  ) => {
    setForm((current) => ({
      ...current,
      [arabicKey]: value,
      [englishKey]: transliterateArabicName(value),
    }));
    setErrors((current) => ({
      ...current,
      [arabicKey]: undefined,
      [englishKey]: undefined,
      form: undefined,
    }));
  };

  function validate(index: number): Errors {
    const next: Errors = {};
    if (index === 0) {
      if (!form.nationalId?.trim() && !form.passportNumber?.trim()) next.nationalId = 'Enter a national ID or passport number.';
      if (form.nationalId && !/^\d{8,12}$/.test(form.nationalId.replace(/\s/g, ''))) next.nationalId = 'National ID must contain 8–12 digits.';
      if (form.passportNumber && !/^[A-Za-z0-9]{5,20}$/.test(form.passportNumber.trim())) next.passportNumber = 'Invalid passport format.';
    }
    if (index === 1) {
      const arabic = /^[\u0600-\u06FF\s'-]{2,80}$/;
      if (!arabic.test(form.firstNameAr.trim())) next.firstNameAr = 'Enter the official Arabic first name.';
      if (!arabic.test(form.familyNameAr.trim())) next.familyNameAr = 'Enter the official Arabic family name.';
      if (!form.birthDate) next.birthDate = 'Date of birth is required.';
      else if (new Date(`${form.birthDate}T00:00:00`) > new Date()) next.birthDate = 'Birth date cannot be in the future.';
      if (form.gender === 'unknown') next.gender = 'Select administrative gender.';
    }
    if (index === 2) {
      const phone = form.phone?.replace(/[\s()-]/g, '');
      if (phone && !/^\+?\d{8,15}$/.test(phone)) next.phone = 'Enter a valid telephone number.';
      if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) next.email = 'Enter a valid email address.';
      if (form.nextOfKinPhone && !/^\+?[0-9\s()-]{8,20}$/.test(form.nextOfKinPhone)) next.nextOfKinPhone = 'Enter a valid telephone number.';
      if (form.nextOfKinName && !form.nextOfKinRelationship) next.nextOfKinRelationship = 'Select the relationship.';
    }
    if (index === 3 && !form.registrationConfirmed) next.registrationConfirmed = 'Confirmation is required.';
    return next;
  }

  async function nextStep() {
    const invalid = validate(step); setErrors(invalid); if (Object.keys(invalid).length) return;
    if (step === 0) {
      setChecking(true);
      try {
        const result = await checkPatientDuplicates({ hospitalId: hospital?.id ?? '', hospitalCode: hospital?.code ?? '', nationalId: form.nationalId, passportNumber: form.passportNumber });
        setMatches(result.matches); if (result.blocking) return;
      } catch { setErrors({ form: 'Unable to complete the duplicate check. Please try again.' }); return; }
      finally { setChecking(false); }
    }
    setStep((value) => Math.min(value + 1, 3));
  }

  async function submit(event: FormEvent) {
    event.preventDefault(); const invalid = validate(3); setErrors(invalid); if (Object.keys(invalid).length || !hospital) return;
    setSaving(true);
    try { const result = await createPatient({ ...form, hospitalId: hospital.id, hospitalCode: hospital.code }); setCreated(result); }
    catch (error) {
      const data = axios.isAxiosError(error) ? error.response?.data as { message?: string; matches?: PatientDuplicateMatch[] } : undefined;
      if (data?.matches) setMatches(data.matches); setErrors({ form: data?.message ?? 'Patient registration failed. No record was created.' });
    } finally { setSaving(false); }
  }

  if (!hospital || hospital.id !== hospitalId) return <main className="registration-shell"><div className="registration-alert danger">The selected hospital does not match this registration workspace.</div></main>;
  if (created) return <main className="registration-shell"><section className="registration-success"><span><CheckCircle2 size={42} /></span><p className="registration-kicker">Registration complete</p><h1>Patient record created successfully</h1><p>The record is securely scoped to <strong>{hospital.name}</strong>. Print or export the verified registration summary.</p><div className="success-reference"><small>Hospital MRN</small><strong>{created.hospitalMrn??created.id}</strong></div><div className="registration-actions center"><button className="button secondary" onClick={()=>printPatientRegistration(created,form,hospital.name)}><Printer size={16}/> Print patient summary</button><button className="button secondary" onClick={()=>exportPatientRegistration(created,form)}><FileSpreadsheet size={16}/> Export to Excel</button><button className="button primary" onClick={() => navigate(`/hospital/${hospital.id}/patient/${created.id}`)}>Open patient chart <ArrowRight size={16} /></button></div></section></main>;

  return <main className="registration-shell">
    <header className="registration-header"><div className="registration-title"><span><UserRoundPlus size={25} /></span><div><p className="registration-kicker">Patient administration · {hospital.code}</p><h1>New patient registration</h1><p>Create a verified, hospital-scoped FHIR patient record.</p></div></div><div className="secure-badge"><ShieldCheck size={16} /><span>Secure workflow<strong>{hospital.name}</strong></span></div></header>
    <nav className="registration-stepper" aria-label="Registration progress">{steps.map((item, index) => { const Icon = item.icon; return <div className={`registration-step ${index === step ? 'active' : ''} ${index < step ? 'complete' : ''}`} key={item.label}><span>{index < step ? <Check size={17} /> : <Icon size={17} />}</span><div><small>Step {index + 1}</small><strong>{item.label}</strong></div></div>; })}</nav>
    <form className="registration-workspace" onSubmit={submit} noValidate>
      <section className="registration-form-card">{errors.form && <div className="registration-alert danger">{errors.form}</div>}{matches.length > 0 && <DuplicateAlert matches={matches} onOpen={(id) => navigate(`/hospital/${hospital.id}/patient/${id}`)} />}{step === 0 && <IdentityStep form={form} errors={errors} update={update} />}{step === 1 && <DemographicsStep form={form} errors={errors} update={update} updateArabicName={updateArabicName} />}{step === 2 && <ContactStep form={form} errors={errors} update={update} />}{step === 3 && <ReviewStep form={form} hospitalName={hospital.name} error={errors.registrationConfirmed} update={update} />}</section>
      <aside className="registration-side-card"><div className="side-icon"><HeartPulse size={20} /></div><p className="registration-kicker">Registration safety</p><h2>One patient, one identity</h2><ul><li><Check size={14} />Authoritative identifiers checked</li><li><Check size={14} />Hospital boundary enforced</li><li><Check size={14} />FHIR R4 patient structure</li></ul><div className="completion"><span><strong>{Math.round(((step + 1) / 4) * 100)}%</strong> complete</span><div><i style={{ width: `${((step + 1) / 4) * 100}%` }} /></div></div></aside>
      <footer className="registration-footer"><button type="button" className="button ghost" onClick={() => step ? setStep(step - 1) : navigate(`/hospital/${hospital.id}/dashboard`)}><ArrowLeft size={16} />{step ? 'Previous' : 'Cancel'}</button>{step < 3 ? <button type="button" className="button primary" onClick={() => void nextStep()} disabled={checking}>{checking && <LoaderCircle className="spin" size={16} />}{checking ? 'Checking identity…' : 'Continue'}<ArrowRight size={16} /></button> : <button type="submit" className="button primary" disabled={saving}>{saving ? <LoaderCircle className="spin" size={16} /> : <ShieldCheck size={16} />}{saving ? 'Creating record…' : 'Confirm & register'}</button>}</footer>
    </form>
  </main>;
}

function IdentityStep({ form, errors, update }: { form: CreatePatientRequest; errors: Errors; update: Update }) { return <Step title="Verify patient identity" description="Identifiers are checked before clinical data is collected."><Grid><Field label="Hospital MRN" required hint="Generated automatically in strict sequence when registration is completed"><input value={`${form.hospitalCode}-######`} readOnly aria-readonly="true" className="readonly" /></Field><Field label="Enterprise MRN" hint="Optional cross-facility identifier"><input value={form.enterpriseMrn} onChange={(e) => update('enterpriseMrn', e.target.value.toUpperCase())} placeholder="E00000001" autoFocus /></Field><Field label="National ID" error={errors.nationalId}><input inputMode="numeric" value={form.nationalId} onChange={(e) => update('nationalId', e.target.value)} /></Field><Field label="Passport number" error={errors.passportNumber}><input value={form.passportNumber} onChange={(e) => update('passportNumber', e.target.value.toUpperCase())} /></Field></Grid><div className="registration-note"><ShieldCheck size={17} /><span><strong>Duplicate prevention:</strong> identifiers are matched against existing records before continuing.</span></div></Step>; }
function DemographicsStep({ form, errors, update, updateArabicName }: { form: CreatePatientRequest; errors: Errors; update: Update; updateArabicName: (arabicKey: 'firstNameAr' | 'middleNameAr' | 'familyNameAr', englishKey: 'firstNameEn' | 'middleNameEn' | 'familyNameEn', value: string) => void }) { return <Step title="Demographics and official names" description="Enter information exactly as it appears on the official document."><Sub>Official Arabic name</Sub><Grid columns={3}><Field label="First name" required error={errors.firstNameAr}><input dir="rtl" value={form.firstNameAr} onChange={(e) => updateArabicName('firstNameAr', 'firstNameEn', e.target.value)} /></Field><Field label="Middle name"><input dir="rtl" value={form.middleNameAr} onChange={(e) => updateArabicName('middleNameAr', 'middleNameEn', e.target.value)} /></Field><Field label="Family name" required error={errors.familyNameAr}><input dir="rtl" value={form.familyNameAr} onChange={(e) => updateArabicName('familyNameAr', 'familyNameEn', e.target.value)} /></Field></Grid><Sub>English name</Sub><Grid columns={3}><Field label="First name" hint="Generated from the Arabic name; editable"><input value={form.firstNameEn} onChange={(e) => update('firstNameEn', e.target.value)} /></Field><Field label="Middle name" hint="Generated from the Arabic name; editable"><input value={form.middleNameEn} onChange={(e) => update('middleNameEn', e.target.value)} /></Field><Field label="Family name" hint="Generated from the Arabic name; editable"><input value={form.familyNameEn} onChange={(e) => update('familyNameEn', e.target.value)} /></Field></Grid><Sub>Demographic details</Sub><Grid columns={3}><Field label="Administrative gender" required error={errors.gender}><select value={form.gender} onChange={(e) => update('gender', e.target.value as CreatePatientRequest['gender'])}><option value="unknown">Select gender</option><option value="male">Male</option><option value="female">Female</option><option value="other">Other</option></select></Field><Field label="Date of birth" required error={errors.birthDate}><input type="date" max={new Date().toISOString().slice(0, 10)} value={form.birthDate} onChange={(e) => update('birthDate', e.target.value)} /></Field><Field label="Nationality"><input value={form.nationality} onChange={(e) => update('nationality', e.target.value)} /></Field><Field label="Marital status"><select value={form.maritalStatus} onChange={(e) => update('maritalStatus', e.target.value as CreatePatientRequest['maritalStatus'])}><option value="unknown">Not recorded</option><option value="single">Single</option><option value="married">Married</option><option value="divorced">Divorced</option><option value="widowed">Widowed</option></select></Field><Field label="Preferred language"><select value={form.preferredLanguage} onChange={(e) => update('preferredLanguage', e.target.value as 'ar' | 'en')}><option value="ar">Arabic</option><option value="en">English</option></select></Field></Grid></Step>; }
function ContactStep({ form, errors, update }: { form: CreatePatientRequest; errors: Errors; update: Update }) { return <Step title="Contact and next of kin" description="Capture reliable communication and emergency contact information."><Sub>Patient contact</Sub><Grid><Field label="Mobile number" error={errors.phone}><input type="tel" value={form.phone} onChange={(e) => update('phone', e.target.value)} placeholder="+962 7X XXX XXXX" /></Field><Field label="Email" error={errors.email}><input type="email" value={form.email} onChange={(e) => update('email', e.target.value)} /></Field><Field label="City"><input value={form.city} onChange={(e) => update('city', e.target.value)} /></Field><Field label="Country"><input value={form.country} onChange={(e) => update('country', e.target.value.toUpperCase())} maxLength={2} /></Field><Field label="Address" wide><input value={form.addressLine} onChange={(e) => update('addressLine', e.target.value)} /></Field></Grid><Sub>Next of kin / emergency contact</Sub><Grid columns={3}><Field label="Full name"><input value={form.nextOfKinName} onChange={(e) => update('nextOfKinName', e.target.value)} /></Field><Field label="Relationship" error={errors.nextOfKinRelationship}><select value={form.nextOfKinRelationship} onChange={(e) => update('nextOfKinRelationship', e.target.value)}><option value="">Select relationship</option>{['Father','Mother','Spouse','Brother','Sister','Son','Daughter','Other'].map((v) => <option key={v}>{v}</option>)}</select></Field><Field label="Phone" error={errors.nextOfKinPhone}><input type="tel" value={form.nextOfKinPhone} onChange={(e) => update('nextOfKinPhone', e.target.value)} /></Field></Grid></Step>; }
function ReviewStep({ form, hospitalName, error, update }: { form: CreatePatientRequest; hospitalName: string; error?: string; update: Update }) { const rows = [['Patient', `${form.firstNameAr} ${form.middleNameAr ?? ''} ${form.familyNameAr}`],['Hospital', hospitalName],['Hospital MRN', 'Assigned automatically on registration'],['Government ID', form.nationalId || form.passportNumber || '—'],['Date of birth', form.birthDate],['Gender', form.gender],['Mobile', form.phone || 'Not recorded'],['Next of kin', form.nextOfKinName || 'Not recorded']]; return <Step title="Review and confirm" description="Verify the identity and demographic record before final submission."><div className="review-grid">{rows.map(([label,value]) => <div key={label}><small>{label}</small><strong>{value}</strong></div>)}</div><label className={`confirmation ${error ? 'invalid' : ''}`}><input type="checkbox" checked={form.registrationConfirmed} onChange={(e) => update('registrationConfirmed', e.target.checked)} /><span><strong>I confirm this record was verified against the presented identity information.</strong><small>This creates a permanent clinical identity in {hospitalName}.</small>{error && <em>{error}</em>}</span></label></Step>; }
function DuplicateAlert({ matches, onOpen }: { matches: PatientDuplicateMatch[]; onOpen: (id: string) => void }) { return <div className="duplicate-alert"><UsersRound size={21} /><div><strong>Possible existing patient found</strong><p>Registration is paused to prevent a duplicate clinical identity.</p>{matches.map((match) => <button type="button" key={match.id} onClick={() => onOpen(match.id)}>{match.name ?? 'Existing patient'} · {match.matchedBy.join(', ')} <ArrowRight size={13} /></button>)}</div></div>; }
function Step({ title, description, children }: { title: string; description: string; children: ReactNode }) { return <div className="step-content"><div className="step-heading"><p className="registration-kicker">Required information</p><h2>{title}</h2><p>{description}</p></div>{children}</div>; }
function Sub({ children }: { children: ReactNode }) { return <h3 className="form-subheading">{children}</h3>; }
function Grid({ children, columns = 2 }: { children: ReactNode; columns?: number }) { return <div className={`registration-grid columns-${columns}`}>{children}</div>; }
function Field({ label, required, hint, error, wide, children }: { label: string; required?: boolean; hint?: string; error?: string; wide?: boolean; children: ReactNode }) { return <label className={`registration-field ${wide ? 'wide' : ''} ${error ? 'invalid' : ''}`}><span>{label}{required && <b>*</b>}</span>{children}{(error || hint) && <small>{error ?? hint}</small>}</label>; }
