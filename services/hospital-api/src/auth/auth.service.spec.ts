import type { AuthSession } from './auth.types';
import { AuthService } from './auth.service';

describe('AuthService durable signed sessions', () => {
  const originalSecret = process.env.AUTH_SESSION_SECRET;

  beforeEach(() => {
    process.env.AUTH_SESSION_SECRET =
      'test-session-secret-that-is-longer-than-32-characters';
  });

  afterAll(() => {
    if (originalSecret === undefined) delete process.env.AUTH_SESSION_SECRET;
    else process.env.AUTH_SESSION_SECRET = originalSecret;
  });

  function issue(service: AuthService): string {
    const session = {
      hospitalId: 'hospital-a',
      expiresAt: Date.now() + 60_000,
      profile: {
        resourceType: 'Practitioner',
        id: 'practitioner-1',
        name: [{ text: 'Test Nurse' }],
      },
      roles: ['nurse'],
      permissions: ['dashboard', 'nursing'],
      medplum: { signOut: jest.fn() },
    } as unknown as Omit<AuthSession, 'id'>;
    return (
      service as unknown as {
        createSessionToken(value: Omit<AuthSession, 'id'>): string;
      }
    ).createSessionToken(session);
  }

  it('restores a valid session after the in-memory store is lost', () => {
    const token = issue(new AuthService());
    const restored = new AuthService().getSession(token);
    expect(restored).toMatchObject({
      hospitalId: 'hospital-a',
      roles: ['nurse'],
      permissions: ['dashboard', 'nursing'],
      profile: { id: 'practitioner-1' },
    });
  });

  it('rejects a tampered session token', () => {
    const token = issue(new AuthService());
    const [payload, signature] = token.split('.');
    expect(
      new AuthService().getSession(`${payload}x.${signature}`),
    ).toBeUndefined();
  });

  it('revokes a session during logout', async () => {
    const service = new AuthService();
    const token = issue(service);
    expect(service.getSession(token)).toBeDefined();
    await service.logout(token);
    expect(service.getSession(token)).toBeUndefined();
  });
});
