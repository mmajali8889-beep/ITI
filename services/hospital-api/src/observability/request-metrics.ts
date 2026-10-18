import type { NextFunction, Request, Response } from 'express';

/**
 * Request counters and structured request logs (roadmap 28.2).
 *
 * Counters live in this process and reset when it restarts; whoever scrapes
 * them (check-health.sh, Prometheus) compares successive readings. The request
 * log is one JSON line per request on stdout, collected by the container log
 * driver (journald in production) and forwarded centrally from there.
 *
 * Nothing patient-identifying is logged: no query strings, bodies or headers,
 * and record ids in the path are masked.
 */
export class RequestMetrics {
  private readonly startedAt = Date.now();
  private readonly byClass = new Map<string, number>();
  private readonly byStatus = new Map<number, number>();
  private medplumThrottled = 0;
  private durationSumMs = 0;
  private count = 0;

  record(status: number, durationMs: number): void {
    const statusClass = `${Math.floor(status / 100)}xx`;
    this.byClass.set(statusClass, (this.byClass.get(statusClass) ?? 0) + 1);
    if (status === 429 || status >= 500)
      this.byStatus.set(status, (this.byStatus.get(status) ?? 0) + 1);
    this.durationSumMs += durationMs;
    this.count += 1;
  }

  /** Medplum refused a request with "Too Many Requests" (answered as 503). */
  recordMedplumThrottle(): void {
    this.medplumThrottled += 1;
  }

  snapshot() {
    const status = (predicate: (code: number) => boolean) =>
      [...this.byStatus].reduce(
        (sum, [code, n]) => (predicate(code) ? sum + n : sum),
        0,
      );
    return {
      requests: this.count,
      byClass: Object.fromEntries(this.byClass),
      errors5xx: status((code) => code >= 500),
      rateLimited429: status((code) => code === 429),
      medplumThrottled: this.medplumThrottled,
      durationSumMs: this.durationSumMs,
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
    };
  }

  /** Prometheus text exposition format. */
  render(): string {
    const s = this.snapshot();
    const lines = [
      '# HELP ehr_http_requests_total HTTP requests answered, by status class.',
      '# TYPE ehr_http_requests_total counter',
      ...['1xx', '2xx', '3xx', '4xx', '5xx'].map(
        (c) => `ehr_http_requests_total{class="${c}"} ${s.byClass[c] ?? 0}`,
      ),
      '# HELP ehr_http_errors_total Responses with status 5xx.',
      '# TYPE ehr_http_errors_total counter',
      `ehr_http_errors_total ${s.errors5xx}`,
      '# HELP ehr_http_rate_limited_total Responses with status 429.',
      '# TYPE ehr_http_rate_limited_total counter',
      `ehr_http_rate_limited_total ${s.rateLimited429}`,
      '# HELP ehr_medplum_throttled_total Requests Medplum refused as Too Many Requests.',
      '# TYPE ehr_medplum_throttled_total counter',
      `ehr_medplum_throttled_total ${s.medplumThrottled}`,
      '# HELP ehr_http_responses_total 429 and 5xx responses, by status.',
      '# TYPE ehr_http_responses_total counter',
      ...[...this.byStatus]
        .sort(([a], [b]) => a - b)
        .map(([code, n]) => `ehr_http_responses_total{status="${code}"} ${n}`),
      '# HELP ehr_http_request_duration_ms Total and count of request durations.',
      '# TYPE ehr_http_request_duration_ms summary',
      `ehr_http_request_duration_ms_sum ${s.durationSumMs}`,
      `ehr_http_request_duration_ms_count ${s.requests}`,
      '# HELP ehr_process_uptime_seconds Seconds since this API process started.',
      '# TYPE ehr_process_uptime_seconds gauge',
      `ehr_process_uptime_seconds ${s.uptimeSeconds}`,
    ];
    return `${lines.join('\n')}\n`;
  }
}

/** One instance per process, shared by the middleware, filter and controller. */
export const requestMetrics = new RequestMetrics();

const ID_SEGMENT =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f.]{16,}|(?=[A-Za-z0-9._-]*\d)[A-Za-z0-9._-]{6,})$/i;

/** The path with record ids replaced by ":id", so logs group by route and hold no ids. */
export function maskPath(path: string): string {
  return path
    .split('/')
    .map((segment) => (ID_SEGMENT.test(segment) ? ':id' : segment))
    .join('/');
}

/** Requests the logs skip (they are still counted): probes polled every few seconds. */
const QUIET = new Set(['/api/health/live', '/api/health/metrics']);

export function requestLogEnabled(env: NodeJS.ProcessEnv = process.env) {
  const setting = env.REQUEST_LOG?.toLowerCase();
  if (setting === 'off' || setting === 'false') return false;
  if (setting === 'on' || setting === 'true' || setting === 'json') return true;
  return env.NODE_ENV === 'production';
}

/** Express middleware: count every response and, if enabled, log it. */
export function requestObserver(
  metrics: RequestMetrics = requestMetrics,
  log: boolean = requestLogEnabled(),
  write: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
) {
  return (request: Request, response: Response, next: NextFunction) => {
    const started = process.hrtime.bigint();
    response.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
      metrics.record(response.statusCode, durationMs);
      const path = (request.originalUrl ?? request.url).split('?')[0];
      if (!log || QUIET.has(path)) return;
      write(
        JSON.stringify({
          time: new Date().toISOString(),
          level:
            response.statusCode >= 500
              ? 'error'
              : response.statusCode >= 400
                ? 'warn'
                : 'info',
          msg: 'request',
          method: request.method,
          path: maskPath(path),
          status: response.statusCode,
          durationMs: Math.round(durationMs),
          ip: request.ip,
        }),
      );
    });
    next();
  };
}
