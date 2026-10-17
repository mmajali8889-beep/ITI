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

import HospitalSelection from './pages/HospitalSelection';
import HospitalLayout from './components/HospitalLayout';
import ProtectedHospitalRoute from './components/ProtectedHospitalRoute';
import { lazyPage } from './lazy-page';

import './styles/modern-2026.css';

const Dashboard = lazyPage(() => import('./pages/Dashboard'));
const PatientAccessPage = lazyPage(() => import('./pages/PatientAccessPage'));
const PatientRegistrationPage = lazyPage(() => import('./pages/PatientRegistrationPage'));
const PatientLaboratoryWorkspace = lazyPage(() => import('./pages/PatientLaboratoryWorkspace'));
const PatientMedicationWorkspace = lazyPage(() => import('./pages/PatientMedicationWorkspace'));
const PatientProfile = lazyPage(() => import('./pages/PatientProfile'));
const EncounterWorkspace = lazyPage(() => import('./pages/EncounterWorkspace'));
const RadiologyWorklistPage = lazyPage(() => import('./components/RadiologyWorklistPage'));
const RadiologyStationsPage = lazyPage(() => import('./components/RadiologyStationsPage'));
const InpatientBedBoard = lazyPage(() => import('./pages/InpatientBedBoard'));
const AppointmentsPage = lazyPage(() => import('./pages/AppointmentsPage'));
const EmergencyBoard = lazyPage(() => import('./pages/EmergencyBoard'));
const PharmacyPage = lazyPage(() => import('./pages/PharmacyPage'));
const NursingWardPage = lazyPage(() => import('./pages/NursingWardPage'));
const InpatientRoundsPage = lazyPage(() => import('./pages/InpatientRoundsPage'));
const SurgeryTheatrePage = lazyPage(() => import('./pages/SurgeryTheatrePage'));
const IcuDashboardPage = lazyPage(() => import('./pages/IcuDashboardPage'));
const ConsultationsPage = lazyPage(() => import('./pages/ConsultationsPage'));
const BedManagementPage = lazyPage(() => import('./pages/BedManagementPage'));
const DischargePage = lazyPage(() => import('./pages/DischargePage'));
const BillingPage = lazyPage(() => import('./pages/BillingPage'));
const MedicalRecordsPage = lazyPage(() => import('./pages/MedicalRecordsPage'));
const PatientPortalPage = lazyPage(() => import('./pages/PatientPortalPage'));
const AdministrationPage = lazyPage(() => import('./pages/AdministrationPage'));
const InventoryPage = lazyPage(() => import('./pages/InventoryPage'));

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
