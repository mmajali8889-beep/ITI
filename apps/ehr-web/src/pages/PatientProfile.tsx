


import {
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  useNavigate,
  useParams,
} from 'react-router-dom';

import {
  AlertOctagon,
  AlertTriangle,
  ArrowLeft,
  Plus,
  Printer,
  ShieldCheck,
} from 'lucide-react';


/* =========================================================
   API
========================================================= */

import {
  getPatient,
} from '../api/patientApi';

import {
  getPatientAllergies,
} from '../api/allergyApi';


/* =========================================================
   TYPES
========================================================= */

import type {
  PatientProfile as PatientProfileType,
} from '../types/patient';

import type {
  AllergyResponse,
} from '../types/allergy';


/* =========================================================
   COMPONENTS
========================================================= */

import NewEncounterModal
  from '../components/NewEncounterModal';

import PatientEncounters
  from '../components/PatientEncounters';

import PatientVitals
  from '../components/PatientVitals';

import PatientProblems
  from '../components/PatientProblems';

import PatientAllergies
  from '../components/PatientAllergies';
  import PatientMedications
  from '../components/PatientMedications';
  import PatientClinicalNotes
  from '../components/PatientClinicalNotes';

import PatientLaboratory from '../components/PatientLaboratory';

import PatientRadiology from '../components/PatientRadiology';

import PatientPortalAccess from '../components/PatientPortalAccess';

import { useAuth } from '../context/useAuth';

import { canAccess } from '../auth/permissions';

/* =========================================================
   CSS
========================================================= */

import './PatientProfile.css';


/* =========================================================
   TABS
========================================================= */

const tabs = [
  'Summary',
  'Encounters',
  'Vitals',
  'Problems',
  'Allergies',
  'Medications',
  'Clinical Notes',
  'Laboratory',
  'Radiology',
  'Documents',
  'Timeline',
];


/* =========================================================
   PAGE
========================================================= */

export default function PatientProfile() {

  const navigate =
    useNavigate();


  const {
    hospitalId,
    patientId,
  } =
    useParams();


  const { session } = useAuth();

  // Portal logins are managed by medical records (HIM) staff and administrators.
  const canManagePortal =
    canAccess(
      session?.user.permissions,
      'medical-records',
    );


  /* =======================================================
     STATE
  ======================================================= */

  const [
    patient,
    setPatient,
  ] =
    useState<PatientProfileType | null>(
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
    activeTab,
    setActiveTab,
  ] =
    useState(
      'Summary',
    );


  const [
    loading,
    setLoading,
  ] =
    useState(
      true,
    );


  const [
    error,
    setError,
  ] =
    useState(
      '',
    );


  const [
    encounterModalOpen,
    setEncounterModalOpen,
  ] =
    useState(
      false,
    );


  /* =======================================================
     LOAD PATIENT
  ======================================================= */

  useEffect(() => {

    if (!patientId) {

      setError(
        'Patient ID is missing.',
      );

      setLoading(
        false,
      );

      return;

    }


    async function loadPatient() {

      try {

        setLoading(
          true,
        );

        setError(
          '',
        );


        const data =
          await getPatient(
            patientId!,
            hospitalId!,
          );


        setPatient(
          data,
        );


      } catch (err) {

        console.error(
          'Failed to load patient:',
          err,
        );


        setError(
          'Unable to load patient.',
        );


      } finally {

        setLoading(
          false,
        );

      }

    }


    void loadPatient();


  }, [
    patientId,
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


    async function loadAllergies() {

      try {

        const result =
          await getPatientAllergies(
            patientId!,
          );


        setPatientAllergies(
          result.allergies ??
          [],
        );


      } catch (err) {

        console.error(
          'Unable to load patient allergies:',
          err,
        );


        /*
         * Allergy loading should not prevent
         * the Patient Chart from opening.
         */

        setPatientAllergies(
          [],
        );

      }

    }


    void loadAllergies();


  }, [
    patientId,
  ]);


  /* =======================================================
     ENCOUNTER CREATED
  ======================================================= */

  function handleEncounterCreated(
    encounterId: string,
  ) {

    if (
      !hospitalId ||
      !patientId
    ) {

      return;

    }


    setEncounterModalOpen(
      false,
    );


    navigate(
      `/hospital/${hospitalId}/patient/${patientId}/encounter/${encounterId}`,
    );

  }


  /* =======================================================
     LOADING
  ======================================================= */

  if (loading) {

    return (

      <div className="patient-loading">

        Loading patient...

      </div>

    );

  }


  /* =======================================================
     ERROR
  ======================================================= */

  if (
    error ||
    !patient
  ) {

    return (

      <div className="patient-error">

        <p>

          {error ||
            'Patient not found.'}

        </p>


        <button
          type="button"
          onClick={() =>
            navigate(
              `/hospital/${hospitalId}/patients`,
            )
          }
        >

          Back to Patient Search

        </button>

      </div>

    );

  }


  /* =======================================================
     PAGE
  ======================================================= */

  return (

    <>

      <div className="patient-profile">

        {/* ===============================================
            BACK
        =============================================== */}

        <button
          type="button"
          className="back-button"
          onClick={() =>
            navigate(
              `/hospital/${hospitalId}/patients`,
            )
          }
        >

          <ArrowLeft
            size={16}
          />

          Back to Patient Search

        </button>


        {/* ===============================================
            PATIENT BANNER
        =============================================== */}

        <PatientBanner
          patient={
            patient
          }
          allergies={
            patientAllergies
          }
          onOpenAllergies={() =>
            setActiveTab(
              'Allergies',
            )
          }
          onNewEncounter={() =>
            setEncounterModalOpen(
              true,
            )
          }
        />


        {/* ===============================================
            PATIENT NAVIGATION
        =============================================== */}

        <nav className="patient-tabs">

          {tabs.map(
            (
              tab,
            ) => (

              <button
                type="button"
                key={
                  tab
                }
                className={
                  activeTab ===
                  tab
                    ? 'patient-tab active'
                    : 'patient-tab'
                }
                onClick={() =>
                  setActiveTab(
                    tab,
                  )
                }
              >

                {tab}

              </button>

            ),
          )}

        </nav>


        {/* ===============================================
            WORKSPACE
        =============================================== */}

        <section className="patient-workspace">

          {/* SUMMARY */}

          {activeTab ===
            'Summary' && (

            <PatientSummary
              patient={
                patient
              }
              allergies={
                patientAllergies
              }
              onOpenAllergies={() =>
                setActiveTab(
                  'Allergies',
                )
              }
            />

          )}


          {/* PORTAL ACCESS */}

          {activeTab ===
            'Summary' &&
            canManagePortal &&
            patientId &&
            hospitalId && (

              <PatientPortalAccess
                hospitalId={
                  hospitalId
                }
                patientId={
                  patientId
                }
                suggestedUsername={
                  patient.email ??
                  patient.hospitalMrn?.toLowerCase()
                }
              />

            )}


          {/* ENCOUNTERS */}

          {activeTab ===
            'Encounters' &&
            patientId &&
            hospitalId && (

              <PatientEncounters
                patientId={
                  patientId
                }
                hospitalId={
                  hospitalId
                }
              />

            )}


          {/* VITALS */}

          {activeTab ===
            'Vitals' &&
            patientId &&
            hospitalId && (

              <PatientVitals
                patientId={
                  patientId
                }
                hospitalId={
                  hospitalId
                }
              />

            )}


          {/* PROBLEMS */}

          {activeTab ===
            'Problems' &&
            patientId &&
            hospitalId && (

              <PatientProblems
                patientId={
                  patientId
                }
                hospitalId={
                  hospitalId
                }
              />

            )}


          {/* ALLERGIES */}

          {activeTab ===
            'Allergies' &&
            patientId &&
            hospitalId && (

              <PatientAllergies
                patientId={
                  patientId
                }
                hospitalId={
                  hospitalId
                }
              />

            )}
			
			{activeTab ===
  'Medications' &&
  patientId &&
  hospitalId && (

    <PatientMedications
      patientId={
        patientId
      }
      hospitalId={
        hospitalId
      }
    />

)}

{activeTab ===
  'Clinical Notes' &&
  patientId &&
  hospitalId && (

    <PatientClinicalNotes
      patientId={
        patientId
      }
      hospitalId={
        hospitalId
      }
    />

)}

{activeTab === 'Laboratory' && (
  <PatientLaboratory
    patientId={patientId!}
    hospitalId={hospitalId!}
  />
)}

{activeTab === 'Radiology' && patientId && (
  <PatientRadiology
    patientId={patientId}
    patientName={patient.nameEn ?? patient.nameAr}
    mrn={patient.hospitalMrn}
  />
)}


          {/* =================================================
              MODULES NOT YET IMPLEMENTED
          ================================================= */}

          {[ 
            'Radiology',
            'Documents',
            'Timeline',
          ].includes(
            activeTab,
          ) && (

            <EmptyClinicalModule
              title={
                activeTab
              }
            />

          )}

        </section>

      </div>


      {/* =================================================
          NEW ENCOUNTER MODAL
      ================================================= */}

      {hospitalId &&
        patientId && (

          <NewEncounterModal
            open={
              encounterModalOpen
            }
            patientId={
              patientId
            }
            hospitalId={
              hospitalId
            }
            onClose={() =>
              setEncounterModalOpen(
                false,
              )
            }
            onCreated={
              handleEncounterCreated
            }
          />

        )}

    </>

  );

}


/* =========================================================
   PATIENT BANNER
========================================================= */

function PatientBanner({
  patient,
  allergies,
  onNewEncounter,
  onOpenAllergies,
}: {
  patient:
    PatientProfileType;

  allergies:
    AllergyResponse[];

  onNewEncounter:
    () => void;

  onOpenAllergies:
    () => void;
}) {

  const age =
    calculateAge(
      patient.birthDate,
    );


  /* =====================================================
     ACTIVE ALLERGIES
  ===================================================== */

  const activeAllergies =
    useMemo(
      () =>
        allergies.filter(
          (
            allergy,
          ) =>
            allergy.clinicalStatus ===
              'active' &&
            allergy.verificationStatus !==
              'refuted' &&
            allergy.verificationStatus !==
              'entered-in-error',
        ),
      [allergies],
    );


  /* =====================================================
     HIGH-RISK ALLERGIES
  ===================================================== */

  const criticalAllergies =
    useMemo(
      () =>
        activeAllergies.filter(
          (
            allergy,
          ) =>
            allergy.criticality ===
              'high' ||
            allergy.severity ===
              'severe',
        ),
      [activeAllergies],
    );


  const hasCriticalAllergy =
    criticalAllergies.length >
    0;


  return (

    <section
      className={
        hasCriticalAllergy
          ? 'patient-banner has-critical-allergy'
          : 'patient-banner'
      }
    >

      {/* =================================================
          MAIN BANNER ROW
      ================================================= */}

      <div className="patient-banner-main-row">

        {/* AVATAR */}

        <div className="patient-avatar">

          {(
            patient.nameEn ??
            patient.nameAr ??
            'P'
          )
            .charAt(0)
            .toUpperCase()}

        </div>


        {/* PATIENT DETAILS */}

        <div className="patient-main-info">

          <h1>

            {patient.nameEn ??
              patient.nameAr ??
              'Unknown Patient'}

          </h1>


          {patient.nameAr && (

            <div
              className="arabic-name"
              dir="rtl"
            >

              {patient.nameAr}

            </div>

          )}


          <div className="patient-demographics">

            <span>

              MRN:

              <strong>

                {' '}

                {patient.hospitalMrn ??
                  '-'}

              </strong>

            </span>


            <span>

              Gender:

              <strong>

                {' '}

                {formatGender(
                  patient.gender,
                )}

              </strong>

            </span>


            <span>

              DOB:

              <strong>

                {' '}

                {patient.birthDate ??
                  '-'}

              </strong>

            </span>


            {age !==
              undefined && (

              <span>

                Age:

                <strong>

                  {' '}
                  {age}

                </strong>

              </span>

            )}

          </div>

        </div>


        {/* ACTIONS */}

        <div className="patient-banner-actions">

          <button
            type="button"
            className="primary-action"
            onClick={
              onNewEncounter
            }
          >

            <Plus
              size={16}
            />

            New Encounter

          </button>


          <button
            type="button"
            className="secondary-action"
            onClick={() =>
              window.print()
            }
          >

            <Printer
              size={16}
            />

            Print

          </button>

        </div>

      </div>


      {/* =================================================
          ALLERGY SAFETY STRIP
      ================================================= */}

      <PatientAllergySafetyStrip
        activeAllergies={
          activeAllergies
        }
        criticalAllergies={
          criticalAllergies
        }
        onOpenAllergies={
          onOpenAllergies
        }
      />

    </section>

  );

}


/* =========================================================
   PATIENT ALLERGY SAFETY STRIP
========================================================= */

function PatientAllergySafetyStrip({
  activeAllergies,
  criticalAllergies,
  onOpenAllergies,
}: {
  activeAllergies:
    AllergyResponse[];

  criticalAllergies:
    AllergyResponse[];

  onOpenAllergies:
    () => void;
}) {

  /* =====================================================
     NO KNOWN ACTIVE ALLERGIES
  ===================================================== */

  if (
    activeAllergies.length ===
    0
  ) {

    return (

      <button
        type="button"
        className="patient-banner-allergy-strip nkda"
        onClick={
          onOpenAllergies
        }
      >

        <div className="patient-banner-allergy-icon">

          <ShieldCheck
            size={16}
          />

        </div>


        <div className="patient-banner-allergy-copy">

          <strong>
            No Active Allergies Recorded
          </strong>

          <span>
            Click to review the patient's allergy history
          </span>

        </div>

      </button>

    );

  }


  /* =====================================================
     CRITICAL ALLERGY
  ===================================================== */

  if (
    criticalAllergies.length >
    0
  ) {

    return (

      <button
        type="button"
        className="patient-banner-allergy-strip critical"
        onClick={
          onOpenAllergies
        }
      >

        <div className="patient-banner-allergy-icon">

          <AlertOctagon
            size={18}
          />

        </div>


        <div className="patient-banner-allergy-copy">

          <div className="patient-banner-allergy-title">

            <strong>
              CRITICAL ALLERGY
            </strong>

            <span>
              HIGH RISK
            </span>

          </div>


          <div className="patient-banner-allergy-items">

            {criticalAllergies.map(
              (
                allergy,
              ) => (

                <span
                  key={
                    allergy.id ??
                    `${allergy.code}-${allergy.display}`
                  }
                  className="patient-banner-allergy-chip critical"
                >

                  <AlertTriangle
                    size={10}
                  />


                  <strong>

                    {allergy.display ??
                      'Unknown Allergy'}

                  </strong>


                  {allergy.reaction && (

                    <em>

                      {allergy.reaction}

                    </em>

                  )}

                </span>

              ),
            )}

          </div>

        </div>


        <span className="patient-banner-allergy-open">
          Review Allergies →
        </span>

      </button>

    );

  }


  /* =====================================================
     ACTIVE NON-CRITICAL ALLERGIES
  ===================================================== */

  return (

    <button
      type="button"
      className="patient-banner-allergy-strip warning"
      onClick={
        onOpenAllergies
      }
    >

      <div className="patient-banner-allergy-icon">

        <AlertTriangle
          size={17}
        />

      </div>


      <div className="patient-banner-allergy-copy">

        <strong>
          Active Allergies
        </strong>


        <div className="patient-banner-allergy-items">

          {activeAllergies.map(
            (
              allergy,
            ) => (

              <span
                key={
                  allergy.id ??
                  `${allergy.code}-${allergy.display}`
                }
                className="patient-banner-allergy-chip"
              >

                {allergy.display ??
                  'Unknown Allergy'}

              </span>

            ),
          )}

        </div>

      </div>


      <span className="patient-banner-allergy-open">
        Review Allergies →
      </span>

    </button>

  );

}


/* =========================================================
   PATIENT SUMMARY
========================================================= */

function PatientSummary({
  patient,
  allergies,
  onOpenAllergies,
}: {
  patient:
    PatientProfileType;

  allergies:
    AllergyResponse[];

  onOpenAllergies:
    () => void;
}) {

  const activeAllergies =
    allergies.filter(
      (
        allergy,
      ) =>
        allergy.clinicalStatus ===
          'active',
    );


  const criticalAllergies =
    activeAllergies.filter(
      (
        allergy,
      ) =>
        allergy.criticality ===
          'high' ||
        allergy.severity ===
          'severe',
    );


  return (

    <div className="summary-grid">

      {/* =================================================
          PATIENT INFORMATION
      ================================================= */}

      <SummaryCard
        title="Patient Information"
      >

        <InfoRow
          label="Enterprise MRN"
          value={
            patient.enterpriseMrn
          }
        />


        <InfoRow
          label="Hospital MRN"
          value={
            patient.hospitalMrn
          }
        />


        <InfoRow
          label="National ID"
          value={
            patient.nationalId
          }
        />


        <InfoRow
          label="Passport"
          value={
            patient.passportNumber
          }
        />


        <InfoRow
          label="Mobile"
          value={
            patient.phone
          }
        />

      </SummaryCard>


      {/* =================================================
          DEMOGRAPHICS
      ================================================= */}

      <SummaryCard
        title="Demographics"
      >

        <InfoRow
          label="Gender"
          value={
            formatGender(
              patient.gender,
            )
          }
        />


        <InfoRow
          label="Date of Birth"
          value={
            patient.birthDate
          }
        />


        <InfoRow
          label="Age"
          value={
            patient.birthDate
              ? `${calculateAge(
                  patient.birthDate,
                )} years`
              : undefined
          }
        />


        <InfoRow
          label="Nationality"
          value={
            patient.nationality
          }
        />

      </SummaryCard>


      {/* =================================================
          ADDRESS
      ================================================= */}

      <SummaryCard
        title="Address"
      >

        <InfoRow
          label="Address"
          value={
            patient.address
              ?.line?.join(
                ', ',
              )
          }
        />


        <InfoRow
          label="City"
          value={
            patient.address
              ?.city
          }
        />


        <InfoRow
          label="Country"
          value={
            patient.address
              ?.country
          }
        />

      </SummaryCard>


      {/* =================================================
          NEXT OF KIN
      ================================================= */}

      <SummaryCard
        title="Next of Kin"
      >

        <InfoRow
          label="Name"
          value={
            patient.nextOfKin
              ?.name?.text
          }
        />


        <InfoRow
          label="Relationship"
          value={
            patient.nextOfKin
              ?.relationship?.[0]
              ?.text
          }
        />


        <InfoRow
          label="Phone"
          value={
            patient.nextOfKin
              ?.telecom?.[0]
              ?.value
          }
        />

      </SummaryCard>


      {/* =================================================
          CLINICAL ALERTS
      ================================================= */}

      <SummaryCard
        title="Clinical Alerts"
      >

        {activeAllergies.length ===
        0 ? (

          <button
            type="button"
            className="clinical-alert empty"
            onClick={
              onOpenAllergies
            }
          >

            <ShieldCheck
              size={14}
            />

            No active allergies recorded

          </button>

        ) : (

          <button
            type="button"
            className={
              criticalAllergies.length >
              0
                ? 'clinical-alert allergy-critical'
                : 'clinical-alert allergy-warning'
            }
            onClick={
              onOpenAllergies
            }
          >

            {criticalAllergies.length >
            0 ? (

              <AlertOctagon
                size={15}
              />

            ) : (

              <AlertTriangle
                size={15}
              />

            )}


            <div>

              <strong>

                {criticalAllergies.length >
                0
                  ? 'Critical Allergy'
                  : 'Active Allergies'}

              </strong>


              <span>

                {activeAllergies
                  .map(
                    (
                      allergy,
                    ) =>
                      allergy.display ??
                      'Unknown Allergy',
                  )
                  .join(', ')}

              </span>

            </div>

          </button>

        )}


        <div className="clinical-alert empty">

          No active problems

        </div>

      </SummaryCard>

    </div>

  );

}


/* =========================================================
   SUMMARY CARD
========================================================= */

function SummaryCard({
  title,
  children,
}: {
  title:
    string;

  children:
    React.ReactNode;
}) {

  return (

    <div className="summary-card">

      <h2>
        {title}
      </h2>


      <div className="summary-card-content">

        {children}

      </div>

    </div>

  );

}


/* =========================================================
   INFORMATION ROW
========================================================= */

function InfoRow({
  label,
  value,
}: {
  label:
    string;

  value?:
    string;
}) {

  return (

    <div className="info-row">

      <span>
        {label}
      </span>


      <strong>
        {value ||
          '-'}
      </strong>

    </div>

  );

}


/* =========================================================
   EMPTY MODULE
========================================================= */

function EmptyClinicalModule({
  title,
}: {
  title:
    string;
}) {

  return (

    <div className="empty-clinical-module">

      <h2>
        {title}
      </h2>


      <p>
        This module will be connected to FHIR resources in the next development phase.
      </p>

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
   GENDER
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
