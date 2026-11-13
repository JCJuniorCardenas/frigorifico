'use client';

import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Errors, Field, errorMessages, inputClass } from '@/components/catalog/catalog-ui';
import { Modal } from '@/components/ui/modal';
import { ApiError } from '@/lib/api';
import {
  ADJUSTMENT_LABELS,
  type AdjustmentInput,
  type AdjustmentListResponse,
  type AdjustmentQuery,
  type AdjustmentType,
  REASON_SUGGESTIONS,
  addKg,
  negateKg,
  adjustmentsApi,
  signedKgToDecimal,
} from '@/lib/adjustments';
import { type Product, catalogApi } from '@/lib/catalog';
import { formatIsoDate, formatKg, formatMoney, inputToDecimal } from '@/lib/format';
import type { NegativeStockItem } from '@/lib/sales';
import { stockApi } from '@/lib/stock';

const PAGE_SIZE = 25;
const filterInput =
  'rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-stone-900';

type Mode = 'waste' | 'count' | 'delta';

const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: 'waste', label: 'Merma', hint: 'Kilos que se perdieron (vencimiento, recorte, etc.).' },
  {
    id: 'count',
    label: 'Ajuste por conteo',
    hint: 'Kilos contados en la cámara: se ajusta la diferencia.',
  },
  { id: 'delta', label: 'Ajuste manual', hint: 'Diferencia con signo: +2 suma, -1,5 resta.' },
];

/** Mermas y ajustes de stock: alta con motivo obligatorio e historial. */
export function AdjustmentsView() {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [stock, setStock] = useState<Map<string, string>>(new Map());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filters, setFilters] = useState<AdjustmentQuery>({ page: 1, pageSize: PAGE_SIZE });
  const [data, setData] = useState<AdjustmentListResponse | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const refreshStock = useCallback(() => {
    stockApi
      .stock()
      .then((s) => setStock(new Map(s.items.map((r) => [r.productId, r.kg]))))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    // Todos los productos: también se pueden ajustar los inactivos (para dejarlos en cero).
    catalogApi
      .products()
      .then(setProducts)
      .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : 'No se pudo cargar'));
    refreshStock();
  }, [refreshStock]);

  useEffect(() => {
    let cancelled = false;
    adjustmentsApi
      .list(filters)
      .then((res) => {
        if (cancelled) return;
        setData(res);
        setListError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setListError(e instanceof Error ? e.message : 'No se pudo cargar');
      });
    return () => {
      cancelled = true;
    };
  }, [filters, reloadKey]);

  const update = (patch: AdjustmentQuery) => setFilters((f) => ({ ...f, ...patch, page: 1 }));
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const hasFilters = Boolean(filters.from || filters.to || filters.productId || filters.type);

  if (loadError) return <Errors messages={[loadError]} />;
  if (!products) return <p className="text-stone-500">Cargando…</p>;

  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold">Mermas y ajustes de stock</h1>

      <AdjustmentForm
        products={products}
        stock={stock}
        onSaved={() => {
          refreshStock();
          setReloadKey((k) => k + 1);
        }}
      />

      <h2 className="pt-2 font-semibold">Historial</h2>
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
          Tipo
          <select
            value={filters.type ?? ''}
            onChange={(e) => update({ type: e.target.value as AdjustmentType | '' })}
            className={filterInput}
          >
            <option value="">Mermas y ajustes</option>
            <option value="WASTE">Solo mermas</option>
            <option value="ADJUSTMENT">Solo ajustes</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-stone-600">
          Producto
          <select
            value={filters.productId ?? ''}
            onChange={(e) => update({ productId: e.target.value })}
            className={filterInput}
          >
            <option value="">Todos</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
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
      {listError && <Errors messages={[listError]} />}

      <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-stone-200 bg-stone-50 text-stone-600">
            <tr>
              <th className="px-4 py-2 font-medium">Fecha</th>
              <th className="px-4 py-2 font-medium">Tipo</th>
              <th className="px-4 py-2 font-medium">Producto</th>
              <th className="px-4 py-2 text-right font-medium">Kg</th>
              <th className="px-4 py-2 text-right font-medium">Valor</th>
              <th className="px-4 py-2 font-medium">Motivo</th>
              <th className="px-4 py-2 font-medium">Usuario</th>
            </tr>
          </thead>
          <tbody>
            {data === null && !listError && (
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
                    ? 'Ningún movimiento coincide con los filtros.'
                    : 'Todavía no hay mermas ni ajustes.'}
                </td>
              </tr>
            )}
            {data?.items.map((m) => {
              const negative = m.kg.startsWith('-');
              return (
                <tr key={m.id} className="border-b border-stone-100 last:border-0">
                  <td className="px-4 py-2">{formatIsoDate(m.date)}</td>
                  <td className="px-4 py-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs ${
                        m.type === 'WASTE'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-sky-100 text-sky-800'
                      }`}
                    >
                      {ADJUSTMENT_LABELS[m.type]}
                    </span>
                  </td>
                  <td className="px-4 py-2 font-medium">{m.productName}</td>
                  <td
                    className={`px-4 py-2 text-right tabular-nums ${
                      negative ? 'text-red-700' : 'text-green-700'
                    }`}
                  >
                    {negative ? '' : '+'}
                    {formatKg(m.kg, 3)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatMoney(m.value)}</td>
                  <td className="px-4 py-2">{m.reason}</td>
                  <td className="px-4 py-2 text-stone-600">{m.createdBy}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {data && data.total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-stone-600">
          <p>
            Mermas: <strong>{formatKg(data.totals.wasteKg, 3)}</strong> ·{' '}
            <strong>{formatMoney(data.totals.wasteValue)}</strong> perdidos · Ajustes (neto):{' '}
            {formatKg(data.totals.adjustmentKg, 3)} · {formatMoney(data.totals.adjustmentValue)}
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
      <p className="text-xs text-stone-500">
        Las mermas y los ajustes no se editan ni se borran: un error se corrige con otro ajuste.
      </p>
    </section>
  );
}

function AdjustmentForm({
  products,
  stock,
  onSaved,
}: {
  products: Product[];
  stock: Map<string, string>;
  onSaved: () => void;
}) {
  const [mode, setMode] = useState<Mode>('waste');
  const [productId, setProductId] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [negative, setNegative] = useState<NegativeStockItem | null>(null);

  const type: AdjustmentType = mode === 'waste' ? 'WASTE' : 'ADJUSTMENT';
  const current = productId ? (stock.get(productId) ?? '0.000') : null;

  // Diferencia que se va a registrar, para la vista previa.
  let delta: string | null = null;
  if (mode === 'waste') {
    const kg = inputToDecimal(amount, 3);
    delta = kg ? `-${kg}` : null;
  } else if (mode === 'count') {
    const counted = inputToDecimal(amount, 3);
    // contado − stock actual
    delta = counted && current !== null ? addKg(counted, negateKg(current)) : null;
  } else {
    delta = signedKgToDecimal(amount);
  }
  const after = delta && current !== null ? addKg(current, delta) : null;

  function buildInput(confirmNegativeStock = false): AdjustmentInput | null {
    const problems: string[] = [];
    if (!productId) problems.push('Elegí el producto');
    if (reason.trim().length < 3) problems.push('Escribí el motivo (al menos 3 caracteres)');
    const input: AdjustmentInput = { productId, type, reason: reason.trim(), confirmNegativeStock };
    if (mode === 'waste') {
      const kg = inputToDecimal(amount, 3);
      if (!kg || /^0(\.0*)?$/.test(kg)) problems.push('Los kg perdidos no son válidos (ej. 2,5)');
      else input.kg = kg;
    } else if (mode === 'count') {
      const counted = inputToDecimal(amount, 3);
      if (!counted) problems.push('Los kg contados no son válidos (ej. 46,750)');
      else input.countedKg = counted;
    } else {
      const kg = signedKgToDecimal(amount);
      if (!kg || /^-?0(\.0*)?$/.test(kg))
        problems.push('La diferencia no es válida (ej. -1,5 o +2)');
      else input.kg = kg;
    }
    setErrors(problems);
    return problems.length > 0 ? null : input;
  }

  async function save(input: AdjustmentInput) {
    setSaving(true);
    setErrors([]);
    try {
      const res = await adjustmentsApi.create(input);
      const name = products.find((p) => p.id === res.productId)?.name ?? '';
      setNotice(
        `${res.type === 'WASTE' ? 'Merma registrada' : 'Ajuste registrado'} en ${name}: ${formatKg(res.kg, 3)} ` +
          `(stock ${formatKg(res.stockBefore, 3)} → ${formatKg(res.stockAfter, 3)}).`,
      );
      setNegative(null);
      setAmount('');
      setReason('');
      onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.body.code === 'NEGATIVE_STOCK') {
        setNegative((err.body.items as NegativeStockItem[])[0]);
      } else {
        setErrors(errorMessages(err));
      }
    } finally {
      setSaving(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setNotice(null);
    const input = buildInput();
    if (input) void save(input);
  }

  const modeInfo = MODES.find((m) => m.id === mode);

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-lg border border-stone-200 bg-white p-4">
      <div className="flex flex-wrap gap-1" role="group" aria-label="Tipo de movimiento">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            aria-pressed={mode === m.id}
            onClick={() => {
              setMode(m.id);
              setAmount('');
              setErrors([]);
            }}
            className={`rounded-md px-3 py-1.5 text-sm ${
              mode === m.id
                ? 'bg-stone-900 text-white'
                : 'border border-stone-300 hover:bg-stone-100'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-stone-500">{modeInfo?.hint}</p>

      <div className="grid gap-3 sm:grid-cols-[1fr_10rem_1fr]">
        <Field label="Producto">
          <select
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            className={inputClass}
          >
            <option value="">Elegí…</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.active ? '' : ' (inactivo)'}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label={
            mode === 'waste' ? 'Kg perdidos' : mode === 'count' ? 'Kg contados' : 'Diferencia (kg)'
          }
        >
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={mode === 'delta' ? '-1,500' : '0,000'}
            className={`${inputClass} text-right`}
          />
        </Field>
        <Field label="Motivo">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={200}
            list={`reasons-${type}`}
            placeholder={REASON_SUGGESTIONS[type][0]}
            className={inputClass}
          />
          <datalist id={`reasons-${type}`}>
            {REASON_SUGGESTIONS[type].map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
        </Field>
      </div>

      {current !== null && (
        <p className="text-sm text-stone-600">
          Stock actual: <strong>{formatKg(current, 3)}</strong>
          {delta && after && (
            <>
              {' '}
              → queda en{' '}
              <strong className={after.startsWith('-') ? 'text-red-700' : ''}>
                {formatKg(after, 3)}
              </strong>{' '}
              ({delta.startsWith('-') ? '' : '+'}
              {formatKg(delta, 3)})
            </>
          )}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
          {notice}
        </p>
      )}
      <Errors messages={errors} />
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-60"
        >
          {saving ? 'Registrando…' : `Registrar ${mode === 'waste' ? 'merma' : 'ajuste'}`}
        </button>
      </div>

      {negative && (
        <Modal title="Stock insuficiente" onClose={() => setNegative(null)}>
          <div className="space-y-4 text-sm">
            <p>
              <strong>{negative.name}</strong> tiene {formatKg(negative.stockKg, 3)} y quedaría en{' '}
              <span className="text-red-700">{formatKg(negative.resultingKg, 3)}</span>.
            </p>
            <p className="text-stone-600">
              Puede pasar si falta cargar un ingreso. ¿Registrar igual?
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setNegative(null)}
                className="rounded-md border border-stone-300 px-3 py-2 hover:bg-stone-100"
              >
                Revisar
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  const input = buildInput(true);
                  if (input) void save(input);
                }}
                className="rounded-md bg-amber-600 px-4 py-2 font-medium text-white hover:bg-amber-700 disabled:opacity-60"
              >
                Registrar igual
              </button>
            </div>
          </div>
        </Modal>
      )}
    </form>
  );
}
