/**
 * Whether a required request field is missing. Missing, null, whitespace-only
 * strings and empty arrays are blank; numbers, booleans and objects are
 * present (so 0 and false are valid values).
 */
export function isBlank(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return !value.trim();
  if (Array.isArray(value)) return value.length === 0;
  return false;
}
