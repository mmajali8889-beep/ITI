import type { Encounter } from '@medplum/fhirtypes';

/**
 * Care pathways for the patient journey (27.3): which milestones are mandatory
 * for each service line. A mandatory milestone that is not done blocks the
 * journey and counts against completion; an optional one is shown but does
 * neither. A branch that was never ordered (no lab order, no admission…) stays
 * not-applicable whatever the pathway says.
 *
 * The defaults below are a starting point; each hospital can override them
 * (JourneyPathwaysService, Administration → Care pathways).
 */
export const JOURNEY_MILESTONES = [
  { key: 'mpi', label: 'Patient / MPI', locked: true },
  { key: 'entry', label: 'Appointment / Arrival', locked: true },
  { key: 'encounter', label: 'Encounter', locked: true },
  { key: 'payer', label: 'Insurance / Payer' },
  { key: 'triage', label: 'Triage' },
  { key: 'assessment', label: 'Doctor Assessment' },
  { key: 'lab', label: 'Laboratory' },
  { key: 'radiology', label: 'Radiology' },
  { key: 'pharmacy', label: 'Pharmacy' },
  { key: 'review', label: 'Doctor Review' },
  { key: 'disposition', label: 'Disposition' },
  { key: 'admission', label: 'Admission' },
  { key: 'bed', label: 'Bed Management' },
  { key: 'ward', label: 'Ward' },
  { key: 'nursing-doctor', label: 'Nursing + Doctor' },
  { key: 'surgery', label: 'Surgery' },
  { key: 'icu', label: 'ICU' },
  { key: 'procedures', label: 'Procedures' },
  { key: 'discharge', label: 'Discharge' },
  { key: 'billing', label: 'Billing / Insurance Claim' },
  { key: 'medical-record', label: 'Medical Record' },
  { key: 'follow-up', label: 'Follow-up' },
] as const;

export type MilestoneKey = (typeof JOURNEY_MILESTONES)[number]['key'];
export const LOCKED_MILESTONES: MilestoneKey[] = JOURNEY_MILESTONES.filter(
  (m) => 'locked' in m && m.locked,
).map((m) => m.key);

/** Ordered results and treatments: once ordered, they must be completed. */
const ORDERED: MilestoneKey[] = ['lab', 'radiology', 'pharmacy', 'review'];

export const JOURNEY_PATHWAYS = {
  outpatient: {
    label: 'Outpatient clinic',
    required: [
      ...LOCKED_MILESTONES,
      'payer',
      'assessment',
      ...ORDERED,
      'disposition',
      'admission',
      'billing',
      'medical-record',
    ],
  },
  emergency: {
    label: 'Emergency department',
    // Treatment is not held up by payer checks in the emergency department.
    required: [
      ...LOCKED_MILESTONES,
      'triage',
      'assessment',
      ...ORDERED,
      'disposition',
      'admission',
      'billing',
      'medical-record',
    ],
  },
  inpatient: {
    label: 'Inpatient admission',
    required: [
      ...LOCKED_MILESTONES,
      'payer',
      'assessment',
      ...ORDERED,
      'disposition',
      'admission',
      'bed',
      'ward',
      'nursing-doctor',
      'surgery',
      'icu',
      'procedures',
      'discharge',
      'billing',
      'medical-record',
      'follow-up',
    ],
  },
  'day-case': {
    label: 'Day case / short stay',
    required: [
      ...LOCKED_MILESTONES,
      'payer',
      'assessment',
      ...ORDERED,
      'surgery',
      'procedures',
      'disposition',
      'admission',
      'discharge',
      'billing',
      'medical-record',
    ],
  },
  diagnostic: {
    label: 'Diagnostic only (laboratory / radiology)',
    required: [
      ...LOCKED_MILESTONES,
      'payer',
      ...ORDERED,
      'disposition',
      'billing',
      'medical-record',
    ],
  },
  procedure: {
    label: 'Procedure visit',
    required: [
      ...LOCKED_MILESTONES,
      'payer',
      'assessment',
      ...ORDERED,
      'procedures',
      'disposition',
      'admission',
      'billing',
      'medical-record',
    ],
  },
} satisfies Record<string, { label: string; required: MilestoneKey[] }>;

export type PathwayCode = keyof typeof JOURNEY_PATHWAYS;
export const PATHWAY_CODES = Object.keys(JOURNEY_PATHWAYS) as PathwayCode[];

const ENCOUNTER_TYPE_SYSTEM =
  'https://hospital-ehr.local/CodeSystem/encounter-type';
const BY_ENCOUNTER_TYPE: Record<string, PathwayCode> = {
  outpatient: 'outpatient',
  emergency: 'emergency',
  inpatient: 'inpatient',
  'day-case': 'day-case',
  diagnostic: 'diagnostic',
  'laboratory-only': 'diagnostic',
  'radiology-only': 'diagnostic',
  procedure: 'procedure',
};

/**
 * The service line of an encounter. An admitted encounter (class IMP) follows
 * the inpatient pathway whatever it started as; otherwise the encounter type
 * chosen at registration decides, then the encounter class.
 */
export function pathwayFor(encounter: Encounter): PathwayCode {
  if (encounter.class?.code === 'IMP') return 'inpatient';
  const type = encounter.type
    ?.flatMap((t) => t.coding ?? [])
    .find((c) => c.system === ENCOUNTER_TYPE_SYSTEM)?.code;
  if (type && BY_ENCOUNTER_TYPE[type]) return BY_ENCOUNTER_TYPE[type];
  if (encounter.class?.code === 'EMER') return 'emergency';
  if (encounter.class?.code === 'SS') return 'day-case';
  return 'outpatient';
}

/** The milestone a journey node stands for ('appointment' and 'emergency' are both the entry). */
export function milestoneOf(nodeKey: string): string {
  return nodeKey === 'appointment' || nodeKey === 'emergency'
    ? 'entry'
    : nodeKey;
}
