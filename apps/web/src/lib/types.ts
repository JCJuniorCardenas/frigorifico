export type Role = 'ADMIN' | 'USER';

/** Usuario de la sesión actual (lo que devuelve /auth/me). */
export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

/** Usuario tal como lo lista /users (solo ADMIN). */
export interface ManagedUser extends SessionUser {
  active: boolean;
  createdAt: string;
  updatedAt: string;
}
