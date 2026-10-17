import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
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
