'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Errors } from '@/components/catalog/catalog-ui';
import { Modal } from '@/components/ui/modal';
import { type Supplier, catalogApi } from '@/lib/catalog';
import { formatIsoDate, formatKg, formatMoney } from '@/lib/format';
import {
  type PurchaseDetail,
  type PurchaseListResponse,
  type PurchaseQuery,
  stockApi,
} from '@/lib/stock';

const PAGE_SIZE = 25;
const filterInput =
  'rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-stone-900';

/** Listado de ingresos de mercadería con filtros y totales. */
export function PurchasesView() {
  const [filters, setFilters] = useState<PurchaseQuery>({ page: 1, pageSize: PAGE_SIZE });
  const [data, setData] = useState<PurchaseListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [detailId, setDetailId] = useState<string | null>(null);

  useEffect(() => {
    catalogApi
      .suppliers()
      .then(setSuppliers)
      .catch(() => setSuppliers([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    stockApi
      .purchases(filters)
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
  }, [filters]);

  const update = (patch: PurchaseQuery) => setFilters((f) => ({ ...f, ...patch, page: 1 }));
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const hasFilters = Boolean(
    filters.from || filters.to || filters.supplierId || filters.herdNumber,
  );

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Ingresos de mercadería</h1>
        <Link
          href="/ingresos/nuevo"
          className="rounded-md bg-stone-900 px-3 py-2 text-sm font-medium text-white hover:bg-stone-800"
        >
          Nuevo ingreso
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
          Proveedor
          <select
            value={filters.supplierId ?? ''}
            onChange={(e) => update({ supplierId: e.target.value })}
            className={filterInput}
          >
            <option value="">Todos</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.active ? '' : ' (inactivo)'}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-stone-600">
          N° de tropa
          <input
            inputMode="numeric"
            value={filters.herdNumber ?? ''}
            onChange={(e) => update({ herdNumber: e.target.value.replace(/\D/g, '') })}
            className={`${filterInput} w-28`}
          />
        </label>
        {hasFilters && (
          <button
            type="button"
            onClick={() => setFilters({ page: 1, pageSize: PAGE_SIZE })}
            className="rounded-md px-2.5 py-1.5 text-sm text-stone-600 hover:bg-stone-100"
          >
            Limpiar filtros
          </button>
        )}
      </div>
      {error && <Errors messages={[error]} />}

      <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-stone-200 bg-stone-50 text-stone-600">
            <tr>
              <th className="px-4 py-2 font-medium">Fecha</th>
              <th className="px-4 py-2 font-medium">Proveedor</th>
              <th className="px-4 py-2 font-medium">Tropa</th>
              <th className="px-4 py-2 text-right font-medium">Ítems</th>
              <th className="px-4 py-2 text-right font-medium">Kg</th>
              <th className="px-4 py-2 text-right font-medium">Total</th>
              <th className="px-4 py-2 font-medium">Cargado por</th>
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
                  {hasFilters
                    ? 'Ningún ingreso coincide con los filtros.'
                    : 'Todavía no hay ingresos. Registrá el primero con “Nuevo ingreso”.'}
                </td>
              </tr>
            )}
            {data?.items.map((p) => (
              <tr
                key={p.id}
                onClick={() => setDetailId(p.id)}
                className="cursor-pointer border-b border-stone-100 last:border-0 hover:bg-stone-50"
              >
                <td className="px-4 py-2">{formatIsoDate(p.date)}</td>
                <td className="px-4 py-2 font-medium">{p.supplier.name}</td>
                <td className="px-4 py-2 tabular-nums">{p.herdNumber ?? '—'}</td>
                <td className="px-4 py-2 text-right tabular-nums">{p.itemCount}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatKg(p.totalKg, 3)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatMoney(p.totalCost)}</td>
                <td className="px-4 py-2 text-stone-600">{p.createdBy}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data && data.total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-stone-600">
          <p>
            <strong>{data.total}</strong> ingreso(s) · {formatKg(data.totals.kg, 3)} ·{' '}
            <strong>{formatMoney(data.totals.cost)}</strong>
          </p>
          {pages > 1 && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={data.page <= 1}
                onClick={() => setFilters((f) => ({ ...f, page: (f.page ?? 1) - 1 }))}
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
                onClick={() => setFilters((f) => ({ ...f, page: (f.page ?? 1) + 1 }))}
                className="rounded-md border border-stone-300 px-2.5 py-1 hover:bg-stone-100 disabled:opacity-50"
              >
                Siguiente
              </button>
            </div>
          )}
        </div>
      )}

      {detailId && <PurchaseDialog id={detailId} onClose={() => setDetailId(null)} />}
    </section>
  );
}

function PurchaseDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const [purchase, setPurchase] = useState<PurchaseDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    stockApi
      .purchase(id)
      .then(setPurchase)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'No se pudo cargar'));
  }, [id]);

  return (
    <Modal title="Detalle del ingreso" onClose={onClose} wide>
      {error && <Errors messages={[error]} />}
      {!purchase && !error && <p className="text-sm text-stone-500">Cargando…</p>}
      {purchase && (
        <div className="space-y-3 text-sm">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
            <Item label="Fecha" value={formatIsoDate(purchase.date)} />
            <Item label="Proveedor" value={purchase.supplier.name} />
            <Item label="Tropa" value={purchase.herdNumber ?? '—'} />
            <Item label="Cargado por" value={purchase.createdBy} />
          </dl>
          {purchase.notes && <p className="text-stone-600">Notas: {purchase.notes}</p>}
          <table className="w-full text-left">
            <thead className="border-b border-stone-200 text-stone-600">
              <tr>
                <th className="py-1.5 font-medium">Producto</th>
                <th className="py-1.5 text-right font-medium">Kg</th>
                <th className="py-1.5 text-right font-medium">Costo/kg</th>
                <th className="py-1.5 text-right font-medium">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {purchase.items.map((i) => (
                <tr key={i.id} className="border-b border-stone-100">
                  <td className="py-1.5">{i.productName}</td>
                  <td className="py-1.5 text-right tabular-nums">{formatKg(i.kg, 3)}</td>
                  <td className="py-1.5 text-right tabular-nums">{formatMoney(i.costPerKg)}</td>
                  <td className="py-1.5 text-right tabular-nums">{formatMoney(i.totalCost)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td className="py-1.5">Total</td>
                <td className="py-1.5 text-right tabular-nums">{formatKg(purchase.totalKg, 3)}</td>
                <td />
                <td className="py-1.5 text-right tabular-nums">
                  {formatMoney(purchase.totalCost)}
                </td>
              </tr>
            </tfoot>
          </table>
          <p className="text-xs text-stone-500">
            Los ingresos no se editan ni se borran: un error se corrige con un ajuste de stock.
          </p>
        </div>
      )}
    </Modal>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-stone-500">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
