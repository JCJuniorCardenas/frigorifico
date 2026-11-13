'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import type { SessionUser } from '@/lib/types';

interface AuthContextValue {
  /** null mientras se valida la sesión. */
  user: SessionUser | null;
  /** Error al validar la sesión (por ejemplo, API caída). */
  error: string | null;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return value;
}

/**
 * Carga el usuario de la sesión; si no hay sesión válida, manda al login.
 * Siempre renderiza a sus hijos (cada pantalla muestra su propio estado de carga), así Next
 * puede pre-renderizar el esqueleto de las páginas.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Si la sesión venció, apiFetch intenta renovarla y, si no puede, redirige al login.
    api
      .get<{ user: SessionUser }>('/auth/me')
      .then((res) => {
        if (!cancelled) setUser(res.user);
      })
      .catch((e: unknown) => {
        if (cancelled || (e instanceof ApiError && e.status === 401)) return;
        setError(e instanceof Error ? e.message : 'No se pudo cargar la sesión');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => undefined);
    // Recarga completa a propósito: Next conserva el estado de páginas ya visitadas y no queremos
    // que quede nada de la sesión anterior en memoria (ni datos, ni el formulario de login).
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign('/login');
  }, []);

  return <AuthContext.Provider value={{ user, error, logout }}>{children}</AuthContext.Provider>;
}
