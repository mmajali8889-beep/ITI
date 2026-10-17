import { request as httpRequest } from 'node:http';
import type { IncomingHttpHeaders, IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { NextFunction, Request, Response } from 'express';
import type { AuthService } from '../auth/auth.service';
import { readSessionCookie } from '../auth/auth.guard';
import { orthancAuthHeaders, orthancBaseUrl } from './orthanc-connection';
import type { PacsStudyAccessService } from './pacs-study-access.service';

/** Paths served by Orthanc's OHIF plugin and its DICOMweb API. */
export const PACS_VIEWER_PATHS = ['/ohif', '/dicom-web'];

const FORWARDED_REQUEST_HEADERS = ['accept', 'accept-encoding', 'accept-language', 'range', 'if-none-match', 'if-modified-since'];
const VIEWER_PERMISSIONS = ['*', 'radiology', 'clinical'];
const STUDY_PATH = /^\/dicom-web\/studies\/([^/]+)(?:\/|$)/;
const QIDO_PATH = /^\/dicom-web\/(?:studies|series|instances)\/?$/;
const STUDY_UID_TAG = '0020000D';

/**
 * Read-only, session-checked proxy in front of Orthanc's OHIF viewer and
 * DICOMweb API. Orthanc requires HTTP credentials and has no per-user roles
 * (anyone holding them could also delete studies), so browsers never get
 * them: staff open the viewer on the API's origin with their EHR session,
 * and the API adds the service credentials on the server side.
 *
 * Scoped to the session hospital: study paths are served only for the
 * hospital's own studies (404 otherwise, so existence is not revealed), and
 * QIDO searches have other hospitals' results removed.
 */
export function pacsViewerProxy(authService: AuthService, studyAccess: PacsStudyAccessService) {
  return (request: Request, response: Response, _next: NextFunction): void => {
    handle(request, response).catch(() => {
      if (!response.headersSent) response.status(502).json({ message: 'The PACS is unavailable' });
      else response.end();
    });
  };

  async function handle(request: Request, response: Response): Promise<void> {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.status(405).setHeader('Allow', 'GET, HEAD').json({ message: 'The PACS viewer is read-only' });
      return;
    }
    const session = authService.getSession(readSessionCookie(request));
    if (!session) {
      response.status(401).json({ message: 'Sign in to the EHR to view images' });
      return;
    }
    if (!session.permissions.some((permission) => VIEWER_PERMISSIONS.includes(permission))) {
      response.status(403).json({ message: "Viewing images requires the 'radiology' or 'clinical' permission" });
      return;
    }

    const target = new URL(orthancBaseUrl() + request.originalUrl);
    const path = target.pathname;
    if (!path.startsWith('/dicom-web')) {
      // OHIF application assets.
      forwardStream(request, response, target);
      return;
    }

    const study = STUDY_PATH.exec(path);
    if (study) {
      if (!(await studyAccess.isAllowed(decodeURIComponent(study[1]), session.hospitalId))) {
        response.status(404).json({ message: 'Study not found' });
        return;
      }
      forwardStream(request, response, target);
      return;
    }

    if (QIDO_PATH.test(path)) {
      await forwardFilteredSearch(request, response, target, (uids) => studyAccess.allowedUids(uids, session.hospitalId));
      return;
    }

    response.status(404).json({ message: 'Not found' });
  }
}

function upstreamHeaders(request: Request, target: URL, { compressed }: { compressed: boolean }): Record<string, string> {
  const headers: Record<string, string> = { ...orthancAuthHeaders(), host: target.host };
  for (const name of FORWARDED_REQUEST_HEADERS) {
    if (name === 'accept-encoding' && !compressed) continue;
    const value = request.headers[name];
    if (typeof value === 'string') headers[name] = value;
  }
  return headers;
}

function send(target: URL, method: string, headers: Record<string, string>, onResponse: (upstream: IncomingMessage) => void) {
  const requestFn = target.protocol === 'https:' ? httpsRequest : httpRequest;
  return requestFn(target, { method, headers }, onResponse);
}

/** Orthanc refusing our service credentials must never surface as a Basic-auth prompt. */
function rejectedCredentials(upstream: IncomingMessage, response: Response): boolean {
  if (upstream.statusCode !== 401 && upstream.statusCode !== 403) return false;
  upstream.resume();
  response.status(502).json({ message: 'The PACS rejected the API service credentials' });
  return true;
}

function forwardStream(request: Request, response: Response, target: URL): void {
  const upstreamRequest = send(target, request.method, upstreamHeaders(request, target, { compressed: true }), (upstream) => {
    if (rejectedCredentials(upstream, response)) return;
    response.writeHead(upstream.statusCode ?? 502, withoutAuthHeaders(upstream.headers));
    upstream.pipe(response);
  });
  upstreamRequest.on('error', () => {
    if (!response.headersSent) response.status(502).json({ message: 'The PACS is unavailable' });
    else response.end();
  });
  upstreamRequest.end();
}

async function forwardFilteredSearch(
  request: Request,
  response: Response,
  target: URL,
  allowedUids: (uids: string[]) => Promise<Set<string>>,
): Promise<void> {
  // Uncompressed so the result can be parsed and filtered.
  const { upstream, body } = await new Promise<{ upstream: IncomingMessage; body: Buffer }>((resolve, reject) => {
    const upstreamRequest = send(target, request.method, upstreamHeaders(request, target, { compressed: false }), (upstream) => {
      const chunks: Buffer[] = [];
      upstream.on('data', (chunk: Buffer) => chunks.push(chunk));
      upstream.on('end', () => resolve({ upstream, body: Buffer.concat(chunks) }));
      upstream.on('error', reject);
    });
    upstreamRequest.on('error', reject);
    upstreamRequest.end();
  });
  if (rejectedCredentials(upstream, response)) return;

  const headers = withoutAuthHeaders(upstream.headers);
  let results: unknown;
  try {
    results = body.length ? JSON.parse(body.toString('utf8')) : [];
  } catch {
    results = undefined;
  }
  if (upstream.statusCode !== 200 || !Array.isArray(results)) {
    // Errors and empty results carry no study data; anything else unparseable is withheld.
    if (upstream.statusCode === 200) {
      response.status(502).json({ message: 'Unexpected PACS search response' });
      return;
    }
    response.writeHead(upstream.statusCode ?? 502, headers);
    response.end(body);
    return;
  }

  const uidOf = (item: unknown) => (item as Record<string, { Value?: unknown[] }>)?.[STUDY_UID_TAG]?.Value?.[0];
  const uids = results.map(uidOf).filter((uid): uid is string => typeof uid === 'string');
  const allowed = await allowedUids(uids);
  const visible = results.filter((item) => {
    const uid = uidOf(item);
    return typeof uid === 'string' && allowed.has(uid);
  });
  const payload = Buffer.from(JSON.stringify(visible));
  delete headers['content-encoding'];
  delete headers['transfer-encoding'];
  headers['content-length'] = String(payload.length);
  response.writeHead(200, headers);
  response.end(request.method === 'HEAD' ? undefined : payload);
}

function withoutAuthHeaders(headers: IncomingHttpHeaders): IncomingHttpHeaders {
  const copy = { ...headers };
  delete copy['www-authenticate'];
  delete copy['set-cookie'];
  return copy;
}
