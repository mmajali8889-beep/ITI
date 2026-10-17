import { request as httpRequest } from 'node:http';
import type { IncomingHttpHeaders } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { NextFunction, Request, Response } from 'express';
import type { AuthService } from '../auth/auth.service';
import { readSessionCookie } from '../auth/auth.guard';
import { orthancAuthHeaders, orthancBaseUrl } from './orthanc-connection';

/** Paths served by Orthanc's OHIF plugin and its DICOMweb API. */
export const PACS_VIEWER_PATHS = ['/ohif', '/dicom-web'];

const FORWARDED_REQUEST_HEADERS = ['accept', 'accept-encoding', 'accept-language', 'range', 'if-none-match', 'if-modified-since'];
const VIEWER_PERMISSIONS = ['*', 'radiology', 'clinical'];

/**
 * Read-only, session-checked proxy in front of Orthanc's OHIF viewer and
 * DICOMweb API. Orthanc requires HTTP credentials and has no per-user roles
 * (anyone holding them could also delete studies), so browsers never get
 * them: staff open the viewer on the API's origin with their EHR session,
 * and the API adds the service credentials on the server side.
 */
export function pacsViewerProxy(authService: AuthService) {
  return (request: Request, response: Response, _next: NextFunction): void => {
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
    const headers: Record<string, string> = { ...orthancAuthHeaders(), host: target.host };
    for (const name of FORWARDED_REQUEST_HEADERS) {
      const value = request.headers[name];
      if (typeof value === 'string') headers[name] = value;
    }

    const send = target.protocol === 'https:' ? httpsRequest : httpRequest;
    const upstreamRequest = send(target, { method: request.method, headers }, (upstream) => {
      if (upstream.statusCode === 401 || upstream.statusCode === 403) {
        // Our service credentials were refused: never let the browser fall
        // back to a Basic-auth prompt for Orthanc.
        upstream.resume();
        response.status(502).json({ message: 'The PACS rejected the API service credentials' });
        return;
      }
      response.writeHead(upstream.statusCode ?? 502, withoutAuthHeaders(upstream.headers));
      upstream.pipe(response);
    });
    upstreamRequest.on('error', () => {
      if (!response.headersSent) response.status(502).json({ message: 'The PACS is unavailable' });
      else response.end();
    });
    upstreamRequest.end();
  };
}

function withoutAuthHeaders(headers: IncomingHttpHeaders): IncomingHttpHeaders {
  const copy = { ...headers };
  delete copy['www-authenticate'];
  delete copy['set-cookie'];
  return copy;
}
