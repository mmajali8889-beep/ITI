import {
  ArrowLeft,
  ExternalLink,
  FlaskConical,
} from 'lucide-react';

import {
  useNavigate,
  useParams,
} from 'react-router-dom';

import PatientLaboratory from '../components/PatientLaboratory';
import LaboratoryPanel from '../components/LaboratoryPanel';
import { useAuth } from '../context/useAuth';
import { canAccess } from '../auth/permissions';

import './PatientModuleWorkspace.css';

export default function PatientLaboratoryWorkspace() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const { hospitalId, patientId, encounterId } =
    useParams<{
      hospitalId: string;
      patientId: string;
      encounterId?: string;
    }>();

  if (!hospitalId || !patientId) {
    return (
      <div className="patient-module-state">
        Missing hospital or patient ID.
      </div>
    );
  }

  return (
    <main className="patient-module-workspace">
      <header className="patient-module-header">
        <div>
          <button
            type="button"
            className="patient-module-back"
            onClick={() =>
              navigate(
                `/hospital/${hospitalId}/patients?module=laboratory`,
              )
            }
          >
            <ArrowLeft size={16} />
            Patient Selection
          </button>

          <div className="patient-module-title">
            <span className="patient-module-icon violet">
              <FlaskConical size={20} />
            </span>
            <div>
              <span>Clinical Diagnostics</span>
              <h1>Patient Laboratory</h1>
            </div>
          </div>
        </div>

        {canAccess(session?.user.permissions, 'clinical') && (
          <button
            type="button"
            className="patient-module-chart"
            onClick={() =>
              navigate(
                `/hospital/${hospitalId}/patient/${patientId}`,
              )
            }
          >
            Open Full Patient Chart
            <ExternalLink size={15} />
          </button>
        )}
      </header>

      <section className="patient-module-body">
        {encounterId ? (
          <LaboratoryPanel
            patientId={patientId}
            hospitalId={hospitalId}
            encounterId={encounterId}
            practitionerId={session?.user.id}
            practitionerName={session?.user.display}
          />
        ) : (
          <PatientLaboratory
            patientId={patientId}
            hospitalId={hospitalId}
          />
        )}
      </section>
    </main>
  );
}
