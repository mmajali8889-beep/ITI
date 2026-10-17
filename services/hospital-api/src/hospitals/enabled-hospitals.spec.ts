import { enabledHospitalCodes, isHospitalEnabled } from './enabled-hospitals';

describe('enabled hospitals (stage 25)', () => {
  it('reads a comma-separated list, case-insensitively', () => {
    const env = { ENABLED_HOSPITAL_CODES: 'hosp-a, HOSP-01 ,,HOSP-02' };
    expect([...enabledHospitalCodes(env)]).toEqual([
      'HOSP-A',
      'HOSP-01',
      'HOSP-02',
    ]);
    expect(isHospitalEnabled('hosp-01', env)).toBe(true);
    expect(isHospitalEnabled('HOSP-B', env)).toBe(false);
  });

  it('falls back to the single ACTIVE_HOSPITAL_CODE, then HOSP-A', () => {
    expect([
      ...enabledHospitalCodes({ ACTIVE_HOSPITAL_CODE: 'HOSP-01' }),
    ]).toEqual(['HOSP-01']);
    expect([...enabledHospitalCodes({})]).toEqual(['HOSP-A']);
  });

  it('prefers the list over the old single setting', () => {
    expect([
      ...enabledHospitalCodes({
        ENABLED_HOSPITAL_CODES: 'HOSP-B',
        ACTIVE_HOSPITAL_CODE: 'HOSP-A',
      }),
    ]).toEqual(['HOSP-B']);
  });

  it('never enables a hospital without a code', () => {
    expect(
      isHospitalEnabled(undefined, { ENABLED_HOSPITAL_CODES: 'HOSP-A' }),
    ).toBe(false);
    expect(isHospitalEnabled('', { ENABLED_HOSPITAL_CODES: 'HOSP-A' })).toBe(
      false,
    );
  });
});
