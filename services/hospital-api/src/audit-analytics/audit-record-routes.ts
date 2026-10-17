/**
 * Routes that address one clinical or financial record by its own id, with the
 * FHIR resource type(s) behind that id. Used to attribute an audit event to
 * the record's patient and encounter (27.4), and to decide that a read touches
 * patient data and must be audited (27.5).
 *
 * Literal segments such as "patient/", "order/" or "queue" are excluded so
 * they are never mistaken for ids.
 */
export const RECORD_ROUTES: Array<{ pattern: RegExp; types: string[] }> = [
  { pattern: /^\/api\/pharmacy\/prescriptions\/([^/]+)/, types: ['MedicationRequest'] },
  { pattern: /^\/api\/pharmacy\/dispenses\/([^/]+)/, types: ['MedicationDispense'] },
  { pattern: /^\/api\/medications\/(?!patient(?:\/|$))([^/]+)/, types: ['MedicationRequest'] },
  { pattern: /^\/api\/(?:radiology|laboratory|clinical-services)\/orders\/(?!by-accession(?:\/|$))([^/]+)/, types: ['ServiceRequest'] },
  { pattern: /^\/api\/(?:laboratory|radiology)\/reports\/(?!(?:order|encounter|patient)(?:\/|$))([^/]+)/, types: ['DiagnosticReport'] },
  { pattern: /^\/api\/laboratory\/results\/(?!batch(?:\/|$))([^/]+)/, types: ['Observation'] },
  { pattern: /^\/api\/laboratory\/specimens\/([^/]+)/, types: ['Specimen'] },
  { pattern: /^\/api\/radiology\/imaging-studies\/(?!(?:order|encounter|patient)(?:\/|$))([^/]+)/, types: ['ImagingStudy'] },
  { pattern: /^\/api\/clinical-notes\/(?!patient(?:\/|$))([^/]+)/, types: ['DocumentReference'] },
  { pattern: /^\/api\/conditions\/(?!patient(?:\/|$))([^/]+)/, types: ['Condition'] },
  { pattern: /^\/api\/billing\/invoices\/([^/]+)/, types: ['Invoice'] },
  { pattern: /^\/api\/billing\/claims\/([^/]+)/, types: ['Claim'] },
  { pattern: /^\/api\/financial\/coverages\/(?!patient(?:\/|$))([^/]+)/, types: ['Coverage'] },
  { pattern: /^\/api\/financial\/eligibility\/(?!(?:patient|checks)(?:\/|$))([^/]+)/, types: ['CoverageEligibilityRequest'] },
  { pattern: /^\/api\/medical-records\/deficiencies\/([^/]+)/, types: ['Task'] },
  { pattern: /^\/api\/medical-records\/(?!(?:encounters|queue|deficiencies)(?:\/|$))([^/]+)\//, types: ['Composition'] },
  { pattern: /^\/api\/(?:discharge|inpatient\/admission-requests)\/(?!queue(?:\/|$))([^/]+)/, types: ['Task'] },
  { pattern: /^\/api\/consultations\/([^/]+)\//, types: ['ServiceRequest', 'Task'] },
];

const FHIR_ID = /^[A-Za-z0-9\-.]{1,64}$/;

/** The record a path addresses, if it is one of the routes above. */
export function addressedRecord(path: string): { id: string; types: string[] } | undefined {
  for (const { pattern, types } of RECORD_ROUTES) {
    const id = pattern.exec(path)?.[1];
    if (id && FHIR_ID.test(id)) return { id, types };
  }
  return undefined;
}
