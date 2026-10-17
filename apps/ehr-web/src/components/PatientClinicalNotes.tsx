import {
  useEffect,
  useMemo,
  useState,
} from 'react';

import type {
  ReactNode,
} from 'react';

import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  ExternalLink,
  FileText,
  PenLine,
  RefreshCw,
  Search,
  ShieldCheck,
  UserRound,
} from 'lucide-react';

import {
  useNavigate,
} from 'react-router-dom';

import {
  getPatientClinicalNotes,
  signClinicalNote,
} from '../api/clinicalNoteApi';

import type {
  ClinicalNote,
  ClinicalNoteStatus,
  ClinicalNoteType,
} from '../types/clinicalNote';

import './PatientClinicalNotes.css';

interface PatientClinicalNotesProps {
  patientId: string;
  hospitalId: string;
}

type FilterType =
  | 'all'
  | 'draft'
  | 'signed'
  | 'initial'
  | 'progress'
  | 'consultation'
  | 'discharge'
  | 'addendum';

export default function PatientClinicalNotes({
  patientId,
  hospitalId,
}: PatientClinicalNotesProps) {
  const navigate = useNavigate();
  const [notes, setNotes] = useState<ClinicalNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterType>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [signingId, setSigningId] = useState<string | null>(null);

  async function loadNotes(manual = false) {
    try {
      if (manual) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError('');
      const response = await getPatientClinicalNotes(patientId, hospitalId);
      setNotes(response.notes ?? []);
    } catch (err) {
      console.error('Failed to load patient clinical notes:', err);
      setError('Unable to load patient clinical notes.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void loadNotes();
  }, [patientId]);

  const signedCount = useMemo(
    () => notes.filter((note) => note.status === 'signed').length,
    [notes],
  );

  const draftCount = useMemo(
    () => notes.filter((note) => note.status === 'draft').length,
    [notes],
  );

  const addendumCount = useMemo(
    () => notes.filter((note) => note.noteType === 'addendum').length,
    [notes],
  );

  const filteredNotes = useMemo(() => {
    const term = search.trim().toLowerCase();
    return notes.filter((note) => {
      const matchesFilter =
        filter === 'all' || note.status === filter || note.noteType === filter;
      if (!matchesFilter) return false;
      if (!term) return true;
      const haystack = [
        note.noteType,
        note.status,
        note.practitionerName,
        note.chiefComplaint,
        note.historyPresentIllness,
        note.reviewOfSystems,
        note.physicalExamination,
        note.assessment,
        note.plan,
        note.progressNote,
        note.addendumText,
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(term);
    });
  }, [notes, search, filter]);

  function openEncounter(encounterId?: string) {
    if (!encounterId) return;
    navigate(`/hospital/${hospitalId}/patient/${patientId}/encounter/${encounterId}`);
  }

  async function handleSign(note: ClinicalNote) {
    if (!note.id) return;
    try {
      setSigningId(note.id);
      setError('');
      const updated = await signClinicalNote(note.id, hospitalId);
      setNotes((current) =>
        current.map((item) => item.id === note.id ? updated : item),
      );
    } catch (err) {
      console.error('Failed to sign clinical note:', err);
      setError('Unable to sign the clinical note.');
    } finally {
      setSigningId(null);
    }
  }

  if (loading) {
    return (
      <div className="patient-clinical-notes-state">
        <div className="patient-clinical-notes-spinner" />
        <strong>Loading Clinical Notes</strong>
        <span>Retrieving the patient longitudinal clinical record...</span>
      </div>
    );
  }

  return (
    <div className="patient-clinical-notes">
      <header className="patient-clinical-notes-header">
        <div className="patient-clinical-notes-heading">
          <div className="patient-clinical-notes-heading-icon"><FileText size={20} /></div>
          <div>
            <h2>Clinical Notes</h2>
            <p>Longitudinal notes across all patient encounters</p>
          </div>
        </div>
        <button
          type="button"
          className="patient-clinical-notes-refresh"
          disabled={refreshing}
          onClick={() => void loadNotes(true)}
        >
          <RefreshCw size={14} className={refreshing ? 'clinical-note-spin' : undefined} />
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </header>

      <div className="patient-clinical-notes-summary">
        <SummaryCard icon={<FileText size={17} />} label="Total Notes" value={notes.length} />
        <SummaryCard icon={<CheckCircle2 size={17} />} label="Signed" value={signedCount} type="signed" />
        <SummaryCard icon={<PenLine size={17} />} label="Draft" value={draftCount} type="draft" />
        <SummaryCard icon={<ShieldCheck size={17} />} label="Addenda" value={addendumCount} type="addendum" />
      </div>

      {error && (
        <div className="patient-clinical-notes-error">
          <AlertCircle size={15} />
          {error}
        </div>
      )}

      <div className="patient-clinical-notes-toolbar">
        <div className="patient-clinical-notes-search">
          <Search size={14} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search note content, type, physician..."
          />
        </div>
        <div className="patient-clinical-notes-filters">
          {([
            ['all', 'All'],
            ['draft', 'Draft'],
            ['signed', 'Signed'],
            ['initial', 'Initial'],
            ['progress', 'Progress'],
            ['consultation', 'Consultation'],
            ['discharge', 'Discharge'],
            ['addendum', 'Addendum'],
          ] as Array<[FilterType, string]>).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={filter === value ? 'patient-clinical-note-filter active' : 'patient-clinical-note-filter'}
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {filteredNotes.length === 0 ? (
        <div className="patient-clinical-notes-empty">
          <FileText size={32} />
          <strong>{notes.length === 0 ? 'No clinical notes recorded' : 'No notes match the current filter'}</strong>
          <span>{notes.length === 0
            ? 'Clinical documentation from patient encounters will appear here.'
            : 'Try changing the search text or note filter.'}</span>
        </div>
      ) : (
        <div className="patient-clinical-note-list">
          {filteredNotes.map((note, index) => {
            const noteKey = note.id ?? `${note.createdAt}-${index}`;
            const expanded = expandedId === noteKey;
            return (
              <ClinicalNoteCard
                key={noteKey}
                note={note}
                expanded={expanded}
                signing={signingId === note.id}
                onToggle={() => setExpandedId(expanded ? null : noteKey)}
                onOpenEncounter={() => openEncounter(note.encounterId)}
                onSign={() => void handleSign(note)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function SummaryCard({ icon, label, value, type = 'default' }: {
  icon: ReactNode;
  label: string;
  value: number;
  type?: 'default' | 'signed' | 'draft' | 'addendum';
}) {
  return (
    <div className={`patient-clinical-note-summary-card ${type}`}>
      <div className="patient-clinical-note-summary-icon">{icon}</div>
      <div><strong>{value}</strong><span>{label}</span></div>
    </div>
  );
}

function ClinicalNoteCard({ note, expanded, signing, onToggle, onOpenEncounter, onSign }: {
  note: ClinicalNote;
  expanded: boolean;
  signing: boolean;
  onToggle: () => void;
  onOpenEncounter: () => void;
  onSign: () => void;
}) {
  const preview = getNotePreview(note);
  return (
    <article className={`patient-clinical-note-card ${note.status}`}>
      <div className="patient-clinical-note-card-header">
        <div className="patient-clinical-note-title-area">
          <div className={`patient-clinical-note-type-icon ${note.noteType}`}><FileText size={18} /></div>
          <div>
            <div className="patient-clinical-note-title-row">
              <h3>{getNoteTypeLabel(note.noteType)}</h3>
              <StatusBadge status={note.status} />
            </div>
            <div className="patient-clinical-note-meta">
              <span><UserRound size={11} />{note.practitionerName ?? 'Clinician not recorded'}</span>
              <span><Clock3 size={11} />{formatDateTime(note.updatedAt ?? note.createdAt)}</span>
            </div>
          </div>
        </div>
        <div className="patient-clinical-note-top-actions">
          {note.encounterId && (
            <button type="button" className="patient-clinical-note-encounter" onClick={onOpenEncounter}>
              <ExternalLink size={12} />Open Encounter
            </button>
          )}
          <button type="button" className="patient-clinical-note-expand" onClick={onToggle}>
            {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
        </div>
      </div>

      {!expanded && preview && <p className="patient-clinical-note-preview">{preview}</p>}

      {expanded && (
        <div className="patient-clinical-note-content">
          <ClinicalField label="Chief Complaint" value={note.chiefComplaint} />
          <ClinicalField label="History of Present Illness" value={note.historyPresentIllness} />
          <ClinicalField label="Review of Systems" value={note.reviewOfSystems} />
          <ClinicalField label="Physical Examination" value={note.physicalExamination} />
          <ClinicalField label="Assessment" value={note.assessment} />
          <ClinicalField label="Plan" value={note.plan} />
          <ClinicalField label="Progress Note" value={note.progressNote} />
          <ClinicalField label="Addendum" value={note.addendumText} emphasis={note.noteType === 'addendum'} />
        </div>
      )}

      <div className="patient-clinical-note-footer">
        <div className="patient-clinical-note-dates">
          <span>Created:<strong>{formatDateTime(note.createdAt)}</strong></span>
          {note.signedAt && <span>Signed:<strong>{formatDateTime(note.signedAt)}</strong></span>}
        </div>
        {note.status === 'draft' && (
          <button
            type="button"
            className="patient-clinical-note-sign"
            disabled={signing}
            onClick={onSign}
          >
            <ShieldCheck size={12} />{signing ? 'Signing...' : 'Sign Note'}
          </button>
        )}
      </div>
    </article>
  );
}

function ClinicalField({ label, value, emphasis = false }: { label: string; value?: string; emphasis?: boolean }) {
  if (!value) return null;
  return (
    <section className={emphasis ? 'patient-clinical-field emphasis' : 'patient-clinical-field'}>
      <span>{label}</span>
      <p>{value}</p>
    </section>
  );
}

function StatusBadge({ status }: { status: ClinicalNoteStatus }) {
  return (
    <span className={`patient-clinical-note-status ${status}`}>
      {status === 'entered-in-error' ? 'Entered in Error' : capitalize(status)}
    </span>
  );
}

function getNoteTypeLabel(type: ClinicalNoteType) {
  switch (type) {
    case 'initial': return 'Initial Clinical Note';
    case 'consultation': return 'Consultation Note';
    case 'discharge': return 'Discharge Note';
    case 'addendum': return 'Clinical Note Addendum';
    default: return 'Progress Note';
  }
}

function getNotePreview(note: ClinicalNote) {
  const value = note.addendumText ?? note.progressNote ?? note.assessment ?? note.chiefComplaint ?? note.historyPresentIllness ?? note.plan ?? '';
  return value.length <= 220 ? value : `${value.slice(0, 220)}…`;
}

function formatDateTime(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function capitalize(value: string) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}
