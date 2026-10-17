import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
} from 'react-router-dom';

import {
  HospitalProvider,
} from './context/HospitalContext';
import { AuthProvider } from './context/AuthContext';

import './styles/modern-2026.css';

import HospitalSelection from './pages/HospitalSelection';
import Dashboard from './pages/Dashboard';
import PatientAccessPage from './pages/PatientAccessPage';
import PatientRegistrationPage from './pages/PatientRegistrationPage';
import PatientLaboratoryWorkspace from './pages/PatientLaboratoryWorkspace';
import PatientMedicationWorkspace from './pages/PatientMedicationWorkspace';
import PatientProfile from './pages/PatientProfile';
import EncounterWorkspace from './pages/EncounterWorkspace';
import RadiologyWorklistPage from './components/RadiologyWorklistPage';
import RadiologyStationsPage from './components/RadiologyStationsPage';
import HospitalLayout from './components/HospitalLayout';
import InpatientBedBoard from './pages/InpatientBedBoard';
import ProtectedHospitalRoute from './components/ProtectedHospitalRoute';
import AppointmentsPage from './pages/AppointmentsPage';
import EmergencyBoard from './pages/EmergencyBoard';
import PharmacyPage from './pages/PharmacyPage';
import NursingWardPage from './pages/NursingWardPage';
import InpatientRoundsPage from './pages/InpatientRoundsPage';
import SurgeryTheatrePage from './pages/SurgeryTheatrePage';
import IcuDashboardPage from './pages/IcuDashboardPage';
import ConsultationsPage from './pages/ConsultationsPage';
import BedManagementPage from './pages/BedManagementPage';
import DischargePage from './pages/DischargePage';
import BillingPage from './pages/BillingPage';
import MedicalRecordsPage from './pages/MedicalRecordsPage';
import PatientPortalPage from './pages/PatientPortalPage';
import AdministrationPage from './pages/AdministrationPage';
import InventoryPage from './pages/InventoryPage';

function App() {
  return (
    <BrowserRouter>
      <HospitalProvider>
        <AuthProvider>
        <Routes>
          <Route
            path="/"
            element={<HospitalSelection />}
          />

          <Route path="/hospital/:hospitalId" element={<ProtectedHospitalRoute />}>
          <Route element={<HospitalLayout />}>
            <Route
              path="dashboard"
              element={<Dashboard />}
            />

            <Route
              path="patients"
              element={<PatientAccessPage />}
            />

            <Route
              path="patient/register"
              element={<PatientRegistrationPage />}
            />

            <Route
              path="patient/:patientId"
              element={<PatientProfile />}
            />

            <Route
              path="patient/:patientId/encounter/:encounterId"
              element={<EncounterWorkspace />}
            />

            <Route
              path="clinical/laboratory/patient/:patientId"
              element={<PatientLaboratoryWorkspace />}
            />

            <Route
              path="clinical/laboratory/patient/:patientId/encounter/:encounterId"
              element={<PatientLaboratoryWorkspace />}
            />

            <Route
              path="clinical/medications/patient/:patientId"
              element={<PatientMedicationWorkspace />}
            />

            <Route
              path="radiology"
              element={<RadiologyWorklistPage />}
            />

            <Route
              path="radiology/stations"
              element={<RadiologyStationsPage />}
            />

            <Route path="inpatient" element={<InpatientBedBoard />} />
            <Route path="appointments" element={<AppointmentsPage />} />
            <Route path="emergency" element={<EmergencyBoard />} />
            <Route path="pharmacy" element={<PharmacyPage />} />
            <Route path="nursing" element={<NursingWardPage />} />
            <Route path="rounds" element={<InpatientRoundsPage />} />
            <Route path="surgery" element={<SurgeryTheatrePage />} />
            <Route path="icu" element={<IcuDashboardPage />} />
            <Route path="consultations" element={<ConsultationsPage />} />
            <Route path="bed-management" element={<BedManagementPage />} />
            <Route path="discharge" element={<DischargePage />} />
            <Route path="billing" element={<BillingPage />} />
            <Route path="medical-records" element={<MedicalRecordsPage />} />
            <Route path="administration" element={<AdministrationPage />} />
            <Route path="inventory" element={<InventoryPage />} />
          </Route>
          </Route>

          <Route path="/portal/:hospitalId/:patientId" element={<ProtectedHospitalRoute />}>
            <Route index element={<PatientPortalPage />} />
          </Route>

          <Route
            path="*"
            element={<Navigate to="/" replace />}
          />
        </Routes>
        </AuthProvider>
      </HospitalProvider>
    </BrowserRouter>
  );
}

export default App;
