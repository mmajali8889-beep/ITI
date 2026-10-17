import { useState, type FormEvent } from 'react';
import { CheckCircle2, LogOut, ShieldCheck, X } from 'lucide-react';
import type { DischargeCondition, DispositionType, FinishEncounterRequest } from '../types/encounter';
import './DispositionModal.css';

export default function DispositionModal({ open, hospitalId, saving, error, onClose, onSubmit }: {
  open: boolean; hospitalId: string; saving: boolean; error?: string; onClose: () => void;
  onSubmit: (payload: FinishEncounterRequest) => void;
}) {
  const [disposition, setDisposition] = useState<DispositionType>('home');
  const [condition, setCondition] = useState<DischargeCondition>('stable');
  const [instructions, setInstructions] = useState('');
  const [followUpDate, setFollowUpDate] = useState('');
  const [destination, setDestination] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [localError, setLocalError] = useState('');
  if (!open) return null;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!['admit', 'icu', 'operating-room', 'deceased', 'left-without-being-seen'].includes(disposition) && instructions.trim().length < 10) return setLocalError('Enter clear discharge instructions of at least 10 characters.');
    if (['transfer', 'referred'].includes(disposition) && !destination.trim()) return setLocalError('Enter the referral or transfer destination.');
    if (!confirmed) return setLocalError('Confirm the disposition checklist.');
    setLocalError('');
    onSubmit({ hospitalId, disposition, dischargeCondition: condition, dischargeInstructions: instructions.trim() || undefined,
      followUpDate: followUpDate || undefined, referralDestination: destination.trim() || undefined, confirmation: true });
  }

  return <div className="disposition-overlay"><section className="disposition-modal">
    <header><span><LogOut size={22} /></span><div><small>Clinical disposition</small><h2>Finish encounter safely</h2><p>Complete the discharge record and verify clinical readiness.</p></div><button type="button" onClick={onClose}><X size={18} /></button></header>
    <form onSubmit={submit}><div className="disposition-body">
      {(localError || error) && <div className="disposition-error">{localError || error}</div>}
      <div className="disposition-grid"><label><span>Disposition *</span><select value={disposition} onChange={(e) => setDisposition(e.target.value as DispositionType)}><option value="home">Discharge home</option><option value="admit">Admit to hospital</option><option value="icu">Admit to ICU</option><option value="operating-room">Transfer to operating room</option><option value="transfer">Transfer facility</option><option value="referred">External referral</option><option value="left-against-advice">Left against medical advice</option><option value="left-without-being-seen">Left without being seen</option><option value="deceased">Deceased</option></select></label><label><span>Patient condition *</span><select value={condition} onChange={(e) => setCondition(e.target.value as DischargeCondition)}><option value="stable">Stable</option><option value="improved">Improved</option><option value="unchanged">Unchanged</option><option value="deteriorated">Deteriorated</option></select></label></div>
      {['transfer', 'referred'].includes(disposition) && <label><span>Destination *</span><input value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="Facility, service, or specialist" /></label>}
      {!['admit', 'icu', 'operating-room', 'deceased', 'left-without-being-seen'].includes(disposition) && <label><span>Patient instructions *</span><textarea rows={4} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="Medications, warning signs, activity, diet, and return precautions" /></label>}
      <label><span>Follow-up date</span><input type="datetime-local" value={followUpDate} min={new Date().toISOString().slice(0,16)} onChange={(e) => setFollowUpDate(e.target.value)} /></label>
      <div className="disposition-gate"><ShieldCheck size={18} /><span><strong>Clinical completion gate</strong><small>A primary diagnosis and signed clinical note are required before closure.</small></span></div>
      <label className="disposition-confirm"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /><span><strong>I confirm the disposition and patient instructions are complete.</strong><small>The encounter will become read-only after completion.</small></span></label>
    </div><footer><button type="button" className="secondary" onClick={onClose}>Cancel</button><button type="submit" className="primary" disabled={saving}><CheckCircle2 size={16} />{saving ? 'Validating…' : 'Complete encounter'}</button></footer></form>
  </section></div>;
}
