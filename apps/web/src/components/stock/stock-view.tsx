'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Errors, matches, inputClass } from '@/components/catalog/catalog-ui';
import { Modal } from '@/components/ui/modal';
import { formatIsoDate, formatKg, formatMoney } from '@/lib/format';
import {
  MOVEMENT_LABELS,
  type MovementRow,
  type StockResponse,
  type StockRow,
  stockApi,
} from '@/lib/stock';

/** Stock actual por producto: kg (suma de movimientos), costo promedio y valor. */
export function StockView() {
  const [data, setData] = useState<StockResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [onlyLow, setOnlyLow] = useState(false);
  const [detail, setDetail] = useState<StockRow | null>(null);

  useEffect(() => {
    let cancelled = false;
    stockApi
      .stock()
      .then((res) => !cancelled && setData(res))
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'No se pudo cargar el stock');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = (data?.items ?? []).filter(
    (r) =>
      (!onlyLow || r.lowStock) &&
      (matches(r.name, search) || (r.category !== null && matches(r.category, search))),
  );

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Stock actual</h1>
        <Link
          href="/ingresos/nuevo"
          className="rounded-md bg-stone-900 px-3 py-2 text-sm font-medium text-white hover:bg-stone-800"
        >
          Cargar ingreso
        </Link>
      </div>

      {data && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Card label="Valor del stock" value={formatMoney(data.totals.value)} />
          <Card label="Productos" value={String(data.totals.products)} />
          <Card
            label="Con stock bajo"
            value={String(data.totals.lowStock)}
            tone={data.totals.lowStock > 0 ? 'warn' : undefined}
          />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por producto o categoría"
          aria-label="Buscar por producto o categoría"
          className={`${inputClass} max-w-xs`}
        />
        <label className="flex items-center gap-2 text-sm text-stone-700">
          <input type="checkbox" checked={onlyLow} onChange={(e) => setOnlyLow(e.target.checked)} />
          Solo stock bajo
        </label>
      </div>
      {error && <Errors messages={[error]} />}

      <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-stone-200 bg-stone-50 text-stone-600">
            <tr>
              <th className="px-4 py-2 font-medium">Producto</th>
              <th className="px-4 py-2 font-medium">Categoría</th>
              <th className="px-4 py-2 text-right font-medium">Kg disponibles</th>
              <th className="px-4 py-2 text-right font-medium">Costo promedio</th>
              <th className="px-4 py-2 text-right font-medium">Valor en stock</th>
              <th className="px-4 py-2 font-medium">Estado</th>
            </tr>
          </thead>
          <tbody>
            {data === null && !error && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-stone-500">
                  Cargando…
                </td>
              </tr>
            )}
            {data !== null && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-stone-500">
                  {data.items.length === 0 ? (
                    <>
                      Todavía no hay productos.{' '}
                      <Link href="/catalogo" className="underline">
                        Cargalos en el catálogo
                      </Link>{' '}
                      y después registrá un ingreso.
                    </>
                  ) : (
                    'Ningún producto coincide con el filtro.'
                  )}
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const negative = r.kg.startsWith('-');
              return (
                <tr
                  key={r.productId}
                  onClick={() => setDetail(r)}
                  className={`cursor-pointer border-b border-stone-100 last:border-0 hover:bg-stone-50 ${
                    negative ? 'bg-red-50' : r.lowStock ? 'bg-amber-50' : ''
                  }`}
                >
                  <td className="px-4 py-2 font-medium">
                    {r.name}
                    {!r.active && <span className="ml-2 text-xs text-stone-500">(inactivo)</span>}
                  </td>
                  <td className="px-4 py-2">{r.category ?? '—'}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatKg(r.kg, 3)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatMoney(r.avgCost)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatMoney(r.value)}</td>
                  <td className="px-4 py-2 text-xs">
                    {negative ? (
                      <span className="rounded bg-red-100 px-1.5 py-0.5 text-red-800">
                        Stock negativo
                      </span>
                    ) : r.lowStock ? (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">
                        Bajo (mín. {formatKg(r.minStockKg ?? '0', 3)})
                      </span>
                    ) : (
                      <span className="text-stone-500">OK</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-stone-500">
        El stock es la suma de los movimientos (ingresos, ventas, mermas y ajustes). Tocá un
        producto para ver su historial.
      </p>

      {detail && <MovementsDialog row={detail} onClose={() => setDetail(null)} />}
    </section>
  );
}

function Card({ label, value, tone }: { label: string; value: string; tone?: 'warn' }) {
  return (
    <div
      className={`rounded-lg border p-3 ${
        tone === 'warn' ? 'border-amber-300 bg-amber-50' : 'border-stone-200 bg-white'
      }`}
    >
      <p className="text-xs text-stone-600">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function MovementsDialog({ row, onClose }: { row: StockRow; onClose: () => void }) {
  const [movements, setMovements] = useState<MovementRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    stockApi
      .movements(row.productId)
      .then(setMovements)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'No se pudo cargar'));
  }, [row.productId]);

  return (
    <Modal title={`Movimientos de ${row.name}`} onClose={onClose} wide>
      <p className="mb-3 text-sm text-stone-600">
        Stock: <strong>{formatKg(row.kg, 3)}</strong> · Costo promedio:{' '}
        <strong>{formatMoney(row.avgCost)}</strong>
      </p>
      {error && <Errors messages={[error]} />}
      <div className="max-h-96 overflow-y-auto rounded border border-stone-200">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-stone-50 text-stone-600">
            <tr>
              <th className="px-3 py-1.5 font-medium">Fecha</th>
              <th className="px-3 py-1.5 font-medium">Tipo</th>
              <th className="px-3 py-1.5 text-right font-medium">Kg</th>
              <th className="px-3 py-1.5 text-right font-medium">Costo/kg</th>
              <th className="px-3 py-1.5 font-medium">Usuario</th>
            </tr>
          </thead>
          <tbody>
            {movements === null && !error && (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-center text-stone-500">
                  Cargando…
                </td>
              </tr>
            )}
            {movements?.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-center text-stone-500">
                  Sin movimientos todavía.
                </td>
              </tr>
            )}
            {movements?.map((m) => (
              <tr key={m.id} className="border-t border-stone-100">
                <td className="px-3 py-1.5">{formatIsoDate(m.date)}</td>
                <td className="px-3 py-1.5">
                  {MOVEMENT_LABELS[m.type]}
                  {m.reason && <span className="block text-xs text-stone-500">{m.reason}</span>}
                </td>
                <td
                  className={`px-3 py-1.5 text-right tabular-nums ${
                    m.kg.startsWith('-') ? 'text-red-700' : 'text-green-700'
                  }`}
                >
                  {m.kg.startsWith('-') ? '' : '+'}
                  {formatKg(m.kg, 3)}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">
                  {m.unitCost ? formatMoney(m.unitCost) : '—'}
                </td>
                <td className="px-3 py-1.5 text-stone-600">{m.createdBy}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
