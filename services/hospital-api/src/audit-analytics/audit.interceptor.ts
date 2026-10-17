import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuditAnalyticsService } from './audit-analytics.service';
import { addressedRecord } from './audit-record-routes';

type AuthInfo = {
  hospitalId?: string;
  profile?: { id?: string; name?: Array<{ text?: string }> };
};
type Bag = Record<string, unknown> | undefined;

// A FHIR resource id; anything else is not written into an audit reference.
const FHIR_ID = /^[A-Za-z0-9\-.]{1,64}$/;

function firstId(...values: unknown[]): string | undefined {
  const value = values.find(
    (item) => typeof item === 'string' && FHIR_ID.test(item.trim()),
  );
  return typeof value === 'string' ? value.trim() : undefined;
}

/**
 * Which patient and encounter a request concerns: route params first, then
 * query, then body. For a newly created patient or visit, the id comes from
 * the response.
 */
export function auditSubjects(
  request: Pick<Request, 'method' | 'params' | 'query' | 'body'> & {
    route?: { path?: string };
  },
  path: string,
  result?: unknown,
) {
  const params = request.params as Bag,
    query = request.query as Bag,
    body = request.body as Bag;
  const created = (result ?? undefined) as
    | (Record<string, unknown> & {
        patient?: { id?: unknown };
        encounter?: { id?: unknown };
      })
    | undefined;
  // One level down, e.g. { invoice: { patientId } } or { claim: { patientId } }.
  const nested =
    created && typeof created === 'object' && !Array.isArray(created)
      ? Object.values(created).filter(
          (value): value is Record<string, unknown> =>
            !!value && typeof value === 'object' && !Array.isArray(value),
        )
      : [];
  const isCreate = (route: string) =>
    request.method === 'POST' && path.replace(/\/+$/, '') === route;
  const patientId = firstId(
    params?.patientId,
    query?.patientId,
    body?.patientId,
    created?.patient?.id,
    created?.patientId,
    isCreate('/api/patients') ? created?.id : undefined,
    ...nested.map((item) => item.patientId),
  );
  const encounterId = firstId(
    params?.encounterId,
    query?.encounterId,
    body?.encounterId,
    created?.encounter?.id,
    created?.encounterId,
    isCreate('/api/encounters') ? created?.id : undefined,
    ...nested.map((item) => item.encounterId),
  );
  // A record the request addressed by id, or an order named in the response,
  // lets the audit service look up the patient when it is still unknown.
  const orderId = firstId(created?.orderId);
  const record =
    addressedRecord(path) ??
    (orderId ? { id: orderId, types: ['ServiceRequest'] } : undefined);
  return { patientId, encounterId, record };
}

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditAnalyticsService) {}
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { auth?: AuthInfo }>();
    const response = context.switchToHttp().getResponse<Response>();
    const isWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method);
    const path = request.originalUrl.split('?')[0];
    const isSensitiveRead =
      request.method === 'GET' &&
      (path.startsWith('/api/medical-records') ||
        path.startsWith('/api/patient-portal') ||
        path.startsWith('/api/patient-journey') ||
        path.startsWith('/api/administration') ||
        path.startsWith('/api/inventory') ||
        path.startsWith('/api/audit'));
    // 27.5: any read of patient data is audited: one that names a patient or
    // encounter, or addresses a clinical record by its id.
    const subjectsBefore =
      request.method === 'GET' ? auditSubjects(request, path) : undefined;
    const isChartRead =
      !!subjectsBefore &&
      (!!subjectsBefore.patientId ||
        !!subjectsBefore.encounterId ||
        !!addressedRecord(path));
    if (!isWrite && !isSensitiveRead && !isChartRead) return next.handle();
    const started = Date.now();
    const write = (statusCode: number, result?: unknown) => {
      const hospitalId =
        request.auth?.hospitalId ??
        (request.body as { hospitalId?: string } | undefined)?.hospitalId ??
        (request.query as { hospitalId?: string } | undefined)?.hospitalId;
      const { patientId, encounterId, record } = auditSubjects(
        request,
        path,
        result,
      );
      void this.audit
        .record({
          hospitalId,
          userId: request.auth?.profile?.id,
          userName: request.auth?.profile?.name?.[0]?.text,
          method: request.method,
          route: path,
          ip: request.ip,
          statusCode,
          durationMs: Date.now() - started,
          patientId,
          encounterId,
          record,
        })
        .catch(() => undefined);
    };
    return next.handle().pipe(
      tap({
        next: (result: unknown) => write(response.statusCode, result),
        error: (error: { status?: number; statusCode?: number }) =>
          write(error.status ?? error.statusCode ?? 500),
      }),
    );
  }
}
