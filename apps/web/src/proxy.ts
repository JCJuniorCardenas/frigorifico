import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Chequeo optimista: si no hay cookie de sesión, manda al login sin cargar la app.
 * La validación real la hace la API en cada request.
 */
export function proxy(request: NextRequest) {
  const hasSession = request.cookies.has('refresh_token');
  const { pathname, search } = request.nextUrl;

  if (pathname === '/login') {
    return hasSession ? NextResponse.redirect(new URL('/', request.url)) : NextResponse.next();
  }
  if (!hasSession) {
    const url = new URL('/login', request.url);
    url.searchParams.set('next', pathname + search);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Todo menos la API reenviada, los assets de Next y archivos estáticos.
  matcher: ['/((?!api/|_next/|favicon.ico).*)'],
};
