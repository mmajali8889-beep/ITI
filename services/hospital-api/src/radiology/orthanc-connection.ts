/**
 * One place for how the API reaches Orthanc. With ORTHANC_USERNAME and
 * ORTHANC_PASSWORD set, every request carries HTTP Basic credentials; Orthanc
 * runs with authentication enabled, so a call without them gets 401.
 */
export function orthancBaseUrl(): string {
  return process.env.ORTHANC_URL?.replace(/\/+$/, '') ?? 'http://localhost:8042';
}

export function orthancAuthHeaders(): Record<string, string> {
  const username = process.env.ORTHANC_USERNAME?.trim();
  if (!username) return {};
  const token = Buffer.from(`${username}:${process.env.ORTHANC_PASSWORD ?? ''}`).toString('base64');
  return { Authorization: `Basic ${token}` };
}
