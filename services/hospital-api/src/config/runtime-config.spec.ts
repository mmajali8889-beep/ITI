import { loadSecretFiles, productionConfigProblems } from './runtime-config';

describe('runtime config (24.7)', () => {
  it('reads NAME_FILE into NAME, trimming the trailing newline', () => {
    const env: NodeJS.ProcessEnv = {
      MEDPLUM_CLIENT_SECRET_FILE: '/run/secrets/medplum',
    };
    const loaded = loadSecretFiles(env, () => 's3cr3t-value\n');
    expect(env.MEDPLUM_CLIENT_SECRET).toBe('s3cr3t-value');
    expect(loaded).toEqual(['MEDPLUM_CLIENT_SECRET']);
  });

  it('keeps an explicitly set value over the file', () => {
    const env: NodeJS.ProcessEnv = {
      ORTHANC_PASSWORD: 'direct',
      ORTHANC_PASSWORD_FILE: '/x',
    };
    loadSecretFiles(env, () => 'from-file');
    expect(env.ORTHANC_PASSWORD).toBe('direct');
  });

  it('fails clearly when a secret file cannot be read', () => {
    const env: NodeJS.ProcessEnv = { AUTH_SESSION_SECRET_FILE: '/missing' };
    expect(() =>
      loadSecretFiles(env, () => {
        throw new Error('ENOENT');
      }),
    ).toThrow(/AUTH_SESSION_SECRET_FILE \(\/missing\)/);
  });

  it('checks nothing outside production', () => {
    expect(productionConfigProblems({ NODE_ENV: 'development' })).toEqual([]);
  });

  it('lists every production problem at once', () => {
    const problems = productionConfigProblems({
      NODE_ENV: 'production',
      AUTH_SESSION_SECRET: 'short',
      AUTH_DEV_ADMIN_ENABLED: 'true',
      WEB_ORIGIN: 'http://ehr.hospital.local',
      ORTHANC_PASSWORD: 'admin',
      OHIF_VIEWER_URL: 'http://x',
    });
    expect(problems).toEqual(
      expect.arrayContaining([
        'MEDPLUM_CLIENT_SECRET is required',
        'AUTH_SESSION_SECRET must be at least 32 characters',
        'AUTH_DEV_ADMIN_ENABLED must not be set',
        expect.stringContaining('WEB_ORIGIN must be an https://'),
        expect.stringContaining('OHIF_VIEWER_URL must be a path'),
        'ORTHANC_PASSWORD uses a placeholder value',
      ]),
    );
  });

  it('accepts a complete production configuration', () => {
    expect(
      productionConfigProblems({
        NODE_ENV: 'production',
        MEDPLUM_BASE_URL: 'http://medplum:8103/',
        MEDPLUM_CLIENT_ID: 'id',
        MEDPLUM_CLIENT_SECRET: 'x'.repeat(40),
        ORTHANC_URL: 'http://orthanc:8042',
        ORTHANC_USERNAME: 'hospital-api',
        ORTHANC_PASSWORD: 'y'.repeat(32),
        WEB_ORIGIN: 'https://ehr.hospital.local',
        ENABLED_HOSPITAL_CODES: 'HOSP-A',
        AUTH_SESSION_SECRET: 'z'.repeat(48),
        OHIF_VIEWER_URL: '/ohif',
      }),
    ).toEqual([]);
  });
});
