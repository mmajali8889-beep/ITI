import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { HealthController } from './health.controller';

describe('HealthController (28.2)', () => {
  const realFetch = global.fetch;
  const env = { ...process.env };
  afterEach(() => {
    global.fetch = realFetch;
    process.env = { ...env };
  });

  const respond = (up: { medplum: boolean; orthanc: boolean }) => {
    process.env.MEDPLUM_BASE_URL = 'http://medplum:8103/';
    process.env.ORTHANC_URL = 'http://orthanc:8042';
    global.fetch = jest.fn(async (url: string | URL | Request) => {
      const target =
        typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
      if (target.includes('medplum') && !up.medplum)
        throw new Error('ECONNREFUSED');
      const ok = target.includes('medplum') ? up.medplum : up.orthanc;
      return { ok, status: ok ? 200 : 500 } as Response;
    }) as typeof fetch;
    const status = jest.fn();
    return { status, response: { status } as never };
  };

  describe('metrics', () => {
    it('does not exist without a configured token', () => {
      delete process.env.METRICS_TOKEN;
      expect(() => new HealthController().metrics('Bearer x')).toThrow(
        NotFoundException,
      );
    });

    it('needs the token, and then returns Prometheus text', () => {
      process.env.METRICS_TOKEN = 'metrics-token-for-tests';
      const controller = new HealthController();
      expect(() => controller.metrics()).toThrow(UnauthorizedException);
      expect(() => controller.metrics('Bearer wrong')).toThrow(
        UnauthorizedException,
      );
      expect(controller.metrics('Bearer metrics-token-for-tests')).toContain(
        'ehr_http_errors_total',
      );
    });
  });

  it('reports liveness without touching dependencies', () => {
    expect(new HealthController().live()).toEqual({ status: 'ok' });
  });

  it('is ready (200) when Medplum and Orthanc answer', async () => {
    const { status, response } = respond({ medplum: true, orthanc: true });
    const result = await new HealthController().ready(response);
    expect(status).toHaveBeenCalledWith(200);
    expect(result).toMatchObject({
      status: 'ok',
      checks: { medplum: { ok: true }, orthanc: { ok: true } },
    });
    expect(global.fetch).toHaveBeenCalledWith(
      'http://medplum:8103/healthcheck',
      expect.anything(),
    );
  });

  it('is degraded (503) when a dependency is down, without leaking error details', async () => {
    const { status, response } = respond({ medplum: false, orthanc: true });
    const result = await new HealthController().ready(response);
    expect(status).toHaveBeenCalledWith(503);
    expect(result).toMatchObject({
      status: 'degraded',
      checks: { medplum: { ok: false }, orthanc: { ok: true } },
    });
    expect(JSON.stringify(result)).not.toMatch(/ECONNREFUSED|medplum:8103/);
  });
});
