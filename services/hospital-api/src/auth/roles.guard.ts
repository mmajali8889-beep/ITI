import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { AuthSession } from './auth.types';
import { ROLES_KEY } from './roles.decorator';
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext) {
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;
    const request = context
        .switchToHttp()
        .getRequest<Request & { auth?: AuthSession }>(),
      roles = request.auth?.roles ?? [];
    if (!required.some((role) => roles.includes(role)))
      throw new ForbiddenException('Your role does not permit this operation');
    return true;
  }
}
