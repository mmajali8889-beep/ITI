/**
 * Hospitals users may sign in to during the rollout, by organization code.
 * ENABLED_HOSPITAL_CODES is a comma-separated list (e.g. "HOSP-A,HOSP-01").
 * ACTIVE_HOSPITAL_CODE (one code, the earlier setting) is still honoured when
 * the list is unset, and HOSP-A is the default.
 */
export function enabledHospitalCodes(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const raw = env.ENABLED_HOSPITAL_CODES ?? env.ACTIVE_HOSPITAL_CODE ?? 'HOSP-A';
  return new Set(raw.split(',').map((code) => code.trim().toUpperCase()).filter(Boolean));
}

export function isHospitalEnabled(code: string | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  return !!code && enabledHospitalCodes(env).has(code.trim().toUpperCase());
}
