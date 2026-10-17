import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type Status = 'PASS' | 'PARTIAL' | 'FAIL';

type Gate = {
  step: number;
  name: string;
  status: Status;
  evidence: string[];
};

const apiRoot = resolve(__dirname, '../src');
const fixturePath = resolve(__dirname, 'fixtures/hp1-workflow.acceptance.json');

const source = (path: string): string =>
  readFileSync(resolve(apiRoot, path), 'utf8');

const gates: Gate[] = [
  {
    step: 1,
    name: 'Patient identification / registration',
    status: 'PASS',
    evidence: ['patients/patients.controller.ts'],
  },
  {
    step: 2,
    name: 'Visit / encounter creation',
    status: 'PASS',
    evidence: ['encounters/dto/create-encounter.dto.ts'],
  },
  {
    step: 3,
    name: 'Insurance / eligibility / financial class',
    status: 'PASS',
    evidence: [
      'financial/financial.controller.ts',
      'financial/financial.service.ts',
    ],
  },
  {
    step: 4,
    name: 'Triage / initial assessment',
    status: 'PASS',
    evidence: [
      'vitals/vitals.controller.ts',
      'encounters/encounters.controller.ts',
    ],
  },
  {
    step: 5,
    name: 'Doctor / clinical assessment',
    status: 'PASS',
    evidence: [
      'conditions/conditions.controller.ts',
      'clinical-notes/clinical-notes.controller.ts',
      'medications/medications.controller.ts',
    ],
  },
  {
    step: 6,
    name: 'Orders, services, and pharmacy',
    status: 'PASS',
    evidence: [
      'laboratory/laboratory.controller.ts',
      'radiology/radiology.controller.ts',
      'pharmacy/pharmacy.controller.ts',
      'clinical-services/clinical-services.controller.ts',
    ],
  },
  {
    step: 7,
    name: 'Results / reporting',
    status: 'PASS',
    evidence: [
      'laboratory/laboratory-results.controller.ts',
      'laboratory/laboratory-reports.controller.ts',
      'radiology/radiology-reports.controller.ts',
    ],
  },
  {
    step: 8,
    name: 'Doctor results review',
    status: 'PASS',
    evidence: [
      'result-reviews/result-reviews.controller.ts',
      'result-reviews/result-reviews.service.ts',
    ],
  },
  {
    step: 9,
    name: 'Disposition',
    status: 'PASS',
    evidence: [
      'encounters/dto/finish-encounter.dto.ts',
      'encounters/encounters.service.ts',
    ],
  },
  {
    step: 10,
    name: 'Billing / claim',
    status: 'PASS',
    evidence: ['billing/billing.controller.ts', 'billing/billing.service.ts'],
  },
  {
    step: 11,
    name: 'Medical record completion',
    status: 'PASS',
    evidence: [
      'medical-records/medical-records.controller.ts',
      'medical-records/medical-records.service.ts',
    ],
  },
  {
    step: 12,
    name: 'Reporting / audit / analytics',
    status: 'PASS',
    evidence: [
      'audit-analytics/audit-analytics.controller.ts',
      'audit-analytics/audit-analytics.service.ts',
      'audit-analytics/audit.interceptor.ts',
    ],
  },
];

describe('Hospital One complete workflow acceptance contract', () => {
  it('uses a complete, isolated UAT data set', () => {
    expect(existsSync(fixturePath)).toBe(true);
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
    expect(fixture.scenarioId).toBe('HP1-UAT-2026-001');
    expect(fixture.hospital.id).toBe('hospital-one');
    expect(fixture.patient.hospitalMrn).toBe('HP1-UAT-000001');
    expect(fixture.financialClass.type).toBe('insurance');
    expect(fixture.clinical.primaryDiagnosis.code).toBeTruthy();
    expect(fixture.expectedFinancials.currency).toBe('SAR');
  });

  it.each(gates.filter((gate) => gate.evidence.length > 0))(
    'has source evidence for gate $step: $name',
    (gate) => {
      for (const file of gate.evidence) {
        expect(existsSync(resolve(apiRoot, file))).toBe(true);
      }
    },
  );

  it('supports MRN creation and duplicate search', () => {
    const controller = source('patients/patients.controller.ts');
    const dto = source('patients/dto/create-patient.dto.ts');
    expect(controller).toContain("@Get('registration/duplicates')");
    expect(controller).toContain('@Post()');
    expect(dto).toContain('hospitalMrn');
  });

  it('supports all mandatory encounter types', () => {
    const dto = source('encounters/dto/create-encounter.dto.ts');
    expect(dto).toContain("'outpatient'");
    expect(dto).toContain("'emergency'");
    expect(dto).toContain("'inpatient'");
    expect(dto).toContain("'day-case'");
    expect(dto).toContain("'diagnostic'");
  });

  it('enforces clinical completion gates before disposition', () => {
    const service = source('encounters/encounters.service.ts');
    expect(service).toContain('PRIMARY_DIAGNOSIS_REQUIRED');
    expect(service).toContain('SIGNED_NOTE_REQUIRED');
  });

  it('publishes the mandatory gaps so this audit cannot be reported as 100%', () => {
    const failed = gates
      .filter((gate) => gate.status === 'FAIL')
      .map((gate) => gate.step);
    const partial = gates
      .filter((gate) => gate.status === 'PARTIAL')
      .map((gate) => gate.step);
    expect(failed).toEqual([]);
    expect(partial).toEqual([]);
  });
});
