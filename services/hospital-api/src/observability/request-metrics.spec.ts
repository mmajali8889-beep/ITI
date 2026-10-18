import { EventEmitter } from 'node:events';
import {
  RequestMetrics,
  maskPath,
  requestLogEnabled,
  requestObserver,
} from './request-metrics';

function fakeRequest(url: string, method = 'GET') {
  return { originalUrl: url, url, method, ip: '10.0.0.5' } as never;
}

function fakeResponse(statusCode: number) {
  const response = new EventEmitter() as EventEmitter & { statusCode: number };
  response.statusCode = statusCode;
  return response;
}

describe('RequestMetrics (28.2)', () => {
  it('counts responses by class, 5xx, 429 and Medplum throttling', () => {
    const metrics = new RequestMetrics();
    for (const status of [200, 201, 404, 429, 500, 503])
      metrics.record(status, 10);
    metrics.recordMedplumThrottle();
    expect(metrics.snapshot()).toMatchObject({
      requests: 6,
      byClass: { '2xx': 2, '4xx': 2, '5xx': 2 },
      errors5xx: 2,
      rateLimited429: 1,
      medplumThrottled: 1,
      durationSumMs: 60,
    });
    const text = metrics.render();
    expect(text).toContain('ehr_http_requests_total{class="5xx"} 2');
    expect(text).toContain('ehr_http_errors_total 2');
    expect(text).toContain('ehr_http_rate_limited_total 1');
    expect(text).toContain('ehr_medplum_throttled_total 1');
    expect(text).toContain('ehr_http_responses_total{status="503"} 1');
    expect(text.endsWith('\n')).toBe(true);
  });

  it('masks record ids in paths', () => {
    expect(
      maskPath(
        '/api/patient-journey/9b0904f5-69e4-4d25-9bf0-c7577aa78e98/encounters/9bc980f7-ae97-4935-8537-72d212fe705b',
      ),
    ).toBe('/api/patient-journey/:id/encounters/:id');
    expect(maskPath('/api/patients/HA-000123')).toBe('/api/patients/:id');
    expect(maskPath('/api/medical-records/portal-access/p1/disable')).toBe(
      '/api/medical-records/portal-access/p1/disable',
    );
    expect(maskPath('/api/health/live')).toBe('/api/health/live');
  });

  it('logs one JSON line per request, without query string or ids', () => {
    const metrics = new RequestMetrics();
    const lines: string[] = [];
    const observe = requestObserver(metrics, true, (line) => lines.push(line));
    const response = fakeResponse(500);
    observe(
      fakeRequest(
        '/api/patients/9b0904f5-69e4-4d25-9bf0-c7577aa78e98?search=Ahmad',
      ),
      response as never,
      () => undefined,
    );
    response.emit('finish');
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(entry).toMatchObject({
      level: 'error',
      msg: 'request',
      method: 'GET',
      path: '/api/patients/:id',
      status: 500,
    });
    expect(lines[0]).not.toMatch(/Ahmad|9b0904f5/);
    expect(metrics.snapshot().errors5xx).toBe(1);
  });

  it('counts but does not log probes, and logs nothing when disabled', () => {
    const metrics = new RequestMetrics();
    const lines: string[] = [];
    const probe = fakeResponse(200);
    requestObserver(metrics, true, (l) => lines.push(l))(
      fakeRequest('/api/health/live'),
      probe as never,
      () => undefined,
    );
    probe.emit('finish');
    const quiet = fakeResponse(200);
    requestObserver(metrics, false, (l) => lines.push(l))(
      fakeRequest('/api/patients'),
      quiet as never,
      () => undefined,
    );
    quiet.emit('finish');
    expect(lines).toEqual([]);
    expect(metrics.snapshot().requests).toBe(2);
  });

  it('logs by default only in production', () => {
    expect(requestLogEnabled({ NODE_ENV: 'production' })).toBe(true);
    expect(requestLogEnabled({ NODE_ENV: 'development' })).toBe(false);
    expect(
      requestLogEnabled({ NODE_ENV: 'development', REQUEST_LOG: 'on' }),
    ).toBe(true);
    expect(
      requestLogEnabled({ NODE_ENV: 'production', REQUEST_LOG: 'off' }),
    ).toBe(false);
  });
});
