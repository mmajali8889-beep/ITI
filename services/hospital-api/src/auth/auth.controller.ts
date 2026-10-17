import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { Public } from './public.decorator';
import { readSessionCookie, SESSION_COOKIE } from './auth.guard';

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
};

@Controller('api/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  async login(
    @Body()
    body: {
      hospitalId?: string;
      username?: string;
      password?: string;
      remember?: boolean;
    },
    @Res({ passthrough: true }) response: Response,
  ) {
    const session = await this.authService.login(body);
    response.cookie(SESSION_COOKIE, session.id, {
      ...COOKIE_OPTIONS,
      maxAge: body.remember ? 30 * 24 * 60 * 60 * 1000 : undefined,
    });
    return this.authService.toResponse(session);
  }

  @Public()
  @Get('session')
  session(@Req() request: Request) {
    const session = this.authService.getSession(readSessionCookie(request));
    if (!session) throw new UnauthorizedException('Authentication required');
    return this.authService.toResponse(session);
  }

  @Post('logout')
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.authService.logout(readSessionCookie(request));
    response.clearCookie(SESSION_COOKIE, COOKIE_OPTIONS);
    return { authenticated: false };
  }
}
