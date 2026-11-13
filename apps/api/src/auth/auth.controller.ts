import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { CookieOptions, Request, Response } from 'express';
import type { AuthUser } from '../common/auth-user.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';
import { ACCESS_COOKIE, REFRESH_COOKIE } from './auth.constants.js';
import { AuthService, IssuedTokens, toAuthUser } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';
import { readCookie } from './jwt-auth.guard.js';

@Controller('auth')
export class AuthController {
  private readonly secureCookies: boolean;

  constructor(
    private readonly auth: AuthService,
    config: ConfigService,
  ) {
    this.secureCookies = config.get<string>('NODE_ENV') === 'production';
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ user: AuthUser }> {
    const user = await this.auth.validateCredentials(dto.email, dto.password);
    this.setSessionCookies(res, await this.auth.issueTokens(user));
    return { user: toAuthUser(user) };
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ user: AuthUser }> {
    try {
      const { user, tokens } = await this.auth.refresh(readCookie(req, REFRESH_COOKIE) ?? '');
      this.setSessionCookies(res, tokens);
      return { user };
    } catch (error) {
      this.clearSessionCookies(res);
      throw error;
    }
  }

  // Pública a propósito: cerrar sesión tiene que funcionar aunque el access token ya haya vencido.
  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.revokeByRefreshToken(readCookie(req, REFRESH_COOKIE));
    this.clearSessionCookies(res);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser): { user: AuthUser } {
    return { user };
  }

  private cookieOptions(maxAge?: number): CookieOptions {
    return { httpOnly: true, secure: this.secureCookies, sameSite: 'lax', path: '/', maxAge };
  }

  private setSessionCookies(res: Response, tokens: IssuedTokens): void {
    res.cookie(ACCESS_COOKIE, tokens.accessToken, this.cookieOptions(tokens.accessMaxAgeMs));
    res.cookie(REFRESH_COOKIE, tokens.refreshToken, this.cookieOptions(tokens.refreshMaxAgeMs));
  }

  private clearSessionCookies(res: Response): void {
    res.clearCookie(ACCESS_COOKIE, this.cookieOptions());
    res.clearCookie(REFRESH_COOKIE, this.cookieOptions());
  }
}
