'use client';

import Link from 'next/link';
import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Errors, errorMessages, inputClass, matches } from '@/components/catalog/catalog-ui';
import { Modal } from '@/components/ui/modal';
import { ApiError } from '@/lib/api';
import { type Product, catalogApi } from '@/lib/catalog';
import { decimalToInput, formatKg, formatMoney, inputToDecimal } from '@/lib/format';
import {
  type NegativeStockItem,
  PAYMENT_LABELS,
  PAYMENT_METHODS,
  type PaymentMethod,
  type SaleDetail,
  type SaleListResponse,
  formatTime,
  salesApi,
} from '@/lib/sales';
import { lineTotal, stockApi, sumDecimals, todayInArgentina } from '@/lib/stock';

interface CartItem {
  key: number;
  product: Product;
  kg: string;
  pricePerKg: string;
  subtotal: string;
}

let nextKey = 1;

/**
 * Mostrador: buscar producto (Enter elige), kg, precio (precargado con el sugerido),
 * Enter agrega al ticket; forma de pago y Ctrl+Enter confirma.
 */
export function CounterView() {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [stock, setStock] = useState<Map<string, string>>(new Map());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const [selected, setSelected] = useState<Product | null>(null);
  const [kg, setKg] = useState('');
  const [price, setPrice] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [payment, setPayment] = useState<PaymentMethod>('CASH');
  const [customer, setCustomer] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [lastSale, setLastSale] = useState<SaleDetail | null>(null);
  const [negative, setNegative] = useState<NegativeStockItem[] | null>(null);
  const [today, setToday] = useState<SaleListResponse | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const kgRef = useRef<HTMLInputElement>(null);
  const priceRef = useRef<HTMLInputElement>(null);

  const refreshStockAndToday = useCallback(() => {
    const date = todayInArgentina();
    stockApi
      .stock()
      .then((s) => setStock(new Map(s.items.map((r) => [r.productId, r.kg]))))
      .catch(() => undefined);
    salesApi
      .list({ from: date, to: date, status: 'all', pageSize: 100 })
      .then(setToday)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    catalogApi
      .products(true)
      .then(setProducts)
      .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : 'No se pudo cargar'));
    refreshStockAndToday();
  }, [refreshStockAndToday]);

  const suggestions = query.trim()
    ? (products ?? []).filter((p) => matches(p.name, query)).slice(0, 8)
    : [];

  function pick(product: Product) {
    setSelected(product);
    setQuery(product.name);
    setPrice(decimalToInput(product.salePrice));
    setErrors([]);
    // Foco inmediato (no en un timeout): con tipeo rápido la siguiente tecla ya va a los kg.
    kgRef.current?.focus();
  }

  function onSearchKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter' && !e.ctrlKey) {
      e.preventDefault();
      const product = suggestions[highlight];
      if (product) pick(product);
    }
  }

  function addToCart() {
    const problems: string[] = [];
    if (!selected) problems.push('Elegí un producto');
    const kgValue = inputToDecimal(kg, 3);
    if (!kgValue || /^0(\.0*)?$/.test(kgValue)) problems.push('Los kg no son válidos (ej. 1,250)');
    const priceValue = inputToDecimal(price);
    if (!priceValue || /^0(\.0*)?$/.test(priceValue)) {
      problems.push('El precio por kg no es válido (ej. 8500)');
    }
    if (problems.length > 0 || !selected || !kgValue || !priceValue) {
      setErrors(problems);
      return;
    }
    setCart((c) => [
      ...c,
      {
        key: nextKey++,
        product: selected,
        kg: kgValue,
        pricePerKg: priceValue,
        subtotal: lineTotal(kgValue, priceValue),
      },
    ]);
    setSelected(null);
    setQuery('');
    setKg('');
    setPrice('');
    setHighlight(0);
    setErrors([]);
    searchRef.current?.focus();
  }

  function onItemKey(e: KeyboardEvent<HTMLInputElement>, field: 'kg' | 'price') {
    if (e.key !== 'Enter' || e.ctrlKey) return;
    e.preventDefault();
    if (field === 'kg') priceRef.current?.focus();
    else addToCart();
  }

  async function confirm(confirmNegativeStock = false) {
    if (cart.length === 0) {
      setErrors(['Agregá al menos un producto al ticket']);
      return;
    }
    setSaving(true);
    setErrors([]);
    try {
      const sale = await salesApi.create({
        customerName: customer.trim() || null,
        paymentMethod: payment,
        items: cart.map((i) => ({
          productId: i.product.id,
          kg: i.kg,
          pricePerKg: i.pricePerKg,
        })),
        confirmNegativeStock,
      });
      setLastSale(sale);
      setNegative(null);
      setCart([]);
      setCustomer('');
      setPayment('CASH');
      refreshStockAndToday();
      searchRef.current?.focus();
    } catch (err) {
      if (err instanceof ApiError && err.body.code === 'NEGATIVE_STOCK') {
        setNegative(err.body.items as NegativeStockItem[]);
      } else {
        setErrors(errorMessages(err));
      }
    } finally {
      setSaving(false);
    }
  }

  // Ctrl+Enter confirma desde cualquier lugar de la pantalla.
  function onScreenKey(e: KeyboardEvent<HTMLElement>) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !saving && !negative) {
      e.preventDefault();
      void confirm();
    }
  }

  if (loadError) return <Errors messages={[loadError]} />;
  if (!products) return <p className="text-stone-500">Cargando…</p>;

  const total = sumDecimals(
    cart.map((i) => i.subtotal),
    2,
  );
  const preview =
    selected && inputToDecimal(kg, 3) && inputToDecimal(price)
      ? lineTotal(inputToDecimal(kg, 3) as string, inputToDecimal(price) as string)
      : null;
  const unit = selected?.unit === 'UNIT' ? 'u.' : 'kg';

  return (
    <section className="space-y-4" onKeyDown={onScreenKey}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Mostrador</h1>
        <Link href="/ventas/listado" className="text-sm text-stone-600 underline">
          Ver todas las ventas
        </Link>
      </div>

      {products.length === 0 && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          No hay productos activos.{' '}
          <Link href="/catalogo" className="underline">
            Cargalos en el catálogo
          </Link>
          .
        </p>
      )}
      {lastSale && (
        <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
          Venta registrada: {formatMoney(lastSale.total)} ({PAYMENT_LABELS[lastSale.paymentMethod]},{' '}
          {lastSale.itemCount} ítem(s)).
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4 rounded-lg border border-stone-200 bg-white p-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_8rem_9rem_auto] sm:items-end">
            <div className="relative">
              <label className="block text-sm">
                <span className="mb-1 block font-medium">Producto</span>
                <input
                  ref={searchRef}
                  autoFocus
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setSelected(null);
                    setHighlight(0);
                  }}
                  onKeyDown={onSearchKey}
                  placeholder="Escribí para buscar…"
                  role="combobox"
                  aria-expanded={suggestions.length > 0 && !selected}
                  aria-controls="product-suggestions"
                  className={inputClass}
                />
              </label>
              {suggestions.length > 0 && !selected && (
                <ul
                  id="product-suggestions"
                  role="listbox"
                  className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-stone-200 bg-white shadow-lg"
                >
                  {suggestions.map((p, i) => (
                    <li
                      key={p.id}
                      role="option"
                      aria-selected={i === highlight}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        pick(p);
                      }}
                      className={`flex cursor-pointer justify-between px-3 py-2 text-sm ${
                        i === highlight ? 'bg-stone-900 text-white' : 'hover:bg-stone-100'
                      }`}
                    >
                      <span>{p.name}</span>
                      <span className="tabular-nums opacity-75">
                        {formatKg(stock.get(p.id) ?? '0', 3)}
                        {p.salePrice ? ` · ${formatMoney(p.salePrice)}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {query.trim() && suggestions.length === 0 && !selected && (
                <p className="mt-1 text-xs text-stone-500">Ningún producto activo coincide.</p>
              )}
            </div>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">{unit === 'kg' ? 'Kg' : 'Cantidad'}</span>
              <input
                ref={kgRef}
                inputMode="decimal"
                value={kg}
                onChange={(e) => setKg(e.target.value)}
                onKeyDown={(e) => onItemKey(e, 'kg')}
                placeholder="0,000"
                className={`${inputClass} text-right`}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Precio por {unit}</span>
              <input
                ref={priceRef}
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                onKeyDown={(e) => onItemKey(e, 'price')}
                placeholder="0,00"
                className={`${inputClass} text-right`}
              />
            </label>
            <button
              type="button"
              onClick={addToCart}
              className="rounded-md border border-stone-300 px-3 py-2 text-sm hover:bg-stone-100"
            >
              Agregar
            </button>
          </div>
          {selected && (
            <p className="text-xs text-stone-500">
              Stock de {selected.name}: {formatKg(stock.get(selected.id) ?? '0', 3)}
              {preview && <> · Subtotal: {formatMoney(preview)}</>}
            </p>
          )}
          <Errors messages={errors} />

          <table className="w-full text-left text-sm">
            <thead className="border-b border-stone-200 text-stone-600">
              <tr>
                <th className="py-1.5 font-medium">Producto</th>
                <th className="py-1.5 text-right font-medium">Kg</th>
                <th className="py-1.5 text-right font-medium">Precio</th>
                <th className="py-1.5 text-right font-medium">Subtotal</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {cart.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-stone-500">
                    El ticket está vacío. Buscá un producto para empezar.
                  </td>
                </tr>
              )}
              {cart.map((i) => (
                <tr key={i.key} className="border-b border-stone-100">
                  <td className="py-1.5">{i.product.name}</td>
                  <td className="py-1.5 text-right tabular-nums">{formatKg(i.kg, 3)}</td>
                  <td className="py-1.5 text-right tabular-nums">{formatMoney(i.pricePerKg)}</td>
                  <td className="py-1.5 text-right tabular-nums">{formatMoney(i.subtotal)}</td>
                  <td className="py-1.5 text-right">
                    <button
                      type="button"
                      onClick={() => setCart((c) => c.filter((x) => x.key !== i.key))}
                      aria-label={`Quitar ${i.product.name}`}
                      className="rounded px-2 py-0.5 text-stone-500 hover:bg-stone-100 hover:text-red-700"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="flex flex-wrap items-end justify-between gap-4 border-t border-stone-200 pt-4">
            <div className="space-y-3">
              <div className="flex flex-wrap gap-1" role="group" aria-label="Forma de pago">
                {PAYMENT_METHODS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={payment === m}
                    onClick={() => setPayment(m)}
                    className={`rounded-md px-3 py-1.5 text-sm ${
                      payment === m
                        ? 'bg-stone-900 text-white'
                        : 'border border-stone-300 hover:bg-stone-100'
                    }`}
                  >
                    {PAYMENT_LABELS[m]}
                  </button>
                ))}
              </div>
              <input
                value={customer}
                onChange={(e) => setCustomer(e.target.value)}
                maxLength={150}
                placeholder="Cliente (opcional)"
                aria-label="Cliente (opcional)"
                className={`${inputClass} max-w-xs`}
              />
            </div>
            <div className="text-right">
              <p className="text-sm text-stone-600">Total</p>
              <p className="text-3xl font-semibold tabular-nums">{formatMoney(total)}</p>
              <button
                type="button"
                onClick={() => void confirm()}
                disabled={saving || cart.length === 0}
                className="mt-2 rounded-md bg-stone-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-60"
              >
                {saving ? 'Registrando…' : 'Confirmar venta'}
              </button>
            </div>
          </div>
          <p className="text-xs text-stone-500">
            Enter: elegir producto / siguiente campo / agregar al ticket · Ctrl+Enter: confirmar
          </p>
        </div>

        <TodayPanel data={today} />
      </div>

      {negative && (
        <Modal title="Stock insuficiente" onClose={() => setNegative(null)}>
          <div className="space-y-4 text-sm">
            <p>Con esta venta, estos productos quedarían con stock negativo:</p>
            <ul className="space-y-1">
              {negative.map((n) => (
                <li key={n.productId} className="rounded bg-amber-50 px-3 py-2">
                  <strong>{n.name}</strong>: hay {formatKg(n.stockKg, 3)}, se venden{' '}
                  {formatKg(n.requestedKg, 3)} → quedaría en{' '}
                  <span className="text-red-700">{formatKg(n.resultingKg, 3)}</span>
                </li>
              ))}
            </ul>
            <p className="text-stone-600">
              Si la mercadería ya está en el local pero falta cargar el ingreso, podés confirmar
              igual y cargarlo después.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setNegative(null)}
                className="rounded-md border border-stone-300 px-3 py-2 hover:bg-stone-100"
              >
                Revisar el ticket
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void confirm(true)}
                className="rounded-md bg-amber-600 px-4 py-2 font-medium text-white hover:bg-amber-700 disabled:opacity-60"
              >
                {saving ? 'Registrando…' : 'Confirmar igual'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}

function TodayPanel({ data }: { data: SaleListResponse | null }) {
  return (
    <aside className="space-y-3 rounded-lg border border-stone-200 bg-white p-4">
      <h2 className="font-semibold">Ventas de hoy</h2>
      {!data && <p className="text-sm text-stone-500">Cargando…</p>}
      {data && (
        <>
          <p className="text-2xl font-semibold tabular-nums">{formatMoney(data.totals.amount)}</p>
          <p className="text-xs text-stone-600">
            {data.totals.count} venta(s) · {formatKg(data.totals.kg, 3)}
          </p>
          <ul className="max-h-96 divide-y divide-stone-100 overflow-y-auto text-sm">
            {data.items.length === 0 && <li className="py-2 text-stone-500">Todavía nada.</li>}
            {data.items.map((s) => (
              <li
                key={s.id}
                className={`flex justify-between gap-2 py-1.5 ${s.voided ? 'text-stone-400 line-through' : ''}`}
              >
                <span>
                  {formatTime(s.createdAt)} · {PAYMENT_LABELS[s.paymentMethod]}
                </span>
                <span className="tabular-nums">{formatMoney(s.total)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </aside>
  );
}
