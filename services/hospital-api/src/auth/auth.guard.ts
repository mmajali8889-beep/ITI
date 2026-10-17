import {
  ForbiddenException,
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { IS_PUBLIC_KEY } from './public.decorator';

export const SESSION_COOKIE = 'unitech_ehr_session';

export function readSessionCookie(request: Request): string | undefined {
  const cookie = request.headers.cookie;
  if (!cookie) return undefined;
  return cookie
    .split(';')
    .map((part) => part.trim().split('='))
    .find(([name]) => name === SESSION_COOKIE)?.[1];
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context
      .switchToHttp()
      .getRequest<Request & { auth?: unknown }>();
    const session = this.authService.getSession(readSessionCookie(request));
    if (!session) throw new UnauthorizedException('Authentication required');

    const requestHospitalId =
      (request.params?.hospitalId as string | undefined) ??
      (request.query?.hospitalId as string | undefined) ??
      (request.body as { hospitalId?: string } | undefined)?.hospitalId;
    if (requestHospitalId && requestHospitalId !== session.hospitalId) {
      throw new ForbiddenException(
        'The request is outside the authenticated hospital boundary',
      );
    }

    request.auth = session;
    return true;
  }
}
