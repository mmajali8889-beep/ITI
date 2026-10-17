import {
  useEffect,
  useState,
} from 'react';

import {
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';

import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  BedDouble,
  Calendar,
  CheckCircle2,
  ClipboardList,
  FileText,
  FlaskConical,
  HeartPulse,
  Microscope,
  Pill,
  Save,
  Stethoscope,
  UserRound,
  GitBranch,
} from 'lucide-react';


/* =========================================================
   API
========================================================= */

import {
  getEncounter,
  finishEncounter,
} from '../api/encounterApi';

import {
  getPatient,
} from '../api/patientApi';

import {
  getPatientAllergies,
} from '../api/allergyApi';

import {
  getEncounterVitals,
} from '../api/vitalsApi';


/* =========================================================
   TYPES
========================================================= */

import type {
  EncounterResponse,
  FinishEncounterRequest,
} from '../types/encounter';

import type {
  PatientProfile,
} from '../types/patient';

import type {
  AllergyResponse,
} from '../types/allergy';

import type {
  VitalResult,
} from '../types/vitals';


/* =========================================================
   COMPONENTS
========================================================= */

import VitalsPanel
  from '../components/VitalsPanel';

import DiagnosisPanel
  from '../components/DiagnosisPanel';

import AllergiesPanel
  from '../components/AllergiesPanel';

import MedicationPanel
  from '../components/MedicationPanel';
  
  import ClinicalNotesPanel
  from '../components/ClinicalNotesPanel';
  
  import LaboratoryPanel from '../components/LaboratoryPanel';
import RadiologyPanel from '../components/RadiologyPanel';
import DispositionModal from '../components/DispositionModal';
import PatientJourneyPanel from '../components/PatientJourneyPanel';
import { assignEncounterFinancialClass } from '../api/financialApi';


/* =========================================================
   CSS
========================================================= */

import './EncounterWorkspace.css';
import './FinancialClearance.css';


/* =========================================================
   TYPES
========================================================= */

type WorkspaceTab =
  | 'overview'
  | 'vitals'
  | 'notes'
  | 'diagnosis'
  | 'allergies'
  | 'medications'
  | 'laboratory'
  | 'radiology'
  | 'journey';


/* =========================================================
   COMPONENT
========================================================= */

export default function EncounterWorkspace() {

  const navigate =
    useNavigate();

  const [searchParams] = useSearchParams();


  const {
    hospitalId,
    patientId,
    encounterId,
  } = useParams();


  /* =======================================================
     STATE
  ======================================================= */

  const [
    patient,
    setPatient,
  ] =
    useState<PatientProfile | null>(
      null,
    );


  const [
    encounter,
    setEncounter,
  ] =
    useState<EncounterResponse | null>(
      null,
    );


  const [
    patientAllergies,
    setPatientAllergies,
  ] =
    useState<AllergyResponse[]>(
      [],
    );


  const [
    latestVitals,
    setLatestVitals,
  ] =
    useState<VitalResult[]>(
      [],
    );


  const [
    activeTab,
    setActiveTab,
  ] =
    useState<WorkspaceTab>(
      () => {
        const requested = searchParams.get('tab');
        const allowed: WorkspaceTab[] = ['overview', 'vitals', 'notes', 'diagnosis', 'allergies', 'medications', 'laboratory', 'radiology', 'journey'];
        return allowed.includes(requested as WorkspaceTab) ? requested as WorkspaceTab : 'overview';
      },
    );


  const [
    loading,
    setLoading,
  ] =
    useState(true);


  const [
    error,
    setError,
  ] =
    useState('');


  const [
    finishing,
    setFinishing,
  ] =
    useState(false);

  const [dispositionOpen, setDispositionOpen] = useState(false);
  const [dispositionError, setDispositionError] = useState('');
  const [financialBusy, setFinancialBusy] = useState(false);
  const [financialError, setFinancialError] = useState('');


  /* =======================================================
     LOAD WORKSPACE
  ======================================================= */

  useEffect(() => {

    if (
      !patientId ||
      !encounterId
    ) {

      setError(
        'Patient or encounter ID is missing.',
      );

      setLoading(
        false,
      );

      return;
    }


    async function loadWorkspace() {

      try {

        setLoading(
          true,
        );

        setError(
          '',
        );


        const [
          patientData,
          encounterData,
        ] =
          await Promise.all([

            getPatient(
              patientId!,
              hospitalId!,
            ),

            getEncounter(
              encounterId!,
              hospitalId!,
            ),

          ]);


        setPatient(
          patientData,
        );

        setEncounter(
          encounterData,
        );


      } catch (err) {

        console.error(
          'Failed to load encounter workspace:',
          err,
        );


        setError(
          'Unable to load the clinical encounter.',
        );


      } finally {

        setLoading(
          false,
        );

      }

    }


    void loadWorkspace();


  }, [
    patientId,
    encounterId,
  ]);


  /* =======================================================
     LOAD PATIENT ALLERGIES
  ======================================================= */

  useEffect(() => {

    if (!patientId) {

      setPatientAllergies(
        [],
      );

      return;

    }


    async function loadPatientAllergies() {

      try {

        const result =
          await getPatientAllergies(
            patientId!,
          );


        const activeAllergies =
          (
            result.allergies ??
            []
          ).filter(
            (
              allergy,
            ) =>
              allergy.clinicalStatus ===
              'active',
          );


        setPatientAllergies(
          activeAllergies,
        );


      } catch (err) {

        console.error(
          'Unable to load patient allergies:',
          err,
        );


        setPatientAllergies(
          [],
        );

      }

    }


    void loadPatientAllergies();


  }, [
    patientId,
  ]);


  /* =======================================================
     LOAD VITALS FOR TAB ALERT
  ======================================================= */

  useEffect(() => {

    if (!encounterId) {

      setLatestVitals(
        [],
      );

      return;

    }


    async function loadVitalsAlert() {

      try {

        const result =
          await getEncounterVitals(
            encounterId!,
          );


        setLatestVitals(
          result.vitals ??
          [],
        );


      } catch (err) {

        console.error(
          'Unable to load vitals alert:',
          err,
        );


        setLatestVitals(
          [],
        );

      }

    }


    void loadVitalsAlert();


    /*
     * Refresh periodically so the navigation
     * warning updates after new vitals are saved.
     */

    const timer =
      window.setInterval(
        () => {

          void loadVitalsAlert();

        },
        5000,
      );


    return () => {

      window.clearInterval(
        timer,
      );

    };


  }, [
    encounterId,
  ]);


  /* =======================================================
     FINISH ENCOUNTER
  ======================================================= */

  async function handleFinishEncounter(payload: FinishEncounterRequest) {

    if (
      !encounterId ||
      !encounter
    ) {

      return;

    }


    try {

      setFinishing(
        true,
      );


      const updated =
        await finishEncounter(
          encounterId,
          payload,
        );


      setEncounter(
        updated,
      );
      setDispositionOpen(false);
      setDispositionError('');


    } catch (err) {

      console.error(
        'Unable to finish encounter:',
        err,
      );


      const response = (err as { response?: { data?: { message?: string } } }).response;
      setDispositionError(response?.data?.message ?? 'Unable to finish encounter. Complete the clinical requirements and try again.');


    } finally {

      setFinishing(
        false,
      );

    }

  }

  async function clearAsCash() {
    if (!hospitalId || !patientId || !encounterId) return;
    try {
      setFinancialBusy(true);
      setFinancialError('');
      await assignEncounterFinancialClass(encounterId, { hospitalId, patientId, financialClass: 'cash' });
      setEncounter((current) => current ? { ...current, financialClass: 'cash', financialClearanceStatus: 'cleared' } : current);
    } catch (cause) {
      const message = (cause as { response?: { data?: { message?: string } } }).response?.data?.message;
      setFinancialError(message ?? 'Unable to update financial classification.');
    } finally {
      setFinancialBusy(false);
    }
  }


  /* =======================================================
     LOADING
  ======================================================= */

  if (loading) {

    return (

      <div className="encounter-page-state">

        <div className="encounter-loading-spinner" />


        <strong>
          Loading clinical workspace
        </strong>


        <span>
          Retrieving patient and encounter information...
        </span>

      </div>

    );

  }


  /* =======================================================
     ERROR
  ======================================================= */

  if (
    error ||
    !patient ||
    !encounter
  ) {

    return (

      <div className="encounter-page-state error">

        <AlertCircle
          size={32}
        />


        <strong>
          Unable to open encounter
        </strong>


        <span>
          {error ||
            'Encounter not found.'}
        </span>


        <button
          type="button"
          onClick={() =>
            navigate(
              `/hospital/${hospitalId}/patient/${patientId}`,
            )
          }
        >
          Back to Patient Chart
        </button>

      </div>

    );

  }


  /* =======================================================
     COMPUTED VALUES
  ======================================================= */

  const isFinished =
    encounter.status ===
    'finished';


  const patientName =
    patient.nameEn ||
    patient.nameAr ||
    'Unknown Patient';


  const age =
    calculateAge(
      patient.birthDate,
    );


  const hasHighRiskAllergy =
    patientAllergies.some(
      (
        allergy,
      ) =>
        allergy.criticality ===
          'high' ||
        allergy.severity ===
          'severe',
    );


  const abnormalVitals =
    getAbnormalVitals(
      latestVitals,
    );


  const hasAbnormalVitals =
    abnormalVitals.length >
    0;


  /* =======================================================
     PAGE
  ======================================================= */

  return (

    <div className="encounter-workspace">

      {/* =================================================
          TOP ACTIONS
      ================================================= */}

      <div className="encounter-top-actions">

        <button
          type="button"
          className="encounter-back-button"
          onClick={() =>
            navigate(
              `/hospital/${hospitalId}/patient/${patientId}`,
            )
          }
        >

          <ArrowLeft
            size={16}
          />

          Patient Chart

        </button>


        <div className="encounter-id-label">

          Encounter

          <strong>
            {encounter.id}
          </strong>

        </div>

      </div>


      {!['cleared', 'emergency-override'].includes(encounter.financialClearanceStatus ?? '') && (
        <section className="financial-clearance-banner">
          <AlertCircle size={20}/>
          <div><strong>Financial classification required before diagnostic orders</strong><span>{financialError || (encounter.financialClearanceStatus === 'pending-eligibility' ? 'Insurance or contract eligibility must be approved before laboratory and radiology orders.' : 'This visit has not been classified. Select Cash / Self-pay to clear it now, or complete payer eligibility.')}</span></div>
          <button type="button" disabled={financialBusy} onClick={() => void clearAsCash()}>{financialBusy ? 'Updating…' : 'Set Cash / Self-pay'}</button>
        </section>
      )}


      {/* =================================================
          PATIENT BANNER
      ================================================= */}

      <section className="clinical-patient-banner">

        <div className="clinical-patient-main">

          <div className="clinical-patient-avatar">

            {patientName
              .charAt(0)
              .toUpperCase()}

          </div>


          <div className="clinical-patient-identity">

            <div className="clinical-name-row">

              <h1>
                {patientName}
              </h1>


              <EncounterStatus
                status={
                  encounter.status
                }
              />

            </div>


            {patient.nameAr && (

              <div
                className="clinical-arabic-name"
                dir="rtl"
              >
                {patient.nameAr}
              </div>

            )}


            <div className="clinical-demographics">

              <span>

                MRN

                <strong>
                  {patient.hospitalMrn ||
                    '-'}
                </strong>

              </span>


              <span>

                Gender

                <strong>
                  {formatGender(
                    patient.gender,
                  )}
                </strong>

              </span>


              <span>

                DOB

                <strong>
                  {patient.birthDate ||
                    '-'}
                </strong>

              </span>


              <span>

                Age

                <strong>
                  {age !== undefined
                    ? `${age} yrs`
                    : '-'}
                </strong>

              </span>

            </div>

          </div>

        </div>


        <div className="clinical-banner-actions">

          {!isFinished && (

            <button
              type="button"
              className="save-draft-button"
              onClick={() => {

                window.alert(
                  'Clinical modules save independently.',
                );

              }}
            >

              <Save
                size={16}
              />

              Save

            </button>

          )}


          {!isFinished && (

            <button
              type="button"
              className="finish-encounter-button"
              disabled={
                finishing
              }
              onClick={
                () => { setDispositionError(''); setDispositionOpen(true); }
              }
            >

              <CheckCircle2
                size={16}
              />


              {finishing
                ? 'Finishing...'
                : 'Finish Encounter'}

            </button>

          )}

        </div>

      </section>


      {/* =================================================
          ALLERGY SAFETY BANNER
      ================================================= */}

      <div
        className={
          hasHighRiskAllergy
            ? 'patient-allergy-banner high-risk'
            : 'patient-allergy-banner'
        }
      >

        <div className="patient-allergy-label">

          <AlertTriangle
            size={16}
          />

          <span>
            Allergies
          </span>

        </div>


        {patientAllergies.length ===
        0 ? (

          <span className="no-known-allergies">
            No active allergies recorded
          </span>

        ) : (

          <div className="patient-allergy-items">

            {patientAllergies.map(
              (
                allergy,
              ) => {

                const highRisk =
                  allergy.criticality ===
                    'high' ||
                  allergy.severity ===
                    'severe';


                return (

                  <button
                    key={
                      allergy.id ??
                      `${allergy.code}-${allergy.display}`
                    }
                    type="button"
                    className={
                      highRisk
                        ? 'patient-allergy-chip high-risk'
                        : 'patient-allergy-chip'
                    }
                    onClick={() =>
                      setActiveTab(
                        'allergies',
                      )
                    }
                    title={
                      allergy.reaction
                        ? `${allergy.display ?? 'Allergy'} — ${allergy.reaction}`
                        : allergy.display ??
                          'Allergy'
                    }
                  >

                    <AlertTriangle
                      size={12}
                    />


                    <strong>
                      {allergy.display ??
                        'Unknown allergen'}
                    </strong>


                    {allergy.reaction && (

                      <span>
                        · {allergy.reaction}
                      </span>

                    )}

                  </button>

                );

              },
            )}

          </div>

        )}

      </div>


      {/* =================================================
          ENCOUNTER INFORMATION
      ================================================= */}

      <section className="encounter-information-bar">

        <EncounterInfo
          icon={
            getEncounterIcon(
              encounter.encounterType,
            )
          }
          label="Encounter Type"
          value={
            encounter.encounterTypeDisplay ||
            encounter.classDisplay ||
            '-'
          }
        />


        <EncounterInfo
          icon={
            <Stethoscope
              size={17}
            />
          }
          label="Department"
          value={
            encounter.department ||
            '-'
          }
        />


        <EncounterInfo
          icon={
            <UserRound
              size={17}
            />
          }
          label="Physician"
          value={
            encounter.practitionerName ||
            'Not assigned'
          }
        />


        <EncounterInfo
          icon={
            <Calendar
              size={17}
            />
          }
          label="Started"
          value={
            formatDateTime(
              encounter.startDateTime,
            )
          }
        />

      </section>


      {/* =================================================
          FINISHED MESSAGE
      ================================================= */}

      {isFinished && (

        <section className="encounter-finished-banner">

          <CheckCircle2
            size={18}
          />


          <div>

            <strong>
              Encounter Finished
            </strong>


            <span>
              This encounter is closed. Clinical documentation is displayed in read-only mode.
            </span>

          </div>

        </section>

      )}


      {/* =================================================
          REASON FOR VISIT
      ================================================= */}

      {encounter.reason && (

        <section className="encounter-reason">

          <div className="encounter-reason-icon">

            <ClipboardList
              size={18}
            />

          </div>


          <div>

            <span>
              Reason for Visit
            </span>


            <strong>
              {encounter.reason}
            </strong>

          </div>

        </section>

      )}


      {/* =================================================
          WORKSPACE NAVIGATION
      ================================================= */}

      <nav className="encounter-navigation">

        {/* OVERVIEW */}

        <WorkspaceTabButton
          active={
            activeTab ===
            'overview'
          }
          label="Overview"
          icon={
            <HeartPulse
              size={16}
            />
          }
          onClick={() =>
            setActiveTab(
              'overview',
            )
          }
        />


        {/* VITALS */}

        <WorkspaceTabButton
          active={
            activeTab ===
            'vitals'
          }
          label="Vitals"
          icon={
            hasAbnormalVitals ? (

              <AlertTriangle
                size={16}
              />

            ) : (

              <Activity
                size={16}
              />

            )
          }
          alert={
            hasAbnormalVitals
          }
          alertCount={
            abnormalVitals.length
          }
          title={
            hasAbnormalVitals
              ? abnormalVitals.join(
                  ' • ',
                )
              : undefined
          }
          onClick={() =>
            setActiveTab(
              'vitals',
            )
          }
        />


        {/* CLINICAL NOTES */}

        <WorkspaceTabButton
          active={
            activeTab ===
            'notes'
          }
          label="Clinical Notes"
          icon={
            <FileText
              size={16}
            />
          }
          onClick={() =>
            setActiveTab(
              'notes',
            )
          }
        />


        {/* DIAGNOSIS */}

        <WorkspaceTabButton
          active={
            activeTab ===
            'diagnosis'
          }
          label="Diagnosis"
          icon={
            <Stethoscope
              size={16}
            />
          }
          onClick={() =>
            setActiveTab(
              'diagnosis',
            )
          }
        />


        {/* ALLERGIES */}

        <WorkspaceTabButton
          active={
            activeTab ===
            'allergies'
          }
          label="Allergies"
          icon={
            <AlertTriangle
              size={16}
            />
          }
          onClick={() =>
            setActiveTab(
              'allergies',
            )
          }
        />


        {/* MEDICATIONS */}

        <WorkspaceTabButton
          active={
            activeTab ===
            'medications'
          }
          label="Medications"
          icon={
            <Pill
              size={16}
            />
          }
          onClick={() =>
            setActiveTab(
              'medications',
            )
          }
        />


        {/* LAB */}

        <WorkspaceTabButton
          active={
            activeTab ===
            'laboratory'
          }
          label="Laboratory"
          icon={
            <FlaskConical
              size={16}
            />
          }
          onClick={() =>
            setActiveTab(
              'laboratory',
            )
          }
        />


        {/* RADIOLOGY */}

        <WorkspaceTabButton
          active={
            activeTab ===
            'radiology'
          }
          label="Radiology"
          icon={
            <Microscope
              size={16}
            />
          }
          onClick={() =>
            setActiveTab(
              'radiology',
            )
          }
        />

        <WorkspaceTabButton
          active={activeTab === 'journey'}
          label="Patient Journey"
          icon={<GitBranch size={16} />}
          onClick={() => setActiveTab('journey')}
        />

      </nav>


      {/* =================================================
          CONTENT
      ================================================= */}

      <main className="encounter-content">

        {/* =================================================
            OVERVIEW
        ================================================= */}

        {activeTab ===
          'overview' && (

          <EncounterOverview
            encounter={
              encounter
            }
            allergies={
              patientAllergies
            }
            onOpenAllergies={() =>
              setActiveTab(
                'allergies',
              )
            }
          />

        )}


        {/* =================================================
            VITALS
        ================================================= */}

        {activeTab ===
          'vitals' &&
          hospitalId &&
          patientId &&
          encounterId && (

            <VitalsPanel
              hospitalId={
                hospitalId
              }
              patientId={
                patientId
              }
              encounterId={
                encounterId
              }
              readOnly={
                isFinished
              }
            />

          )}


        {/* =================================================
            CLINICAL NOTES
        ================================================= */}

       {activeTab ===
  'notes' &&
  hospitalId &&
  patientId &&
  encounterId && (

    <ClinicalNotesPanel
      hospitalId={hospitalId}
      patientId={patientId}
      encounterId={encounterId}
      practitionerName={
        encounter.practitionerName
      }
      readOnly={isFinished}
    />

)}


        {/* =================================================
            DIAGNOSIS
        ================================================= */}

        {activeTab ===
          'diagnosis' &&
          hospitalId &&
          patientId &&
          encounterId && (

            <DiagnosisPanel
              hospitalId={
                hospitalId
              }
              patientId={
                patientId
              }
              encounterId={
                encounterId
              }
              readOnly={
                isFinished
              }
            />

          )}


        {/* =================================================
            ALLERGIES
        ================================================= */}

        {activeTab ===
          'allergies' &&
          hospitalId &&
          patientId && (

            <AllergiesPanel
              hospitalId={
                hospitalId
              }
              patientId={
                patientId
              }
              encounterId={
                encounterId
              }
              readOnly={
                isFinished
              }
            />

          )}


        {/* =================================================
            MEDICATIONS
        ================================================= */}

        {activeTab ===
          'medications' &&
          hospitalId &&
          patientId &&
          encounterId && (

            <MedicationPanel
              hospitalId={
                hospitalId
              }
              patientId={
                patientId
              }
              encounterId={
                encounterId
              }
              readOnly={
                isFinished
              }
            />

          )}


        {/* =================================================
            LABORATORY
        ================================================= */}

      {activeTab === 'laboratory' &&
  hospitalId &&
  patientId &&
  encounterId && (
    <LaboratoryPanel
      hospitalId={hospitalId}
      patientId={patientId}
      encounterId={encounterId}
    />
)}


        {/* =================================================
            RADIOLOGY
        ================================================= */}

        {activeTab === 'radiology' && hospitalId && patientId && encounterId && (
          <RadiologyPanel
            hospitalId={hospitalId}
            patientId={patientId}
            encounterId={encounterId}
            practitionerName={encounter.practitionerName}
            readOnly={isFinished}
          />
        )}

        {activeTab === 'journey' && hospitalId && patientId && encounterId && (
          <PatientJourneyPanel hospitalId={hospitalId} patientId={patientId} encounterId={encounterId} />
        )}

      </main>

      {hospitalId && (
        <DispositionModal
          open={dispositionOpen}
          hospitalId={hospitalId}
          saving={finishing}
          error={dispositionError}
          onClose={() => setDispositionOpen(false)}
          onSubmit={(payload) => void handleFinishEncounter(payload)}
        />
      )}

    </div>

  );

}


/* =========================================================
   OVERVIEW
========================================================= */

function EncounterOverview({
  encounter,
  allergies,
  onOpenAllergies,
}: {
  encounter:
    EncounterResponse;

  allergies:
    AllergyResponse[];

  onOpenAllergies:
    () => void;
}) {

  const highRiskAllergies =
    allergies.filter(
      (
        allergy,
      ) =>
        allergy.criticality ===
          'high' ||
        allergy.severity ===
          'severe',
    );


  return (

    <div className="encounter-overview-grid">

      {/* =================================================
          MAIN COLUMN
      ================================================= */}

      <div className="encounter-main-column">

        <ClinicalSection
          title="Clinical Summary"
          subtitle="Current encounter documentation"
        >

          <div className="clinical-summary-empty">

            <FileText
              size={24}
            />


            <strong>
              Clinical documentation has not started
            </strong>


            <span>
              Record vitals, clinical notes, diagnoses and orders for this encounter.
            </span>

          </div>

        </ClinicalSection>


        <ClinicalSection
          title="Chief Complaint"
          subtitle="Primary reason for today's visit"
        >

          <div className="chief-complaint-display">

            {encounter.reason ? (

              <p>
                {encounter.reason}
              </p>

            ) : (

              <span>
                No chief complaint recorded.
              </span>

            )}

          </div>

        </ClinicalSection>

      </div>


      {/* =================================================
          SIDE COLUMN
      ================================================= */}

      <div className="encounter-side-column">

        <ClinicalSection
          title="Clinical Alerts"
        >

          <button
            type="button"
            className={
              highRiskAllergies.length >
              0
                ? 'clinical-alert-item allergy-danger'
                : 'clinical-alert-item neutral'
            }
            onClick={
              onOpenAllergies
            }
          >

            <span className="clinical-alert-dot" />


            <div>

              <strong>
                Allergies
              </strong>


              {allergies.length ===
              0 ? (

                <span>
                  No active allergies recorded
                </span>

              ) : (

                <span>

                  {allergies
                    .map(
                      (
                        allergy,
                      ) =>
                        allergy.display ??
                        'Unknown allergen',
                    )
                    .join(', ')}

                </span>

              )}

            </div>

          </button>


          <div className="clinical-alert-item neutral">

            <span className="clinical-alert-dot" />


            <div>

              <strong>
                Active Problems
              </strong>


              <span>
                Review Diagnosis tab for active clinical problems
              </span>

            </div>

          </div>

        </ClinicalSection>


        <ClinicalSection
          title="Encounter Details"
        >

          <DetailRow
            label="Status"
            value={
              encounter.status ||
              '-'
            }
          />


          <DetailRow
            label="Type"
            value={
              encounter.encounterTypeDisplay ||
              '-'
            }
          />


          <DetailRow
            label="Department"
            value={
              encounter.department ||
              '-'
            }
          />


          <DetailRow
            label="Physician"
            value={
              encounter.practitionerName ||
              'Not assigned'
            }
          />


          <DetailRow
            label="Started"
            value={
              formatDateTime(
                encounter.startDateTime,
              )
            }
          />


          {encounter.endDateTime && (

            <DetailRow
              label="Finished"
              value={
                formatDateTime(
                  encounter.endDateTime,
                )
              }
            />

          )}

        </ClinicalSection>

      </div>

    </div>

  );

}


/* =========================================================
   CLINICAL SECTION
========================================================= */

function ClinicalSection({
  title,
  subtitle,
  children,
}: {
  title:
    string;

  subtitle?:
    string;

  children:
    React.ReactNode;
}) {

  return (

    <section className="clinical-section">

      <header className="clinical-section-header">

        <div>

          <h2>
            {title}
          </h2>


          {subtitle && (

            <p>
              {subtitle}
            </p>

          )}

        </div>

      </header>


      <div className="clinical-section-body">
        {children}
      </div>

    </section>

  );

}


/* =========================================================
   ENCOUNTER INFO
========================================================= */

function EncounterInfo({
  icon,
  label,
  value,
}: {
  icon:
    React.ReactNode;

  label:
    string;

  value:
    string;
}) {

  return (

    <div className="encounter-info-item">

      <div className="encounter-info-icon">
        {icon}
      </div>


      <div>

        <span>
          {label}
        </span>


        <strong>
          {value}
        </strong>

      </div>

    </div>

  );

}


/* =========================================================
   ENCOUNTER STATUS
========================================================= */

function EncounterStatus({
  status,
}: {
  status?:
    string;
}) {

  const finished =
    status ===
    'finished';


  return (

    <span
      className={
        finished
          ? 'encounter-status finished'
          : 'encounter-status active'
      }
    >

      <span />


      {finished
        ? 'Finished'
        : 'In Progress'}

    </span>

  );

}


/* =========================================================
   WORKSPACE TAB
========================================================= */

function WorkspaceTabButton({
  active,
  label,
  icon,
  onClick,
  alert = false,
  alertCount = 0,
  title,
}: {
  active:
    boolean;

  label:
    string;

  icon:
    React.ReactNode;

  onClick:
    () => void;

  alert?:
    boolean;

  alertCount?:
    number;

  title?:
    string;
}) {

  let className =
    'encounter-nav-button';


  if (active) {

    className +=
      ' active';

  }


  if (alert) {

    className +=
      ' vital-alert';

  }


  return (

    <button
      type="button"
      className={
        className
      }
      onClick={
        onClick
      }
      title={
        title
      }
    >

      {icon}


      <span>
        {label}
      </span>


      {alert &&
        alertCount > 0 && (

          <span className="vitals-alert-count">
            {alertCount}
          </span>

        )}

    </button>

  );

}


/* =========================================================
   DETAIL ROW
========================================================= */

function DetailRow({
  label,
  value,
}: {
  label:
    string;

  value:
    string;
}) {

  return (

    <div className="encounter-detail-row">

      <span>
        {label}
      </span>


      <strong>
        {value}
      </strong>

    </div>

  );

}


/* =========================================================
   AGE
========================================================= */

function calculateAge(
  birthDate?:
    string,
) {

  if (!birthDate) {

    return undefined;

  }


  const birth =
    new Date(
      birthDate,
    );


  const today =
    new Date();


  let age =
    today.getFullYear() -
    birth.getFullYear();


  const month =
    today.getMonth() -
    birth.getMonth();


  if (
    month < 0 ||
    (
      month === 0 &&
      today.getDate() <
        birth.getDate()
    )
  ) {

    age--;

  }


  return age;

}


/* =========================================================
   FORMAT GENDER
========================================================= */

function formatGender(
  gender?:
    string,
) {

  if (!gender) {

    return '-';

  }


  return (
    gender
      .charAt(0)
      .toUpperCase() +
    gender.slice(1)
  );

}


/* =========================================================
   FORMAT DATE
========================================================= */

function formatDateTime(
  value?:
    string,
) {

  if (!value) {

    return '-';

  }


  const date =
    new Date(
      value,
    );


  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {

    return value;

  }


  return date.toLocaleString();

}


/* =========================================================
   ENCOUNTER ICON
========================================================= */

function getEncounterIcon(
  type?:
    string,
) {

  switch (type) {

    case 'emergency':

      return (

        <Activity
          size={17}
        />

      );


    case 'inpatient':

      return (

        <BedDouble
          size={17}
        />

      );


    default:

      return (

        <Stethoscope
          size={17}
        />

      );

  }

}


/* =========================================================
   ABNORMAL VITALS
========================================================= */

function getAbnormalVitals(
  vitals:
    VitalResult[],
):
  string[] {

  const latest =
    getLatestVitalValues(
      vitals,
    );


  const alerts:
    string[] = [];


  /* =====================================================
     BLOOD PRESSURE
  ===================================================== */

  const bp =
    latest[
      'blood-pressure'
    ];


  if (
    bp?.systolic !==
      undefined &&
    bp?.diastolic !==
      undefined
  ) {

    if (
      bp.systolic < 90 ||
      bp.systolic >= 140 ||
      bp.diastolic < 60 ||
      bp.diastolic >= 90
    ) {

      alerts.push(
        `BP ${bp.systolic}/${bp.diastolic} mmHg`,
      );

    }

  } else if (
    typeof bp?.value ===
    'string'
  ) {

    const parsed =
      parseBloodPressure(
        bp.value,
      );


    if (
      parsed &&
      (
        parsed.systolic < 90 ||
        parsed.systolic >= 140 ||
        parsed.diastolic < 60 ||
        parsed.diastolic >= 90
      )
    ) {

      alerts.push(
        `BP ${parsed.systolic}/${parsed.diastolic} mmHg`,
      );

    }

  }


  /* =====================================================
     PULSE
  ===================================================== */

  const pulse =
    toNumber(
      latest.pulse
        ?.value,
    );


  if (
    pulse !== undefined &&
    (
      pulse < 60 ||
      pulse > 100
    )
  ) {

    alerts.push(
      `Pulse ${pulse} bpm`,
    );

  }


  /* =====================================================
     TEMPERATURE
  ===================================================== */

  const temperature =
    toNumber(
      latest.temperature
        ?.value,
    );


  if (
    temperature !==
      undefined &&
    (
      temperature < 35 ||
      temperature >= 38
    )
  ) {

    alerts.push(
      `Temperature ${temperature} °C`,
    );

  }


  /* =====================================================
     RESPIRATORY RATE
  ===================================================== */

  const respiratoryRate =
    toNumber(
      latest[
        'respiratory-rate'
      ]?.value,
    );


  if (
    respiratoryRate !==
      undefined &&
    (
      respiratoryRate < 12 ||
      respiratoryRate > 20
    )
  ) {

    alerts.push(
      `Respiratory Rate ${respiratoryRate}/min`,
    );

  }


  /* =====================================================
     SPO2
  ===================================================== */

  const spo2 =
    toNumber(
      latest.spo2
        ?.value,
    );


  if (
    spo2 !==
      undefined &&
    spo2 < 95
  ) {

    alerts.push(
      `SpO₂ ${spo2}%`,
    );

  }


  /* =====================================================
     PAIN
  ===================================================== */

  const pain =
    toNumber(
      latest[
        'pain-score'
      ]?.value,
    );


  if (
    pain !== undefined &&
    pain >= 7
  ) {

    alerts.push(
      `Pain ${pain}/10`,
    );

  }


  return alerts;

}


/* =========================================================
   LATEST VITALS
========================================================= */

function getLatestVitalValues(
  vitals:
    VitalResult[],
) {

  const latest:
    Record<
      string,
      VitalResult
    > = {};


  for (
    const vital
    of vitals
  ) {

    if (
      vital.type &&
      !latest[
        vital.type
      ]
    ) {

      latest[
        vital.type
      ] =
        vital;

    }

  }


  return latest;

}


/* =========================================================
   PARSE BLOOD PRESSURE
========================================================= */

function parseBloodPressure(
  value:
    string,
) {

  const match =
    value.match(
      /(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/,
    );


  if (!match) {

    return undefined;

  }


  const systolic =
    Number(
      match[1],
    );


  const diastolic =
    Number(
      match[2],
    );


  if (
    Number.isNaN(
      systolic,
    ) ||
    Number.isNaN(
      diastolic,
    )
  ) {

    return undefined;

  }


  return {
    systolic,
    diastolic,
  };

}


/* =========================================================
   NUMBER HELPER
========================================================= */

function toNumber(
  value?:
    number |
    string,
) {

  if (
    value ===
      undefined ||
    value ===
      null ||
    value ===
      ''
  ) {

    return undefined;

  }


  const result =
    Number(
      value,
    );


  if (
    Number.isNaN(
      result,
    )
  ) {

    return undefined;

  }


  return result;

}
