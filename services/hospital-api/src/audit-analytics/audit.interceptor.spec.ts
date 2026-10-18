import { of } from 'rxjs';
import { AuditInterceptor } from './audit.interceptor';

describe('AuditInterceptor', () => {
  it('audits medical-record reads and takes tenant scope from the query', (done) => {
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const interceptor = new AuditInterceptor(audit as never);
    const request = {
      method: 'GET',
      originalUrl: '/api/medical-records/queue?hospitalId=hospital-a',
      query: { hospitalId: 'hospital-a' },
      ip: '127.0.0.1',
    };
    const context = {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({ statusCode: 200 }),
      }),
    };
    interceptor
      .intercept(context as never, { handle: () => of({ ok: true }) })
      .subscribe({
        complete: () => {
          expect(audit.record).toHaveBeenCalledWith(
            expect.objectContaining({
              hospitalId: 'hospital-a',
              method: 'GET',
              route: '/api/medical-records/queue',
              statusCode: 200,
            }),
          );
          done();
        },
      });
  });

  it('does not audit unrelated reads', (done) => {
    const audit = { record: jest.fn() };
    const interceptor = new AuditInterceptor(audit as never);
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'GET',
          originalUrl: '/api/patients',
          query: {},
        }),
        getResponse: () => ({ statusCode: 200 }),
      }),
    };
    interceptor
      .intercept(context as never, { handle: () => of([]) })
      .subscribe({
        complete: () => {
          expect(audit.record).not.toHaveBeenCalled();
          done();
        },
      });
  });

  const run = (request: Record<string, unknown>, result: unknown) =>
    new Promise<Record<string, unknown>>((resolve) => {
      const audit = { record: jest.fn().mockResolvedValue(undefined) };
      const interceptor = new AuditInterceptor(audit as never);
      const context = {
        switchToHttp: () => ({
          getRequest: () => ({
            params: {},
            query: {},
            body: {},
            ip: '127.0.0.1',
            auth: { hospitalId: 'hospital-a' },
            ...request,
          }),
          getResponse: () => ({ statusCode: 201 }),
        }),
      };
      interceptor
        .intercept(context as never, { handle: () => of(result) })
        .subscribe({ complete: () => resolve(audit.record.mock.calls[0][0]) });
    });

  it('records the patient and encounter from route params (27.1)', async () => {
    const recorded = await run(
      {
        method: 'POST',
        originalUrl: '/api/patient-journey/p-1/encounters/e-1',
        params: { patientId: 'p-1', encounterId: 'e-1' },
      },
      {},
    );
    expect(recorded).toMatchObject({ patientId: 'p-1', encounterId: 'e-1' });
  });

  it('audits portal-access actions against the patient, without the password', async () => {
    for (const [method, url] of [
      ['GET', '/api/medical-records/portal-access/p-1'],
      ['POST', '/api/medical-records/portal-access/p-1'],
      ['POST', '/api/medical-records/portal-access/p-1/disable'],
    ]) {
      const recorded = await run(
        {
          method,
          originalUrl: url,
          params: { patientId: 'p-1' },
          body: { username: 'ahmad', password: 'Secret-Pass1' },
        },
        { patientId: 'p-1', temporaryPassword: 'Generated-Pass1' },
      );
      expect(recorded).toMatchObject({
        patientId: 'p-1',
        route: url,
        method,
        record: undefined,
      });
      expect(JSON.stringify(recorded)).not.toMatch(
        /Secret-Pass1|Generated-Pass1/,
      );
    }
  });

  it('records the patient and encounter from the request body', async () => {
    const recorded = await run(
      {
        method: 'POST',
        originalUrl: '/api/vitals',
        body: {
          patientId: 'p-2',
          encounterId: 'e-2',
          hospitalId: 'hospital-a',
        },
      },
      { id: 'obs-1' },
    );
    expect(recorded).toMatchObject({ patientId: 'p-2', encounterId: 'e-2' });
  });

  it('records a newly created patient and visit from the response', async () => {
    expect(
      await run(
        { method: 'POST', originalUrl: '/api/patients' },
        { id: 'new-patient' },
      ),
    ).toMatchObject({ patientId: 'new-patient' });
    expect(
      await run(
        {
          method: 'POST',
          originalUrl: '/api/encounters',
          body: { patientId: 'p-3' },
        },
        { id: 'new-encounter' },
      ),
    ).toMatchObject({ patientId: 'p-3', encounterId: 'new-encounter' });
    expect(
      await run(
        {
          method: 'POST',
          originalUrl: '/api/encounters/emergency/quick-arrival',
        },
        { patient: { id: 'ed-p' }, encounter: { id: 'ed-e' } },
      ),
    ).toMatchObject({ patientId: 'ed-p', encounterId: 'ed-e' });
  });

  it('never writes a malformed id into an audit reference', async () => {
    const recorded = await run(
      {
        method: 'POST',
        originalUrl: '/api/vitals',
        body: { patientId: '../Organization/x', encounterId: 'e e' },
      },
      {},
    );
    expect(recorded.patientId).toBeUndefined();
    expect(recorded.encounterId).toBeUndefined();
  });

  it('does not treat another resource id as the patient', async () => {
    const recorded = await run(
      { method: 'POST', originalUrl: '/api/inventory/items' },
      { id: 'item-1' },
    );
    expect(recorded.patientId).toBeUndefined();
  });

  const audited = (request: Record<string, unknown>, result: unknown = {}) =>
    new Promise<Record<string, unknown> | undefined>((resolve) => {
      const audit = { record: jest.fn().mockResolvedValue(undefined) };
      const interceptor = new AuditInterceptor(audit as never);
      const context = {
        switchToHttp: () => ({
          getRequest: () => ({
            params: {},
            query: {},
            body: {},
            ip: '127.0.0.1',
            auth: { hospitalId: 'hospital-a' },
            ...request,
          }),
          getResponse: () => ({ statusCode: 200 }),
        }),
      };
      interceptor
        .intercept(context as never, { handle: () => of(result) })
        .subscribe({
          complete: () => resolve(audit.record.mock.calls[0]?.[0]),
        });
    });

  it('audits chart reads that name a patient or encounter (27.5)', async () => {
    expect(
      await audited({
        method: 'GET',
        originalUrl: '/api/patients/p-9',
        params: { patientId: 'p-9' },
      }),
    ).toMatchObject({ method: 'GET', patientId: 'p-9' });
    expect(
      await audited({
        method: 'GET',
        originalUrl: '/api/vitals?encounterId=e-9',
        query: { encounterId: 'e-9' },
      }),
    ).toMatchObject({ encounterId: 'e-9' });
  });

  it('audits reads of a clinical record by its id and passes the record on (27.4/27.5)', async () => {
    const recorded = await audited({
      method: 'GET',
      originalUrl: '/api/laboratory/results/obs-1',
    });
    expect(recorded).toMatchObject({
      method: 'GET',
      record: { id: 'obs-1', types: ['Observation'] },
    });
  });

  it('does not audit a registry search that names no patient', async () => {
    expect(
      await audited({
        method: 'GET',
        originalUrl: '/api/patients?search=smith',
        query: { search: 'smith' },
      }),
    ).toBeUndefined();
  });

  it('picks up a patient nested one level in the response, and an order hint', async () => {
    expect(
      await audited(
        { method: 'POST', originalUrl: '/api/billing/invoices/inv-1/payments' },
        { invoice: { patientId: 'p-7', encounterId: 'e-7' } },
      ),
    ).toMatchObject({ patientId: 'p-7', encounterId: 'e-7' });
    expect(
      await audited(
        {
          method: 'POST',
          originalUrl: '/api/radiology/pacs/sync/accession/RAD1',
        },
        { orderId: 'sr-1', studiesFound: 1 },
      ),
    ).toMatchObject({ record: { id: 'sr-1', types: ['ServiceRequest'] } });
  });

  it('never mistakes literal path segments for record ids', async () => {
    expect(
      (
        await audited({
          method: 'GET',
          originalUrl: '/api/laboratory/reports/patient/p-1',
          params: { patientId: 'p-1' },
        })
      )?.record,
    ).toBeUndefined();
    expect(
      (
        await audited({
          method: 'POST',
          originalUrl: '/api/laboratory/results/batch',
        })
      )?.record,
    ).toBeUndefined();
  });
});
