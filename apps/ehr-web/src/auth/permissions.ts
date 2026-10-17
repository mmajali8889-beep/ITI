export const PERMISSION_GROUPS = [
  { label: 'Core & Reception', items: [['dashboard', 'Dashboard'], ['patients', 'Patient Registry'], ['registration', 'Patient Registration'], ['appointments', 'Appointments & Scheduling']] },
  { label: 'Clinical Care', items: [['clinical', 'Clinical Workspace'], ['emergency', 'Emergency Department'], ['inpatient', 'Inpatient / ADT'], ['nursing', 'Nursing & Ward'], ['rounds', 'Physician Rounds'], ['consultations', 'Consultations']] },
  { label: 'Diagnostics & Treatment', items: [['laboratory', 'Laboratory'], ['radiology', 'Radiology & PACS'], ['pharmacy', 'Pharmacy & Medications'], ['surgery', 'Surgery / OR'], ['icu', 'Intensive Care']] },
  { label: 'Operations & Governance', items: [['bed-management', 'Bed Management'], ['discharge', 'Discharge'], ['billing', 'Billing & Claims'], ['medical-records', 'Medical Records / HIM'], ['inventory', 'Inventory & Supply'], ['administration', 'Administration']] },
] as const;

export const ROLE_PRESETS: Record<string, string[]> = {
  receptionist: ['dashboard', 'patients', 'registration', 'appointments'],
  nurse: ['dashboard', 'patients', 'clinical', 'emergency', 'inpatient', 'nursing', 'icu', 'discharge'],
  doctor: ['dashboard', 'patients', 'clinical', 'laboratory', 'radiology', 'pharmacy', 'emergency', 'inpatient', 'rounds', 'consultations', 'discharge'],
  consultant: ['dashboard', 'patients', 'clinical', 'laboratory', 'radiology', 'pharmacy', 'emergency', 'inpatient', 'rounds', 'surgery', 'icu', 'consultations', 'discharge'],
  'lab-technician': ['dashboard', 'patients', 'laboratory'],
  'lab-supervisor': ['dashboard', 'patients', 'laboratory'],
  radiologist: ['dashboard', 'patients', 'radiology'],
  'radiology-technician': ['dashboard', 'patients', 'radiology'],
  pharmacist: ['dashboard', 'patients', 'pharmacy', 'inventory'],
  cashier: ['dashboard', 'patients', 'billing'],
  'insurance-officer': ['dashboard', 'patients', 'billing'],
  'medical-records': ['dashboard', 'patients', 'medical-records'],
  'supply-chain-officer': ['dashboard', 'inventory'],
  administrator: PERMISSION_GROUPS.flatMap(group => group.items.map(item => item[0])),
  'system-administrator': ['*'],
};

export function canAccess(permissions: string[] | undefined, permission: string): boolean {
  return Boolean(permissions?.includes('*') || permissions?.includes(permission));
}
