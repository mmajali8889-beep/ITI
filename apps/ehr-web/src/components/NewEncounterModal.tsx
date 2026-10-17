import {
  useEffect,
  useState,
  type FormEvent,
} from 'react';

import {
  Activity,
  Ambulance,
  BedDouble,
  ShieldCheck,
  Stethoscope,
  X,
} from 'lucide-react';

import {
  createEncounter,
} from '../api/encounterApi';

import type {
  EncounterType,
  EncounterPriority,
  ArrivalMode,
  FinancialClass,
} from '../types/encounter';

import './NewEncounterModal.css';

interface NewEncounterModalProps {
  open: boolean;

  patientId: string;
  hospitalId: string;

  onClose: () => void;

  onCreated: (
    encounterId: string,
  ) => void;
}

const departments = [
  'Internal Medicine',
  'Cardiology',
  'General Surgery',
  'Pediatrics',
  'Obstetrics & Gynecology',
  'Orthopedics',
  'ENT',
  'Ophthalmology',
  'Dermatology',
  'Emergency Department',
  'ICU',
];

export default function NewEncounterModal({
  open,
  patientId,
  hospitalId,
  onClose,
  onCreated,
}: NewEncounterModalProps) {
  const [
    encounterType,
    setEncounterType,
  ] =
    useState<EncounterType>(
      'outpatient',
    );

  const [
    department,
    setDepartment,
  ] =
    useState('');

  const [priority, setPriority] = useState<EncounterPriority>('routine');
  const [arrivalMode, setArrivalMode] = useState<ArrivalMode>('walk-in');
  const [referralReference, setReferralReference] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [financialClass, setFinancialClass] = useState<FinancialClass>('cash');

  const [
    practitionerName,
    setPractitionerName,
  ] =
    useState('');

  const [
    reason,
    setReason,
  ] =
    useState('');

  const [
    saving,
    setSaving,
  ] =
    useState(false);

  const [
    error,
    setError,
  ] =
    useState('');

  useEffect(() => {
    if (!open) {
      return;
    }

    setEncounterType(
      'outpatient',
    );

    setDepartment('');
    setPractitionerName('');
    setReason('');
    setPriority('routine');
    setArrivalMode('walk-in');
    setReferralReference('');
    setConfirmed(false);
    setFinancialClass('cash');
    setError('');
  }, [open]);

  if (!open) {
    return null;
  }

  async function handleSubmit(
    event:
      FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (!department) {
      setError(
        'Please select a department.',
      );

      return;
    }

    if (reason.trim().length < 3) {
      setError('Please enter the reason for visit.');
      return;
    }

    if (arrivalMode === 'referral' && !referralReference.trim()) {
      setError('Referral reference is required.');
      return;
    }

    if (!confirmed) {
      setError('Confirm the patient identity and visit information.');
      return;
    }

    try {
      setSaving(true);

      setError('');

      const encounter =
        await createEncounter({
          patientId,
          hospitalId,

          encounterType,

          department,

          practitionerName:
            practitionerName ||
            undefined,

          reason:
            reason ||
            undefined,

          priority,
          arrivalMode,
          referralReference: referralReference || undefined,
          registrationConfirmed: confirmed,
          financialClass,
        });

      onCreated(
        encounter.id,
      );

    } catch (err: any) {
      console.error(
        'Encounter creation failed:',
        err,
      );

      const message =
        err?.response?.data
          ?.message;

      setError(
        Array.isArray(
          message,
        )
          ? message.join(', ')
          : message ||
              'Unable to create encounter.',
      );

    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="encounter-modal-overlay">

      <div className="encounter-modal">

        <div className="encounter-modal-header">

          <div>
            <span className="modal-eyebrow">
              Clinical Workflow
            </span>

            <h2>
              New Encounter
            </h2>

            <p>
              Start a new patient visit.
            </p>
          </div>

          <button
            type="button"
            className="modal-close"
            onClick={onClose}
          >
            <X size={20} />
          </button>

        </div>

        <form
          onSubmit={
            handleSubmit
          }
        >

          <section className="encounter-modal-body">

            <div className="encounter-field-group">

              <label>
                Encounter Type
              </label>

              <div className="encounter-type-grid">

                <EncounterTypeButton
                  active={
                    encounterType ===
                    'outpatient'
                  }
                  title="Outpatient"
                  description="Clinic / ambulatory visit"
                  icon={
                    <Stethoscope
                      size={20}
                    />
                  }
                  onClick={() =>
                    setEncounterType(
                      'outpatient',
                    )
                  }
                />

                <EncounterTypeButton
                  active={
                    encounterType ===
                    'emergency'
                  }
                  title="Emergency"
                  description="Emergency department"
                  icon={
                    <Activity
                      size={20}
                    />
                  }
                  onClick={() =>
                    setEncounterType(
                      'emergency',
                    )
                  }
                />

                <EncounterTypeButton
                  active={
                    encounterType ===
                    'inpatient'
                  }
                  title="Inpatient"
                  description="Hospital admission"
                  icon={
                    <BedDouble
                      size={20}
                    />
                  }
                  onClick={() =>
                    setEncounterType(
                      'inpatient',
                    )
                  }
                />

                {(['day-case', 'laboratory-only', 'radiology-only', 'procedure'] as const).map((type) => (
                  <EncounterTypeButton
                    key={type}
                    active={encounterType === type}
                    title={{ 'day-case': 'Day Case', 'laboratory-only': 'Laboratory only', 'radiology-only': 'Radiology only', procedure: 'Procedure' }[type]}
                    description={{ 'day-case': 'Same-day clinical care', 'laboratory-only': 'Laboratory service visit', 'radiology-only': 'Imaging service visit', procedure: 'Procedure visit' }[type]}
                    icon={<Activity size={20} />}
                    onClick={() => setEncounterType(type)}
                  />
                ))}

              </div>

            </div>

            <div className="encounter-form-grid">

              <label className="encounter-field">

                <span>
                  Department *
                </span>

                <select
                  value={
                    department
                  }
                  onChange={(
                    event,
                  ) =>
                    setDepartment(
                      event.target
                        .value,
                    )
                  }
                >
                  <option value="">
                    Select department
                  </option>

                  {departments.map(
                    (
                      value,
                    ) => (
                      <option
                        key={
                          value
                        }
                        value={
                          value
                        }
                      >
                        {value}
                      </option>
                    ),
                  )}

                </select>

              </label>

              <label className="encounter-field">

                <span>
                  Physician
                </span>

                <input
                  value={
                    practitionerName
                  }
                  onChange={(
                    event,
                  ) =>
                    setPractitionerName(
                      event.target
                        .value,
                    )
                  }
                  placeholder="Doctor name"
                />

              </label>

            </div>

            <div className="encounter-form-grid">
              <label className="encounter-field">
                <span>Priority *</span>
                <select value={priority} onChange={(event) => setPriority(event.target.value as EncounterPriority)}>
                  <option value="routine">Routine</option>
                  <option value="urgent">Urgent</option>
                  <option value="emergency">Emergency</option>
                </select>
              </label>

              <label className="encounter-field">
                <span>Arrival Mode *</span>
                <select value={arrivalMode} onChange={(event) => setArrivalMode(event.target.value as ArrivalMode)}>
                  <option value="walk-in">Walk-in</option>
                  <option value="appointment">Scheduled appointment</option>
                  <option value="referral">External referral</option>
                  <option value="ambulance">Ambulance</option>
                </select>
              </label>

              <label className="encounter-field">
                <span>Financial Class *</span>
                <select value={financialClass} onChange={(event) => setFinancialClass(event.target.value as FinancialClass)}>
                  <option value="cash">Cash / Self-pay</option>
                  <option value="insurance">Insurance</option>
                  <option value="corporate">Corporate contract</option>
                  <option value="government">Government contract</option>
                </select>
              </label>
            </div>

            {financialClass !== 'cash' && encounterType !== 'emergency' && <div className="encounter-priority-banner urgent"><ShieldCheck size={18}/><div><strong>Eligibility required</strong><span>Diagnostic orders remain blocked until payer eligibility and authorization are cleared.</span></div></div>}

            {arrivalMode === 'referral' && (
              <label className="encounter-field encounter-referral">
                <span>Referral Reference *</span>
                <input value={referralReference} onChange={(event) => setReferralReference(event.target.value)} placeholder="Referral number or source facility" />
              </label>
            )}

            <label className="encounter-field">

              <span>
                Reason for Visit *
              </span>

              <textarea
                value={reason}
                onChange={(
                  event,
                ) =>
                  setReason(
                    event.target
                      .value,
                  )
                }
                placeholder="Chief complaint or reason for the encounter..."
                rows={4}
              />

            </label>

            <div className={`encounter-priority-banner ${priority}`}>
              {arrivalMode === 'ambulance' ? <Ambulance size={18} /> : <ShieldCheck size={18} />}
              <div><strong>{priority === 'emergency' ? 'Emergency priority' : priority === 'urgent' ? 'Urgent priority' : 'Routine priority'}</strong><span>The encounter will start as active and remain scoped to this hospital.</span></div>
            </div>

            <label className="encounter-confirmation">
              <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
              <span><strong>Identity and visit details verified</strong><small>I confirm the patient identity, department, priority, and reason for visit.</small></span>
            </label>

            {error && (
              <div className="encounter-modal-error">
                {error}
              </div>
            )}

          </section>

          <div className="encounter-modal-footer">

            <button
              type="button"
              className="encounter-cancel"
              onClick={onClose}
            >
              Cancel
            </button>

            <button
              type="submit"
              className="encounter-start"
              disabled={saving}
            >
              {saving
                ? 'Starting...'
                : 'Start Encounter'}
            </button>

          </div>

        </form>

      </div>

    </div>
  );
}

function EncounterTypeButton({
  active,
  title,
  description,
  icon,
  onClick,
}: {
  active: boolean;

  title: string;

  description: string;

  icon:
    React.ReactNode;

  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={
        active
          ? 'encounter-type-card active'
          : 'encounter-type-card'
      }
      onClick={onClick}
    >

      <div className="encounter-type-icon">
        {icon}
      </div>

      <div>
        <strong>
          {title}
        </strong>

        <span>
          {description}
        </span>
      </div>

    </button>
  );
}
