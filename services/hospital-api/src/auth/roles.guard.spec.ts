import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
describe('RolesGuard', () => {
  function context(roles: string[]) {
    return {
      switchToHttp: () => ({ getRequest: () => ({ auth: { roles } }) }),
      getHandler: () => class {},
      getClass: () => class {},
    } as never;
  }
  it('allows a matching administrative role', () => {
    const reflector = {
      getAllAndOverride: () => ['administrator', 'system-administrator'],
    } as unknown as Reflector;
    expect(
      new RolesGuard(reflector).canActivate(context(['administrator'])),
    ).toBe(true);
  });
  it('rejects a user without a required role', () => {
    const reflector = {
      getAllAndOverride: () => ['administrator'],
    } as unknown as Reflector;
    expect(() =>
      new RolesGuard(reflector).canActivate(context(['nurse'])),
    ).toThrow(ForbiddenException);
  });
  it('allows authenticated endpoints without role metadata', () => {
    const reflector = {
      getAllAndOverride: () => undefined,
    } as unknown as Reflector;
    expect(new RolesGuard(reflector).canActivate(context([]))).toBe(true);
  });
});
