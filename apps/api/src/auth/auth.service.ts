import { randomBytes } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import argon2 from 'argon2';
import type { User } from '../generated/prisma/client.js';
import type { AuthUser } from '../common/auth-user.js';
import { parseDurationMs } from '../common/utils/duration.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AccessTokenPayload, RefreshTokenPayload } from './auth.constants.js';

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  accessMaxAgeMs: number;
  refreshMaxAgeMs: number;
}

export const INVALID_CREDENTIALS = 'Email o contraseña incorrectos';
export const SESSION_EXPIRED = 'La sesión expiró. Volvé a iniciar sesión.';

export function toAuthUser(user: Pick<User, 'id' | 'name' | 'email' | 'role'>): AuthUser {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

@Injectable()
export class AuthService {
  private readonly accessTtlMs: number;
  private readonly refreshTtlMs: number;
  private readonly accessSecret: string;
  private readonly refreshSecret: string;
  // Hash de una clave aleatoria: se verifica contra él cuando el email no existe, para que el
  // tiempo de respuesta no revele qué emails están registrados.
  private dummyHash?: Promise<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    config: ConfigService,
  ) {
    this.accessTtlMs = parseDurationMs(config.get<string>('JWT_ACCESS_TTL', '15m'));
    this.refreshTtlMs = parseDurationMs(config.get<string>('JWT_REFRESH_TTL', '7d'));
    this.accessSecret = config.getOrThrow<string>('JWT_ACCESS_SECRET');
    this.refreshSecret = config.getOrThrow<string>('JWT_REFRESH_SECRET');
  }

  async validateCredentials(email: string, password: string): Promise<User> {
    const user = await this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });
    this.dummyHash ??= argon2.hash(randomBytes(32).toString('hex'));
    const hash = user?.passwordHash ?? (await this.dummyHash);
    const passwordOk = await argon2.verify(hash, password).catch(() => false);
    if (!user || !passwordOk || !user.active) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }
    return user;
  }

  async issueTokens(user: Pick<User, 'id' | 'role' | 'tokenVersion'>): Promise<IssuedTokens> {
    const accessPayload: AccessTokenPayload = {
      sub: user.id,
      role: user.role,
      tv: user.tokenVersion,
    };
    const refreshPayload: RefreshTokenPayload = { sub: user.id, tv: user.tokenVersion };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(accessPayload, {
        secret: this.accessSecret,
        expiresIn: Math.floor(this.accessTtlMs / 1000),
      }),
      this.jwt.signAsync(refreshPayload, {
        secret: this.refreshSecret,
        expiresIn: Math.floor(this.refreshTtlMs / 1000),
      }),
    ]);
    return {
      accessToken,
      refreshToken,
      accessMaxAgeMs: this.accessTtlMs,
      refreshMaxAgeMs: this.refreshTtlMs,
    };
  }

  /** Valida el access token y devuelve el usuario vigente (activo y con la misma versión de token). */
  async authenticateAccessToken(token: string): Promise<AuthUser> {
    const payload = await this.verify<AccessTokenPayload>(token, this.accessSecret);
    const user = await this.findValidSessionUser(payload.sub, payload.tv);
    return toAuthUser(user);
  }

  /** Valida el refresh token y emite un par nuevo (rotación). */
  async refresh(token: string): Promise<{ user: AuthUser; tokens: IssuedTokens }> {
    const payload = await this.verify<RefreshTokenPayload>(token, this.refreshSecret);
    const user = await this.findValidSessionUser(payload.sub, payload.tv);
    return { user: toAuthUser(user), tokens: await this.issueTokens(user) };
  }

  /** Invalida todas las sesiones del usuario dueño del refresh token (si es válido). */
  async revokeByRefreshToken(token: string | undefined): Promise<void> {
    if (!token) return;
    let payload: RefreshTokenPayload;
    try {
      payload = await this.verify<RefreshTokenPayload>(token, this.refreshSecret);
    } catch {
      return; // Token inválido o vencido: no hay nada que revocar.
    }
    await this.prisma.user.updateMany({
      where: { id: payload.sub, tokenVersion: payload.tv },
      data: { tokenVersion: { increment: 1 } },
    });
  }

  private async verify<T extends object>(token: string, secret: string): Promise<T> {
    if (!token) throw new UnauthorizedException(SESSION_EXPIRED);
    try {
      return await this.jwt.verifyAsync<T>(token, { secret });
    } catch {
      throw new UnauthorizedException(SESSION_EXPIRED);
    }
  }

  private async findValidSessionUser(id: string, tokenVersion: number): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user || !user.active || user.tokenVersion !== tokenVersion) {
      throw new UnauthorizedException(SESSION_EXPIRED);
    }
    return user;
  }
}
