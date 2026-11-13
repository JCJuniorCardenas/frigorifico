/**
 * Cliente HTTP del frontend. Todas las llamadas van a /api/* (Next.js las reenvía a la API),
 * así las cookies httpOnly de sesión viajan solas y nunca se tocan desde JavaScript.
 */

export interface ErrorBody {
  message?: string | string[];
  /** Código de error de la API (ej. "DUPLICATE_INVOICE", "NOT_AN_INVOICE"). */
  code?: string;
  [key: string]: unknown;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Cuerpo completo de la respuesta de error, para datos extra (ej. la factura duplicada). */
    readonly body: ErrorBody = {},
    /** Mensajes individuales (por ejemplo, uno por campo inválido). */
    readonly messages: string[] = [message],
  ) {
    super(message);
  }
}

async function toApiError(res: Response): Promise<ApiError> {
  let message = 'Ocurrió un error inesperado. Probá de nuevo.';
  let messages: string[] = [];
  let body: ErrorBody = {};
  try {
    body = (await res.json()) as ErrorBody;
    if (Array.isArray(body.message)) {
      messages = body.message;
      message = body.message.join('. ');
    } else if (body.message) {
      message = body.message;
    }
  } catch {
    // Respuesta sin JSON: se usa el mensaje genérico.
  }
  if (res.status === 429) message = 'Demasiados intentos. Esperá un minuto y probá de nuevo.';
  return new ApiError(res.status, message, body, messages.length > 0 ? messages : [message]);
}

// Estas rutas no se reintentan: un 401 ahí es la respuesta esperada (p. ej. clave incorrecta).
const NO_REFRESH_PATHS = new Set(['/auth/login', '/auth/refresh', '/auth/logout']);

let refreshing: Promise<boolean> | null = null;

/** Renueva la sesión una sola vez aunque varias requests fallen a la vez. */
function refreshSession(): Promise<boolean> {
  refreshing ??= fetch('/api/auth/refresh', { method: 'POST' })
    .then((res) => res.ok)
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

function redirectToLogin(): void {
  if (window.location.pathname === '/login') return;
  const next = encodeURIComponent(window.location.pathname + window.location.search);
  // Recarga completa a propósito: descarta todo el estado de la sesión vencida.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign(`/login?next=${next}`);
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  const doFetch = () => fetch(`/api${path}`, { ...init, headers });

  let res = await doFetch();
  if (res.status === 401 && !NO_REFRESH_PATHS.has(path)) {
    if (await refreshSession()) {
      res = await doFetch();
    }
    if (res.status === 401) {
      redirectToLogin();
    }
  }
  if (!res.ok) throw await toApiError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string) => apiFetch<T>(path),
  post: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, {
      method: 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  patch: <T>(path: string, body: unknown) =>
    apiFetch<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
};
