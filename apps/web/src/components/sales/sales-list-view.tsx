'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { Errors } from '@/components/catalog/catalog-ui';
import { formatIsoDate, formatKg, formatMoney } from '@/lib/format';
import {
  PAYMENT_LABELS,
  PAYMENT_METHODS,
  type PaymentMethod,
  type SaleListResponse,
  type SaleQuery,
  type SaleStatusFilter,
  type SaleSummary,
  formatTime,
  salesApi,
} from '@/lib/sales';
import { todayInArgentina } from '@/lib/stock';
import { SaleDetailDialog, VoidSaleDialog } from './sale-dialogs';

const PAGE_SIZE = 25;
const filterInput =
  'rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-stone-900';
const STATUS_OPTIONS: { value: SaleStatusFilter; label: string }[] = [
  { value: 'active', label: 'Vigentes' },
  { value: 'voided', label: 'Anuladas' },
  { value: 'all', label: 'Todas' },
];

/** Listado de ventas con filtro por fecha (por defecto, hoy) y anulación (solo ADMIN). */
export function SalesListView() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  // null hasta montar: "hoy" se calcula en el navegador.
  const [filters, setFilters] = useState<SaleQuery | null>(null);
  const [data, setData] = useState<SaleListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [voiding, setVoiding] = useState<SaleSummary | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const today = todayInArgentina();
    // "Hoy" solo se puede calcular en el navegador (Next no admite new Date() en el prerender),
    // así que el filtro inicial se fija una vez al montar.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFilters({ from: today, to: today, status: 'all', page: 1, pageSize: PAGE_SIZE });
  }, []);

  useEffect(() => {
    if (!filters) return;
    let cancelled = false;
    salesApi
      .list(filters)
      .then((res) => {
        if (cancelled) return;
        setData(res);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'No se pudieron cargar');
      });
    return () => {
      cancelled = true;
    };
  }, [filters, reloadKey]);

  if (!filters) return <p className="text-stone-500">Cargando…</p>;

  const update = (patch: SaleQuery) => setFilters((f) => ({ ...f, ...patch, page: 1 }));
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Ventas</h1>
        <Link
          href="/ventas"
          className="rounded-md bg-stone-900 px-3 py-2 text-sm font-medium text-white hover:bg-stone-800"
        >
          Ir al mostrador
        </Link>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-stone-200 bg-white p-3">
        <label className="flex flex-col gap-1 text-xs text-stone-600">
          Desde
          <input
            type="date"
            value={filters.from ?? ''}
            onChange={(e) => update({ from: e.target.value })}
            className={filterInput}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-stone-600">
          Hasta
          <input
            type="date"
            value={filters.to ?? ''}
            onChange={(e) => update({ to: e.target.value })}
            className={filterInput}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-stone-600">
          Forma de pago
          <select
            value={filters.paymentMethod ?? ''}
            onChange={(e) => update({ paymentMethod: e.target.value as PaymentMethod | '' })}
            className={filterInput}
          >
            <option value="">Todas</option>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {PAYMENT_LABELS[m]}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-col gap-1 text-xs text-stone-600">
          Estado
          <div className="flex rounded-md border border-stone-300 p-0.5" role="group">
            {STATUS_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                aria-pressed={filters.status === opt.value}
                onClick={() => update({ status: opt.value })}
                className={`rounded px-2.5 py-1 text-sm ${
                  filters.status === opt.value
                    ? 'bg-stone-900 text-white'
                    : 'text-stone-700 hover:bg-stone-100'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      {notice && (
        <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
          {notice}
        </p>
      )}
      {error && <Errors messages={[error]} />}

      <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-stone-200 bg-stone-50 text-stone-600">
            <tr>
              <th className="px-4 py-2 font-medium">Fecha</th>
              <th className="px-4 py-2 font-medium">Cliente</th>
              <th className="px-4 py-2 font-medium">Pago</th>
              <th className="px-4 py-2 text-right font-medium">Kg</th>
              <th className="px-4 py-2 text-right font-medium">Total</th>
              <th className="px-4 py-2 font-medium">Vendió</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {data === null && !error && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-stone-500">
                  Cargando…
                </td>
              </tr>
            )}
            {data?.items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-stone-500">
                  No hay ventas en el período elegido.
                </td>
              </tr>
            )}
            {data?.items.map((s) => (
              <tr
                key={s.id}
                className={`border-b border-stone-100 last:border-0 ${s.voided ? 'text-stone-400' : ''}`}
              >
                <td className="px-4 py-2">
                  {formatIsoDate(s.date)}{' '}
                  <span className="text-xs text-stone-500">{formatTime(s.createdAt)}</span>
                </td>
                <td className="px-4 py-2">{s.customerName ?? 'Mostrador'}</td>
                <td className="px-4 py-2">{PAYMENT_LABELS[s.paymentMethod]}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatKg(s.totalKg, 3)}</td>
                <td
                  className={`px-4 py-2 text-right tabular-nums ${s.voided ? 'line-through' : ''}`}
                >
                  {formatMoney(s.total)}
                </td>
                <td className="px-4 py-2 text-stone-600">
                  {s.createdBy}
                  {s.voided && (
                    <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-800">
                      Anulada
                    </span>
                  )}
                </td>
                <td className="px-4 py-2">
                  <div className="flex justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => setDetailId(s.id)}
                      className="rounded-md border border-stone-300 px-2.5 py-1 text-xs hover:bg-stone-100"
                    >
                      Ver
                    </button>
                    {isAdmin && !s.voided && (
                      <button
                        type="button"
                        onClick={() => setVoiding(s)}
                        className="rounded-md border border-stone-300 px-2.5 py-1 text-xs text-red-700 hover:bg-stone-100"
                      >
                        Anular
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-stone-600">
          <p>
            Vigentes: <strong>{data.totals.count}</strong> venta(s) · {formatKg(data.totals.kg, 3)}{' '}
            · <strong>{formatMoney(data.totals.amount)}</strong>
            <span className="text-xs text-stone-500"> (las anuladas no suman)</span>
          </p>
          {pages > 1 && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={data.page <= 1}
                onClick={() => setFilters((f) => f && { ...f, page: (f.page ?? 1) - 1 })}
                className="rounded-md border border-stone-300 px-2.5 py-1 hover:bg-stone-100 disabled:opacity-50"
              >
                Anterior
              </button>
              <span>
                Página {data.page} de {pages}
              </span>
              <button
                type="button"
                disabled={data.page >= pages}
                onClick={() => setFilters((f) => f && { ...f, page: (f.page ?? 1) + 1 })}
                className="rounded-md border border-stone-300 px-2.5 py-1 hover:bg-stone-100 disabled:opacity-50"
              >
                Siguiente
              </button>
            </div>
          )}
        </div>
      )}

      {detailId && <SaleDetailDialog id={detailId} onClose={() => setDetailId(null)} />}
      {voiding && (
        <VoidSaleDialog
          sale={voiding}
          onClose={() => setVoiding(null)}
          onVoided={() => {
            setNotice(
              `Venta de ${formatMoney(voiding.total)} anulada: los kilos volvieron al stock.`,
            );
            setVoiding(null);
            setReloadKey((k) => k + 1);
          }}
        />
      )}
    </section>
  );
}
