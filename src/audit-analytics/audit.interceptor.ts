import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuditAnalyticsService } from './audit-analytics.service';

type AuthInfo = { hospitalId?: string; profile?: { id?: string; name?: Array<{ text?: string }> } };
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditAnalyticsService) {}
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request & { auth?: AuthInfo }>();
    const response = context.switchToHttp().getResponse<Response>();
    const isWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method);
    const path = request.originalUrl.split('?')[0];
    const isSensitiveRead = request.method === 'GET' && (path.startsWith('/api/medical-records') || path.startsWith('/api/patient-portal') || path.startsWith('/api/patient-journey') || path.startsWith('/api/administration') || path.startsWith('/api/inventory') || path.startsWith('/api/audit'));
    if (!isWrite && !isSensitiveRead) return next.handle();
    const started = Date.now();
    const write = (statusCode: number) => { const hospitalId = request.auth?.hospitalId ?? (request.body as { hospitalId?: string } | undefined)?.hospitalId ?? (request.query as { hospitalId?: string } | undefined)?.hospitalId; void this.audit.record({ hospitalId, userId: request.auth?.profile?.id, userName: request.auth?.profile?.name?.[0]?.text, method: request.method, route: request.originalUrl.split('?')[0], ip: request.ip, statusCode, durationMs: Date.now() - started }).catch(() => undefined); };
    return next.handle().pipe(tap({ next: () => write(response.statusCode), error: (error: { status?: number; statusCode?: number }) => write(error.status ?? error.statusCode ?? 500) }));
  }
}
