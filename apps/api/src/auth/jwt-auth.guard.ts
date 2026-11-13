import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthRequest } from '../common/auth-user.js';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator.js';
import { ACCESS_COOKIE } from './auth.constants.js';
import { AuthService } from './auth.service.js';

/** Guard global: toda ruta requiere sesión salvo las marcadas con @Public(). */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthRequest>();
    const token = readCookie(request, ACCESS_COOKIE);
    if (!token) {
      throw new UnauthorizedException('Tenés que iniciar sesión');
    }
    request.user = await this.auth.authenticateAccessToken(token);
    return true;
  }
}

export function readCookie(request: AuthRequest, name: string): string | undefined {
  const cookies = request.cookies as Record<string, unknown> | undefined;
  const value = cookies?.[name];
  return typeof value === 'string' && value !== '' ? value : undefined;
}
