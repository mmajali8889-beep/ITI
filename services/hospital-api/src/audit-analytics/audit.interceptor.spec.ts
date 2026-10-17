import { of } from 'rxjs';
import { AuditInterceptor } from './audit.interceptor';

describe('AuditInterceptor', () => {
  it('audits medical-record reads and takes tenant scope from the query', (done) => {
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const interceptor = new AuditInterceptor(audit as never);
    const request = { method: 'GET', originalUrl: '/api/medical-records/queue?hospitalId=hospital-a', query: { hospitalId: 'hospital-a' }, ip: '127.0.0.1' };
    const context = { switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({ statusCode: 200 }) }) };
    interceptor.intercept(context as never, { handle: () => of({ ok: true }) }).subscribe({ complete: () => { expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ hospitalId: 'hospital-a', method: 'GET', route: '/api/medical-records/queue', statusCode: 200 })); done(); } });
  });

  it('does not audit unrelated reads', (done) => {
    const audit = { record: jest.fn() };
    const interceptor = new AuditInterceptor(audit as never);
    const context = { switchToHttp: () => ({ getRequest: () => ({ method: 'GET', originalUrl: '/api/patients', query: {} }), getResponse: () => ({ statusCode: 200 }) }) };
    interceptor.intercept(context as never, { handle: () => of([]) }).subscribe({ complete: () => { expect(audit.record).not.toHaveBeenCalled(); done(); } });
  });
});
