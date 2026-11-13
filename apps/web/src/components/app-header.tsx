'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from './auth-provider';

const links = [
  { href: '/', label: 'Facturas', adminOnly: false },
  { href: '/cargar', label: 'Cargar', adminOnly: false },
  { href: '/ventas', label: 'Ventas', adminOnly: false },
  { href: '/stock', label: 'Stock', adminOnly: false },
  { href: '/ingresos', label: 'Ingresos', adminOnly: false },
  { href: '/catalogo', label: 'Catálogo', adminOnly: false },
  { href: '/usuarios', label: 'Usuarios', adminOnly: true },
];

export function AppHeader() {
  const { user, error, logout } = useAuth();
  const pathname = usePathname();

  return (
    <header className="border-b border-stone-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <span className="font-semibold">Control de faena</span>
        <nav className="flex gap-1">
          {links
            .filter((l) => !l.adminOnly || user?.role === 'ADMIN')
            .map((l) => {
              const active = l.href === '/' ? pathname === '/' : pathname.startsWith(l.href);
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  className={`rounded-md px-3 py-1.5 text-sm ${
                    active ? 'bg-stone-900 text-white' : 'text-stone-700 hover:bg-stone-100'
                  }`}
                >
                  {l.label}
                </Link>
              );
            })}
        </nav>
        {user && (
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="text-stone-600">
              {user.name}
              {user.role === 'ADMIN' && (
                <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                  Admin
                </span>
              )}
            </span>
            <button
              type="button"
              onClick={() => void logout()}
              className="rounded-md border border-stone-300 px-3 py-1.5 hover:bg-stone-100"
            >
              Cerrar sesión
            </button>
          </div>
        )}
      </div>
      {error && (
        <p className="bg-red-50 px-4 py-2 text-center text-sm text-red-700">
          {error}. Revisá que la API esté levantada.
        </p>
      )}
    </header>
  );
}
