'use client';

import { type ReactNode, useEffect, useState } from 'react';
import { ApiError } from '@/lib/api';

/** Piezas compartidas por las pantallas del catálogo. */

export const inputClass =
  'w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-stone-900';
export const primaryButton =
  'rounded-md bg-stone-900 px-3 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-60';
export const secondaryButton =
  'rounded-md border border-stone-300 px-3 py-2 text-sm hover:bg-stone-100 disabled:opacity-60';
export const rowButton =
  'rounded-md border border-stone-300 px-2.5 py-1 text-xs hover:bg-stone-100 disabled:opacity-60';

export function errorMessages(error: unknown): string[] {
  return error instanceof ApiError ? error.messages : ['Ocurrió un error. Probá de nuevo.'];
}

export function Errors({ messages }: { messages: string[] }) {
  if (messages.length === 0) return null;
  return (
    <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
      {messages.map((m) => (
        <p key={m}>{m}</p>
      ))}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-stone-500">{hint}</span>}
    </label>
  );
}

export function StatusBadge({ active }: { active: boolean }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-xs ${
        active ? 'bg-green-100 text-green-800' : 'bg-stone-200 text-stone-600'
      }`}
    >
      {active ? 'Activo' : 'Inactivo'}
    </span>
  );
}

/** Carga una lista desde la API; `reload()` la vuelve a pedir. */
export function useList<T>(load: () => Promise<T[]>) {
  const [items, setItems] = useState<T[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    load()
      .then((list) => {
        if (cancelled) return;
        setItems(list);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'No se pudo cargar la lista');
      });
    return () => {
      cancelled = true;
    };
    // `load` es una función estable del módulo catalogApi.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey]);

  return { items, error, reload: () => setReloadKey((k) => k + 1) };
}

/** Busca sin distinguir mayúsculas ni acentos ("vacio" encuentra "Vacío"). */
export function matches(text: string, search: string): boolean {
  const normalize = (s: string) =>
    s
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase();
  return normalize(text).includes(normalize(search.trim()));
}

/** Cabecera de cada pestaña: buscador, "mostrar inactivos" y botón de alta. */
export function ListToolbar({
  search,
  onSearch,
  placeholder,
  showInactive,
  onShowInactive,
  newLabel,
  onNew,
}: {
  search: string;
  onSearch: (value: string) => void;
  placeholder: string;
  showInactive: boolean;
  onShowInactive: (value: boolean) => void;
  newLabel: string;
  onNew: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <input
        type="search"
        value={search}
        onChange={(e) => onSearch(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className={`${inputClass} max-w-xs`}
      />
      <label className="flex items-center gap-2 text-sm text-stone-700">
        <input
          type="checkbox"
          checked={showInactive}
          onChange={(e) => onShowInactive(e.target.checked)}
        />
        Mostrar inactivos
      </label>
      <button type="button" onClick={onNew} className={`${primaryButton} ml-auto`}>
        {newLabel}
      </button>
    </div>
  );
}
