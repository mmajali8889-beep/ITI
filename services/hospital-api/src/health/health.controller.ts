import {
  Controller,
  Get,
  Header,
  Headers,
  HttpStatus,
  NotFoundException,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Response } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { requestMetrics } from '../observability/request-metrics';
import { Public } from '../auth/public.decorator';
import {
  orthancAuthHeaders,
  orthancBaseUrl,
} from '../radiology/orthanc-connection';

type Check = { ok: boolean; latencyMs: number };
const TIMEOUT_MS = 5000;

/**
 * Health endpoints for container health checks and hospital monitoring (28.2).
 * Public, and deliberately terse: up/down and latency only, no versions,
 * hostnames or error text.
 */
@Controller('api/health')
export class HealthController {
  /** Liveness: the process is serving requests (container health check). */
  @Public()
  @Get('live')
  live() {
    return { status: 'ok' };
  }

  /** Readiness: Medplum and Orthanc are reachable. 503 if either is down. */
  @Public()
  @Get()
  async ready(@Res({ passthrough: true }) response: Response) {
    const [medplum, orthanc] = await Promise.all([
      this.probe(
        `${(process.env.MEDPLUM_BASE_URL ?? '').replace(/\/+$/, '')}/healthcheck`,
      ),
      this.probe(`${orthancBaseUrl()}/system`, orthancAuthHeaders()),
    ]);
    const ok = medplum.ok && orthanc.ok;
    response.status(ok ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return {
      status: ok ? 'ok' : 'degraded',
      checks: { medplum, orthanc },
      checkedAt: new Date().toISOString(),
    };
  }

  /**
   * Request counters in Prometheus format: 5xx, 429 and Medplum throttling.
   * Needs "Authorization: Bearer <METRICS_TOKEN>"; without a configured token
   * the endpoint does not exist.
   */
  @Public()
  @Get('metrics')
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  metrics(@Headers('authorization') authorization?: string) {
    const token = process.env.METRICS_TOKEN?.trim();
    if (!token) throw new NotFoundException();
    const given = /^Bearer\s+(.+)$/i.exec(authorization ?? '')?.[1]?.trim();
    const digest = (value: string) =>
      createHash('sha256').update(value).digest();
    if (!given || !timingSafeEqual(digest(given), digest(token)))
      throw new UnauthorizedException();
    return requestMetrics.render();
  }

  private async probe(
    url: string,
    headers: Record<string, string> = {},
  ): Promise<Check> {
    const started = Date.now();
    try {
      const result = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      return { ok: result.ok, latencyMs: Date.now() - started };
    } catch {
      return { ok: false, latencyMs: Date.now() - started };
    }
  }
}
