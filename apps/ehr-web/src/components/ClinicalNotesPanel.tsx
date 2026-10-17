import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react';

import {
  AlertCircle,
  CheckCircle2,
  ClipboardPenLine,
  FileCheck2,
  FileClock,
  FilePlus2,
  History,
  LockKeyhole,
  Plus,
  RefreshCw,
  Save,
  Signature,
  UserRound,
} from 'lucide-react';

import {
  createClinicalNote,
  createClinicalNoteAddendum,
  getEncounterClinicalNotes,
  signClinicalNote,
  updateClinicalNote,
} from '../api/clinicalNoteApi';

import type {
  ClinicalNote,
  ClinicalNoteType,
} from '../types/clinicalNote';

import './ClinicalNotesPanel.css';

interface ClinicalNotesPanelProps {
  patientId: string;
  hospitalId: string;
  encounterId: string;

  practitionerId?: string;
  practitionerName?: string;

  readOnly?: boolean;
}

interface ClinicalNoteForm {
  noteType: ClinicalNoteType;

  chiefComplaint: string;
  historyPresentIllness: string;
  reviewOfSystems: string;
  physicalExamination: string;
  allergyReview: 'reviewed-no-known' | 'reviewed-known' | 'unable';
  medicationReview: 'reviewed' | 'unable';
  previousResultsReviewed: boolean;
  assessment: string;
  plan: string;
  progressNote: string;
}

const EMPTY_FORM: ClinicalNoteForm = {
  noteType: 'progress',
  chiefComplaint: '',
  historyPresentIllness: '',
  reviewOfSystems: '',
  physicalExamination: '',
  allergyReview: 'reviewed-no-known',
  medicationReview: 'reviewed',
  previousResultsReviewed: false,
  assessment: '',
  plan: '',
  progressNote: '',
};

export default function ClinicalNotesPanel({
  patientId,
  hospitalId,
  encounterId,
  practitionerId,
  practitionerName,
  readOnly = false,
}: ClinicalNotesPanelProps) {
  const [notes, setNotes] =
    useState<ClinicalNote[]>([]);

  const [selectedNoteId, setSelectedNoteId] =
    useState<string>();

  const [form, setForm] =
    useState<ClinicalNoteForm>(EMPTY_FORM);

  const [loading, setLoading] =
    useState(true);

  const [saving, setSaving] =
    useState(false);

  const [signing, setSigning] =
    useState(false);

  const [error, setError] =
    useState('');

  const [success, setSuccess] =
    useState('');

  const [addendumText, setAddendumText] =
    useState('');

  const [showAddendum, setShowAddendum] =
    useState(false);

  const selectedNote =
    useMemo(
      () =>
        notes.find(
          (note) =>
            note.id === selectedNoteId,
        ),
      [notes, selectedNoteId],
    );

  useEffect(() => {
    void loadNotes();
  }, [encounterId]);

  async function loadNotes(
    preferredNoteId?: string,
  ) {
    try {
      setLoading(true);
      setError('');

      const result =
        await getEncounterClinicalNotes(
          encounterId,
          hospitalId,
        );

      const loadedNotes =
        result.notes ?? [];

      setNotes(loadedNotes);

      const preferred =
        preferredNoteId
          ? loadedNotes.find(
              (note) =>
                note.id ===
                preferredNoteId,
            )
          : undefined;

      const draft =
        loadedNotes.find(
          (note) =>
            note.status === 'draft',
        );

      const nextNote =
        preferred ??
        draft ??
        loadedNotes[0];

      if (nextNote?.id) {
        selectNote(nextNote);
      } else {
        startNewNote();
      }
    } catch (err) {
      console.error(
        'Unable to load clinical notes:',
        err,
      );

      setError(
        'Unable to load clinical notes.',
      );
    } finally {
      setLoading(false);
    }
  }

  function startNewNote() {
    setSelectedNoteId(undefined);
    setForm({ ...EMPTY_FORM });
    setShowAddendum(false);
    setAddendumText('');
    setError('');
    setSuccess('');
  }

  function selectNote(
    note: ClinicalNote,
  ) {
    setSelectedNoteId(note.id);

    setForm({
      noteType:
        note.noteType === 'addendum'
          ? 'progress'
          : note.noteType,

      chiefComplaint:
        note.chiefComplaint ?? '',

      historyPresentIllness:
        note.historyPresentIllness ?? '',

      reviewOfSystems:
        note.reviewOfSystems ?? '',

      physicalExamination:
        note.physicalExamination ?? '',

      allergyReview: note.allergyReview ?? 'reviewed-no-known',
      medicationReview: note.medicationReview ?? 'reviewed',
      previousResultsReviewed: note.previousResultsReviewed ?? false,

      assessment:
        note.assessment ?? '',

      plan:
        note.plan ?? '',

      progressNote:
        note.progressNote ?? '',
    });

    setShowAddendum(false);
    setAddendumText('');
    setError('');
    setSuccess('');
  }

  function updateField<
    K extends keyof ClinicalNoteForm,
  >(
    field: K,
    value: ClinicalNoteForm[K],
  ) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async function handleSave(
    event?: FormEvent,
  ) {
    event?.preventDefault();

    if (readOnly) {
      return;
    }

    if (
      selectedNote?.status ===
      'signed'
    ) {
      setError(
        'Signed notes cannot be modified.',
      );

      return;
    }

    try {
      setSaving(true);
      setError('');
      setSuccess('');

      let saved:
        ClinicalNote;

      if (selectedNote?.id) {
        saved =
          await updateClinicalNote(
            selectedNote.id,
            {
              hospitalId,
              chiefComplaint:
                form.chiefComplaint,

              historyPresentIllness:
                form.historyPresentIllness,

              reviewOfSystems:
                form.reviewOfSystems,

              physicalExamination:
                form.physicalExamination,

              allergyReview: form.allergyReview,
              medicationReview: form.medicationReview,
              previousResultsReviewed: form.previousResultsReviewed,

              assessment:
                form.assessment,

              plan:
                form.plan,

              progressNote:
                form.progressNote,
            },
          );
      } else {
        saved =
          await createClinicalNote({
            patientId,
            hospitalId,
            encounterId,

            practitionerId,
            practitionerName,

            noteType:
              form.noteType,

            chiefComplaint:
              form.chiefComplaint,

            historyPresentIllness:
              form.historyPresentIllness,

            reviewOfSystems:
              form.reviewOfSystems,

            physicalExamination:
              form.physicalExamination,

            allergyReview: form.allergyReview,
            medicationReview: form.medicationReview,
            previousResultsReviewed: form.previousResultsReviewed,

            assessment:
              form.assessment,

            plan:
              form.plan,

            progressNote:
              form.progressNote,
          });
      }

      setSuccess(
        'Clinical note saved as draft.',
      );

      await loadNotes(
        saved.id,
      );
    } catch (err: any) {
      console.error(
        'Unable to save clinical note:',
        err,
      );

      setError(
        getApiError(
          err,
          'Unable to save clinical note.',
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleSign() {
    if (
      readOnly ||
      !selectedNote?.id
    ) {
      return;
    }

    if (
      selectedNote.status ===
      'signed'
    ) {
      return;
    }

    if (form.noteType === 'initial') {
      const required = [
        { id: 'clinical-note-chief-complaint', label: 'Chief Complaint', complete: form.chiefComplaint.trim() },
        { id: 'clinical-note-history', label: 'History of Present Illness', complete: form.historyPresentIllness.trim() },
        { id: 'clinical-note-examination', label: 'Physical Examination', complete: form.physicalExamination.trim() },
        { id: 'clinical-note-allergy-review', label: 'Allergy Review', complete: form.allergyReview },
        { id: 'clinical-note-medication-review', label: 'Medication Review', complete: form.medicationReview },
        { id: 'clinical-note-results-review', label: 'Previous Results Review', complete: form.previousResultsReviewed ? 'confirmed' : '' },
        { id: 'clinical-note-assessment', label: 'Assessment', complete: form.assessment.trim() },
        { id: 'clinical-note-plan', label: 'Plan', complete: form.plan.trim() },
      ];
      const missing = required.filter((item) => !item.complete);

      if (missing.length > 0) {
        setSuccess('');
        setError(`Complete the required sections before signing: ${missing.map((item) => item.label).join(', ')}.`);

        window.requestAnimationFrame(() => {
          const firstMissing = document.getElementById(missing[0].id);
          firstMissing?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          firstMissing?.focus({ preventScroll: true });
        });
        return;
      }
    }

    const confirmed =
      window.confirm(
        'Sign this clinical note?\n\nAfter signing, the original note can no longer be edited. Corrections must be entered as an addendum.',
      );

    if (!confirmed) {
      return;
    }

    try {
      setSigning(true);
      setError('');
      setSuccess('');

      /*
       * Save latest changes before signing.
       */
      await updateClinicalNote(
        selectedNote.id,
        {
          hospitalId,
          chiefComplaint:
            form.chiefComplaint,

          historyPresentIllness:
            form.historyPresentIllness,

          reviewOfSystems:
            form.reviewOfSystems,

          physicalExamination:
            form.physicalExamination,

          allergyReview: form.allergyReview,
          medicationReview: form.medicationReview,
          previousResultsReviewed: form.previousResultsReviewed,

          assessment:
            form.assessment,

          plan:
            form.plan,

          progressNote:
            form.progressNote,
        },
      );

      const signed =
        await signClinicalNote(
          selectedNote.id,
          hospitalId,
        );

      setSuccess(
        'Clinical note signed successfully.',
      );

      await loadNotes(
        signed.id,
      );
    } catch (err: any) {
      console.error(
        'Unable to sign clinical note:',
        err,
      );

      setError(
        getApiError(
          err,
          'Unable to sign clinical note.',
        ),
      );
    } finally {
      setSigning(false);
    }
  }

  async function handleAddendum() {
    if (
      readOnly ||
      !selectedNote?.id ||
      selectedNote.status !==
        'signed'
    ) {
      return;
    }

    if (!addendumText.trim()) {
      setError(
        'Enter the addendum text first.',
      );

      return;
    }

    try {
      setSaving(true);
      setError('');
      setSuccess('');

      const addendum =
        await createClinicalNoteAddendum(
          selectedNote.id,
          {
            hospitalId,
            practitionerId,
            practitionerName,

            text:
              addendumText.trim(),
          },
        );

      setAddendumText('');
      setShowAddendum(false);

      setSuccess(
        'Addendum added successfully.',
      );

      await loadNotes(
        addendum.id,
      );
    } catch (err: any) {
      console.error(
        'Unable to create addendum:',
        err,
      );

      setError(
        getApiError(
          err,
          'Unable to create addendum.',
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  const locked =
    readOnly ||
    selectedNote?.status ===
      'signed' ||
    selectedNote?.noteType ===
      'addendum';

  return (
    <div className="clinical-notes-panel">

      {/* ============================
          SUMMARY
      ============================ */}

      <div className="clinical-note-summary">

        <SummaryCard
          icon={
            <FileClock size={19} />
          }
          label="Draft Notes"
          value={
            notes.filter(
              (note) =>
                note.status ===
                'draft',
            ).length
          }
        />

        <SummaryCard
          icon={
            <FileCheck2 size={19} />
          }
          label="Signed Notes"
          value={
            notes.filter(
              (note) =>
                note.status ===
                'signed' &&
                note.noteType !==
                  'addendum',
            ).length
          }
        />

        <SummaryCard
          icon={
            <History size={19} />
          }
          label="Addenda"
          value={
            notes.filter(
              (note) =>
                note.noteType ===
                'addendum',
            ).length
          }
        />

      </div>

      <div className="clinical-note-layout">

        {/* ============================
            NOTE HISTORY
        ============================ */}

        <aside className="clinical-note-history">

          <div className="clinical-note-history-header">

            <div>
              <h2>
                Clinical Notes
              </h2>

              <p>
                Encounter documentation history
              </p>
            </div>

            {!readOnly && (
              <button
                type="button"
                className="new-clinical-note-button"
                onClick={
                  startNewNote
                }
                title="New clinical note"
              >
                <Plus size={16} />
              </button>
            )}

          </div>

          <div className="clinical-note-history-list">

            {loading ? (
              <div className="clinical-note-history-empty">
                Loading notes...
              </div>
            ) : notes.length === 0 ? (
              <div className="clinical-note-history-empty">

                <ClipboardPenLine
                  size={25}
                />

                <strong>
                  No clinical notes
                </strong>

                <span>
                  Start documenting this encounter.
                </span>

              </div>
            ) : (
              notes.map((note) => (
                <button
                  type="button"
                  key={note.id}
                  className={
                    selectedNoteId ===
                    note.id
                      ? 'clinical-note-history-item active'
                      : 'clinical-note-history-item'
                  }
                  onClick={() =>
                    selectNote(note)
                  }
                >

                  <div className="note-history-top">

                    <strong>
                      {getNoteTypeLabel(
                        note.noteType,
                      )}
                    </strong>

                    <NoteStatus
                      note={note}
                    />

                  </div>

                  <div className="note-history-author">

                    <UserRound
                      size={12}
                    />

                    {note.practitionerName ||
                      'Clinical User'}

                  </div>

                  <span className="note-history-date">
                    {formatDateTime(
                      note.updatedAt ??
                        note.createdAt,
                    )}
                  </span>

                </button>
              ))
            )}

          </div>

        </aside>

        {/* ============================
            EDITOR
        ============================ */}

        <section className="clinical-note-editor">

          <header className="clinical-note-editor-header">

            <div className="clinical-note-editor-title">

              <div className="clinical-note-editor-icon">
                {locked ? (
                  <LockKeyhole
                    size={20}
                  />
                ) : (
                  <ClipboardPenLine
                    size={20}
                  />
                )}
              </div>

              <div>
                <h2>
                  {selectedNote
                    ? getNoteTypeLabel(
                        selectedNote.noteType,
                      )
                    : 'New Clinical Note'}
                </h2>

                <p>
                  {selectedNote?.status ===
                  'signed'
                    ? `Signed ${formatDateTime(
                        selectedNote.signedAt,
                      )}`
                    : selectedNote?.noteType ===
                        'addendum'
                      ? 'Signed addendum'
                      : 'Clinical encounter documentation'}
                </p>
              </div>

            </div>

            {selectedNote && (
              <NoteStatus
                note={selectedNote}
              />
            )}

          </header>

          {/* ADDENDUM VIEW */}

          {selectedNote?.noteType ===
          'addendum' ? (

            <div className="clinical-addendum-view">

              <div className="clinical-addendum-banner">

                <FilePlus2
                  size={18}
                />

                <div>
                  <strong>
                    Clinical Note Addendum
                  </strong>

                  <span>
                    This entry supplements a previously signed note.
                  </span>
                </div>

              </div>

              <div className="clinical-addendum-content">
                {selectedNote.addendumText ||
                  'No addendum text.'}
              </div>

              <div className="clinical-note-signature-box">

                <Signature
                  size={18}
                />

                <div>
                  <span>
                    Signed by
                  </span>

                  <strong>
                    {selectedNote.practitionerName ||
                      'Clinical User'}
                  </strong>

                  <small>
                    {formatDateTime(
                      selectedNote.signedAt,
                    )}
                  </small>
                </div>

              </div>

            </div>

          ) : (

            <form
              className="clinical-note-form"
              onSubmit={
                handleSave
              }
            >

              {!selectedNote && (
                <div className="clinical-note-type-row">

                  <Field
                    label="Note Type"
                  >
                    <select
                      value={
                        form.noteType
                      }
                      disabled={
                        readOnly
                      }
                      onChange={(event) =>
                        updateField(
                          'noteType',
                          event.target
                            .value as ClinicalNoteType,
                        )
                      }
                    >
                      <option value="initial">
                        Initial Clinical Note
                      </option>

                      <option value="progress">
                        Progress Note
                      </option>

                      <option value="consultation">
                        Consultation Note
                      </option>

                      <option value="discharge">
                        Discharge Note
                      </option>
                    </select>
                  </Field>

                </div>
              )}

              <NoteSection
                number="01"
                title="Chief Complaint"
                description="Primary reason for the patient's visit"
              >
                <textarea
                  id="clinical-note-chief-complaint"
                  rows={2}
                  disabled={locked}
                  value={
                    form.chiefComplaint
                  }
                  onChange={(event) =>
                    updateField(
                      'chiefComplaint',
                      event.target.value,
                    )
                  }
                  placeholder="Enter the patient's chief complaint..."
                />
              </NoteSection>

              <NoteSection
                number="02"
                title="History of Present Illness"
                description="Chronological description of the current clinical problem"
              >
                <textarea
                  id="clinical-note-history"
                  rows={5}
                  disabled={locked}
                  value={
                    form.historyPresentIllness
                  }
                  onChange={(event) =>
                    updateField(
                      'historyPresentIllness',
                      event.target.value,
                    )
                  }
                  placeholder="Describe onset, location, duration, characteristics, aggravating or relieving factors, associated symptoms..."
                />
              </NoteSection>

              <NoteSection
                number="03"
                title="Review of Systems"
                description="Relevant symptoms by organ system"
              >
                <textarea
                  rows={4}
                  disabled={locked}
                  value={
                    form.reviewOfSystems
                  }
                  onChange={(event) =>
                    updateField(
                      'reviewOfSystems',
                      event.target.value,
                    )
                  }
                  placeholder="General, cardiovascular, respiratory, gastrointestinal, neurological..."
                />
              </NoteSection>

              <NoteSection
                number="04"
                title="Physical Examination"
                description="Objective clinical examination findings"
              >
                <textarea
                  id="clinical-note-examination"
                  rows={5}
                  disabled={locked}
                  value={
                    form.physicalExamination
                  }
                  onChange={(event) =>
                    updateField(
                      'physicalExamination',
                      event.target.value,
                    )
                  }
                  placeholder="Document general appearance and relevant examination findings..."
                />
              </NoteSection>

              <div className="clinical-note-assessment-plan">

                <div className="clinical-note-safety-review">
                  <NoteSection number="05" title="Clinical Safety Review · Required" description="Complete all three checks before signing an initial consultation">
                    <label>Allergies<select id="clinical-note-allergy-review" disabled={locked} value={form.allergyReview} onChange={(event) => updateField('allergyReview', event.target.value as ClinicalNoteForm['allergyReview'])}><option value="reviewed-no-known">Reviewed — no known allergies</option><option value="reviewed-known">Reviewed — known allergies</option><option value="unable">Unable to verify</option></select></label>
                    <label>Current medications<select id="clinical-note-medication-review" disabled={locked} value={form.medicationReview} onChange={(event) => updateField('medicationReview', event.target.value as ClinicalNoteForm['medicationReview'])}><option value="reviewed">Reviewed</option><option value="unable">Unable to verify</option></select></label>
                    <label className={`clinical-note-results-confirmation ${!form.previousResultsReviewed ? 'required' : 'confirmed'}`}><input id="clinical-note-results-review" type="checkbox" disabled={locked} checked={form.previousResultsReviewed} onChange={(event) => updateField('previousResultsReviewed', event.target.checked)} /> <span><strong>Previous laboratory and radiology results reviewed</strong><small>Required acknowledgement for electronic signature</small></span></label>
                  </NoteSection>
                </div>

                <NoteSection
                  number="06"
                  title="Assessment"
                  description="Clinical impression"
                >
                  <textarea
                    id="clinical-note-assessment"
                    rows={5}
                    disabled={locked}
                    value={
                      form.assessment
                    }
                    onChange={(event) =>
                      updateField(
                        'assessment',
                        event.target.value,
                      )
                    }
                    placeholder="Clinical assessment..."
                  />
                </NoteSection>

                <NoteSection
                  number="07"
                  title="Plan"
                  description="Treatment and management plan"
                >
                  <textarea
                    id="clinical-note-plan"
                    rows={5}
                    disabled={locked}
                    value={
                      form.plan
                    }
                    onChange={(event) =>
                      updateField(
                        'plan',
                        event.target.value,
                      )
                    }
                    placeholder="Medication, investigations, referrals, follow-up..."
                  />
                </NoteSection>

              </div>

              <NoteSection
                number="08"
                title="Progress Note"
                description="Additional encounter documentation"
              >
                <textarea
                  rows={4}
                  disabled={locked}
                  value={
                    form.progressNote
                  }
                  onChange={(event) =>
                    updateField(
                      'progressNote',
                      event.target.value,
                    )
                  }
                  placeholder="Additional clinical progress documentation..."
                />
              </NoteSection>

              {selectedNote?.status ===
                'signed' && (

                <div className="clinical-note-locked-banner">

                  <LockKeyhole
                    size={17}
                  />

                  <div>
                    <strong>
                      Signed clinical document
                    </strong>

                    <span>
                      The original note is locked. Use an addendum for subsequent corrections or clarification.
                    </span>
                  </div>

                </div>
              )}

              {error && (
                <div className="clinical-note-message error">
                  <AlertCircle
                    size={15}
                  />
                  {error}
                </div>
              )}

              {success && (
                <div className="clinical-note-message success">
                  <CheckCircle2
                    size={15}
                  />
                  {success}
                </div>
              )}

              {!readOnly && (
                <div className="clinical-note-actions">

                  {!selectedNote ||
                  selectedNote.status ===
                    'draft' ? (
                    <>
                      <button
                        type="submit"
                        className="clinical-note-save-button"
                        disabled={
                          saving ||
                          signing
                        }
                      >
                        <Save
                          size={15}
                        />

                        {saving
                          ? 'Saving...'
                          : 'Save Draft'}
                      </button>

                      {selectedNote?.id && (
                        <button
                          type="button"
                          className="clinical-note-sign-button"
                          disabled={
                            saving ||
                            signing
                          }
                          onClick={() =>
                            void handleSign()
                          }
                        >
                          <Signature
                            size={15}
                          />

                          {signing
                            ? 'Signing...'
                            : 'Sign Note'}
                        </button>
                      )}
                    </>
                  ) : (
                    <button
                      type="button"
                      className="clinical-note-addendum-button"
                      onClick={() =>
                        setShowAddendum(
                          (current) =>
                            !current,
                        )
                      }
                    >
                      <FilePlus2
                        size={15}
                      />
                      Add Addendum
                    </button>
                  )}

                </div>
              )}

            </form>
          )}

          {/* ADDENDUM EDITOR */}

          {selectedNote?.status ===
            'signed' &&
            selectedNote.noteType !==
              'addendum' &&
            showAddendum &&
            !readOnly && (

              <div className="clinical-addendum-editor">

                <div>
                  <h3>
                    Add Addendum
                  </h3>

                  <p>
                    The original signed note will remain unchanged.
                  </p>
                </div>

                <textarea
                  rows={5}
                  value={
                    addendumText
                  }
                  onChange={(event) =>
                    setAddendumText(
                      event.target.value,
                    )
                  }
                  placeholder="Enter clarification or additional clinical information..."
                />

                <div className="clinical-addendum-actions">

                  <button
                    type="button"
                    onClick={() => {
                      setShowAddendum(
                        false,
                      );
                      setAddendumText(
                        '',
                      );
                    }}
                  >
                    Cancel
                  </button>

                  <button
                    type="button"
                    className="save-addendum-button"
                    disabled={saving}
                    onClick={() =>
                      void handleAddendum()
                    }
                  >
                    <Signature
                      size={14}
                    />

                    {saving
                      ? 'Signing...'
                      : 'Sign Addendum'}
                  </button>

                </div>

              </div>
            )}

        </section>

      </div>

      <button
        type="button"
        className="clinical-notes-refresh"
        onClick={() =>
          void loadNotes(
            selectedNoteId,
          )
        }
      >
        <RefreshCw size={14} />
        Refresh clinical notes
      </button>

    </div>
  );
}

function NoteSection({
  number,
  title,
  description,
  children,
}: {
  number: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="clinical-note-section">

      <div className="clinical-note-section-heading">

        <span className="clinical-note-section-number">
          {number}
        </span>

        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>

      </div>

      {children}

    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="clinical-note-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function SummaryCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div className="clinical-note-summary-card">

      <div className="clinical-note-summary-icon">
        {icon}
      </div>

      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>

    </div>
  );
}

function NoteStatus({
  note,
}: {
  note: ClinicalNote;
}) {
  const status =
    note.noteType === 'addendum'
      ? 'addendum'
      : note.status;

  return (
    <span
      className={`clinical-note-status ${status}`}
    >
      {status === 'signed' && (
        <FileCheck2 size={11} />
      )}

      {status === 'draft' && (
        <FileClock size={11} />
      )}

      {status === 'addendum' && (
        <FilePlus2 size={11} />
      )}

      {formatText(status)}
    </span>
  );
}

function getNoteTypeLabel(
  type?: ClinicalNoteType,
) {
  switch (type) {
    case 'initial':
      return 'Initial Clinical Note';

    case 'consultation':
      return 'Consultation Note';

    case 'discharge':
      return 'Discharge Note';

    case 'addendum':
      return 'Clinical Note Addendum';

    default:
      return 'Progress Note';
  }
}

function formatDateTime(
  value?: string,
) {
  if (!value) {
    return '-';
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return value;
  }

  return date.toLocaleString();
}

function formatText(
  value: string,
) {
  return value
    .split('-')
    .map(
      (part) =>
        part.charAt(0).toUpperCase() +
        part.slice(1),
    )
    .join(' ');
}

function getApiError(
  error: any,
  fallback: string,
) {
  const message =
    error?.response?.data?.message;

  if (Array.isArray(message)) {
    return message.join(', ');
  }

  if (
    typeof message === 'string'
  ) {
    return message;
  }

  return fallback;
}
