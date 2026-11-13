import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthUser } from '../common/auth-user.js';
import type { Role } from '../generated/prisma/enums.js';
import { RolesGuard } from './roles.guard.js';

function contextFor(user: AuthUser | undefined): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

function guardWith(roles: Role[] | undefined): RolesGuard {
  const reflector = { getAllAndOverride: vi.fn().mockReturnValue(roles) };
  return new RolesGuard(reflector as unknown as Reflector);
}

const admin: AuthUser = { id: '1', name: 'Admin', email: 'a@x.com', role: 'ADMIN' };
const user: AuthUser = { id: '2', name: 'User', email: 'u@x.com', role: 'USER' };

describe('RolesGuard', () => {
  it('deja pasar rutas sin @Roles', () => {
    expect(guardWith(undefined).canActivate(contextFor(user))).toBe(true);
  });

  it('deja pasar a un ADMIN en rutas de ADMIN', () => {
    expect(guardWith(['ADMIN']).canActivate(contextFor(admin))).toBe(true);
  });

  it('rechaza a un USER en rutas de ADMIN', () => {
    expect(() => guardWith(['ADMIN']).canActivate(contextFor(user))).toThrow(ForbiddenException);
  });

  it('rechaza si no hay usuario en el request', () => {
    expect(() => guardWith(['ADMIN']).canActivate(contextFor(undefined))).toThrow(
      ForbiddenException,
    );
  });
});
