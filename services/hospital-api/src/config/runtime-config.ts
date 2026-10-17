import { readFileSync } from 'node:fs';

/** Settings that hold credentials and may be supplied as files (24.7). */
export const SECRET_SETTINGS = [
  'AUTH_SESSION_SECRET',
  'MEDPLUM_CLIENT_SECRET',
  'MEDPLUM_PROVISIONING_PASSWORD',
  'ORTHANC_PASSWORD',
] as const;

/**
 * For each `NAME_FILE` setting, reads the file and sets `NAME` (unless `NAME`
 * is already set). On a hospital server, secrets are mounted as files with
 * restricted permissions (Docker secrets under /run/secrets), so they never
 * appear in images, `docker inspect`, process listings or git.
 */
export function loadSecretFiles(
  env: NodeJS.ProcessEnv = process.env,
  read: (path: string) => string = (path) => readFileSync(path, 'utf8'),
): string[] {
  const loaded: string[] = [];
  for (const [key, path] of Object.entries(env)) {
    if (!key.endsWith('_FILE') || !path) continue;
    const name = key.slice(0, -'_FILE'.length);
    if (env[name]) continue;
    try {
      env[name] = read(path).trim();
    } catch (error) {
      throw new Error(
        `Cannot read ${key} (${path}): ${(error as Error).message}`,
      );
    }
    loaded.push(name);
  }
  return loaded;
}

/**
 * Everything that must be true before the API serves real patients. Returns
 * every problem at once so an operator can fix the configuration in one pass.
 */
export function productionConfigProblems(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  if (env.NODE_ENV !== 'production') return [];
  const problems: string[] = [];
  const required = [
    'MEDPLUM_BASE_URL',
    'MEDPLUM_CLIENT_ID',
    'MEDPLUM_CLIENT_SECRET',
    'ORTHANC_URL',
    'ORTHANC_USERNAME',
    'ORTHANC_PASSWORD',
    'WEB_ORIGIN',
    'ENABLED_HOSPITAL_CODES',
  ];
  for (const name of required)
    if (!env[name]?.trim()) problems.push(`${name} is required`);
  if ((env.AUTH_SESSION_SECRET ?? '').length < 32)
    problems.push('AUTH_SESSION_SECRET must be at least 32 characters');
  if (env.AUTH_DEV_ADMIN_ENABLED === 'true')
    problems.push('AUTH_DEV_ADMIN_ENABLED must not be set');
  if (env.WEB_ORIGIN && !env.WEB_ORIGIN.startsWith('https://'))
    problems.push(
      'WEB_ORIGIN must be an https:// address (session cookies are Secure in production)',
    );
  const viewer = env.OHIF_VIEWER_URL;
  if (viewer && !viewer.startsWith('/') && !viewer.startsWith('https://'))
    problems.push(
      'OHIF_VIEWER_URL must be a path (e.g. /ohif) or an https:// address',
    );
  for (const name of SECRET_SETTINGS) {
    if (env[name] && /^(admin|password|changeme|secret)$/i.test(env[name]))
      problems.push(`${name} uses a placeholder value`);
  }
  return problems;
}
