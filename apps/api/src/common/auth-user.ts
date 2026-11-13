import type { Request } from 'express';
import type { Role } from '../generated/prisma/enums.js';

/** Usuario autenticado que los guards adjuntan al request. */
export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export type AuthRequest = Request & { user?: AuthUser };
