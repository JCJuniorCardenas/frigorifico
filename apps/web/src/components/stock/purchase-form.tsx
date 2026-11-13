'use client';

import Link from 'next/link';
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { Errors, Field, errorMessages, inputClass } from '@/components/catalog/catalog-ui';
import { type Product, type Supplier, catalogApi } from '@/lib/catalog';
import { formatKg, formatMoney, inputToDecimal } from '@/lib/format';
import {
  type PurchaseDetail,
  lineTotal,
  stockApi,
  sumDecimals,
  todayInArgentina,
} from '@/lib/stock';

interface Row {
  key: number;
  productId: string;
  kg: string;
  cost: string;
}

let nextKey = 1;
const emptyRow = (): Row => ({ key: nextKey++, productId: '', kg: '', cost: '' });
const isBlank = (r: Row) => !r.productId && !r.kg.trim() && !r.cost.trim();

/**
 * Alta de un ingreso, pensada para cargar rápido con teclado:
 * Enter pasa al campo siguiente; Enter en el costo agrega un ítem nuevo;
 * Ctrl+Enter guarda.
 */
export function PurchaseForm() {
  const [suppliers, setSuppliers] = useState<Supplier[] | null>(null);
  const [products, setProducts] = useState<Product[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // "Hoy" se calcula en el navegador (no en el prerender), al montar.
  const [today, setToday] = useState('');
  const [date, setDate] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [herdNumber, setHerdNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<PurchaseDetail | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const focusRow = useRef<number | null>(null);

  useEffect(() => {
    Promise.all([catalogApi.suppliers(true), catalogApi.products(true)])
      .then(([s, p]) => {
        const now = todayInArgentina();
        setToday(now);
        setDate((d) => d || now);
        setSuppliers(s);
        setProducts(p);
      })
      .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : 'No se pudo cargar'));
  }, []);

  // Después de agregar una fila, enfocar su producto.
  useEffect(() => {
    if (focusRow.current === null) return;
    form.current?.querySelector<HTMLSelectElement>(`[data-row="${focusRow.current}"]`)?.focus();
    focusRow.current = null;
  }, [rows]);

  const parsed = rows.map((r) => ({
    row: r,
    kg: inputToDecimal(r.kg, 3),
    cost: inputToDecimal(r.cost),
  }));
  const subtotals = parsed.map((p) => (p.kg && p.cost ? lineTotal(p.kg, p.cost) : null));
  const totalKg = sumDecimals(
    parsed.flatMap((p) => (p.kg ? [p.kg] : [])),
    3,
  );
  const totalCost = sumDecimals(
    subtotals.flatMap((s) => (s ? [s] : [])),
    2,
  );

  function updateRow(key: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function addRow() {
    const row = emptyRow();
    focusRow.current = row.key;
    setRows((rs) => [...rs, row]);
  }

  function onKeyDown(e: KeyboardEvent<HTMLFormElement>) {
    if (e.key !== 'Enter') return;
    const target = e.target as HTMLElement;
    if (target.tagName === 'BUTTON' || target.tagName === 'TEXTAREA') return;
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      form.current?.requestSubmit();
      return;
    }
    if (target.dataset.cost !== undefined) {
      const key = Number(target.dataset.cost);
      const isLast = rows[rows.length - 1]?.key === key;
      if (isLast) {
        addRow();
        return;
      }
    }
    // Enter = Tab: al siguiente campo editable.
    const fields = Array.from(
      form.current?.querySelectorAll<HTMLElement>('input, select') ?? [],
    ).filter((el) => !(el as HTMLInputElement).disabled);
    const index = fields.indexOf(target);
    fields[index + 1]?.focus();
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const problems: string[] = [];
    if (!supplierId) problems.push('Elegí el proveedor');
    const filled = parsed.filter((p) => !isBlank(p.row));
    if (filled.length === 0) problems.push('Cargá al menos un ítem');
    filled.forEach((p, i) => {
      const n = i + 1;
      if (!p.row.productId) problems.push(`Ítem ${n}: elegí el producto`);
      if (!p.kg || p.kg === '0' || /^0\.0*$/.test(p.kg)) {
        problems.push(`Ítem ${n}: los kg no son válidos (ej. 120,5; hasta 3 decimales)`);
      }
      if (!p.cost || /^0(\.0*)?$/.test(p.cost)) {
        problems.push(`Ítem ${n}: el costo por kg no es válido (ej. 4500,50)`);
      }
    });
    if (problems.length > 0) {
      setErrors(problems);
      return;
    }

    setSaving(true);
    setErrors([]);
    try {
      const purchase = await stockApi.createPurchase({
        date,
        supplierId,
        herdNumber: herdNumber.trim() || null,
        notes: notes.trim() || null,
        items: filled.map((p) => ({
          productId: p.row.productId,
          kg: p.kg as string,
          costPerKg: p.cost as string,
        })),
      });
      // Queda listo para cargar el siguiente: se conservan fecha y proveedor.
      setSaved(purchase);
      setHerdNumber('');
      setNotes('');
      const first = emptyRow();
      focusRow.current = first.key;
      setRows([first]);
    } catch (err) {
      setErrors(errorMessages(err));
    } finally {
      setSaving(false);
    }
  }

  if (loadError) return <Errors messages={[loadError]} />;
  if (!suppliers || !products) return <p className="text-stone-500">Cargando…</p>;

  const missingCatalog = suppliers.length === 0 || products.length === 0;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Nuevo ingreso de mercadería</h1>
        <Link href="/ingresos" className="text-sm text-stone-600 underline">
          Ver ingresos
        </Link>
      </div>

      {missingCatalog && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Para cargar un ingreso necesitás al menos un proveedor y un producto activos.{' '}
          <Link href="/catalogo" className="underline">
            Ir al catálogo
          </Link>
        </p>
      )}
      {saved && (
        <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
          Ingreso guardado: {saved.supplier.name}, {saved.itemCount} ítem(s),{' '}
          {formatKg(saved.totalKg, 3)}, {formatMoney(saved.totalCost)}. Podés cargar el siguiente.
        </p>
      )}

      <form
        ref={form}
        onSubmit={(e) => void onSubmit(e)}
        onKeyDown={onKeyDown}
        className="space-y-4 rounded-lg border border-stone-200 bg-white p-4"
      >
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Fecha">
            <input
              type="date"
              required
              value={date}
              max={today || undefined}
              onChange={(e) => setDate(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Proveedor">
            <select
              required
              value={supplierId}
              onChange={(e) => {
                setSupplierId(e.target.value);
                setSaved(null);
              }}
              className={inputClass}
              autoFocus
            >
              <option value="">Elegí…</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="N° de tropa (opcional)">
            <input
              inputMode="numeric"
              value={herdNumber}
              maxLength={10}
              onChange={(e) => setHerdNumber(e.target.value.replace(/\D/g, ''))}
              className={inputClass}
            />
          </Field>
          <Field label="Notas (opcional)">
            <input
              value={notes}
              maxLength={500}
              onChange={(e) => setNotes(e.target.value)}
              className={inputClass}
            />
          </Field>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-stone-600">
              <tr>
                <th className="w-8 py-1.5 font-medium">#</th>
                <th className="py-1.5 font-medium">Producto</th>
                <th className="w-36 py-1.5 font-medium">Kg</th>
                <th className="w-40 py-1.5 font-medium">Costo por kg</th>
                <th className="w-36 py-1.5 text-right font-medium">Subtotal</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.key}>
                  <td className="py-1 text-stone-500">{i + 1}</td>
                  <td className="py-1 pr-2">
                    <select
                      data-row={r.key}
                      value={r.productId}
                      onChange={(e) => updateRow(r.key, { productId: e.target.value })}
                      aria-label={`Producto del ítem ${i + 1}`}
                      className={inputClass}
                    >
                      <option value="">Elegí…</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      inputMode="decimal"
                      value={r.kg}
                      onChange={(e) => updateRow(r.key, { kg: e.target.value })}
                      placeholder="0,000"
                      aria-label={`Kg del ítem ${i + 1}`}
                      className={`${inputClass} text-right ${
                        r.kg.trim() && !inputToDecimal(r.kg, 3) ? 'border-red-400' : ''
                      }`}
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      inputMode="decimal"
                      data-cost={r.key}
                      value={r.cost}
                      onChange={(e) => updateRow(r.key, { cost: e.target.value })}
                      placeholder="0,00"
                      aria-label={`Costo por kg del ítem ${i + 1}`}
                      className={`${inputClass} text-right ${
                        r.cost.trim() && !inputToDecimal(r.cost) ? 'border-red-400' : ''
                      }`}
                    />
                  </td>
                  <td className="py-1 text-right tabular-nums">
                    {subtotals[i] ? formatMoney(subtotals[i]) : '—'}
                  </td>
                  <td className="py-1 text-right">
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() =>
                        setRows((rs) =>
                          rs.length === 1 ? [emptyRow()] : rs.filter((x) => x.key !== r.key),
                        )
                      }
                      aria-label={`Quitar el ítem ${i + 1}`}
                      className="rounded px-2 py-1 text-stone-500 hover:bg-stone-100 hover:text-red-700"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td />
                <td className="py-2">
                  <button
                    type="button"
                    onClick={addRow}
                    className="rounded-md border border-stone-300 px-2.5 py-1 text-xs font-normal hover:bg-stone-100"
                  >
                    + Agregar ítem
                  </button>
                </td>
                <td className="py-2 text-right tabular-nums">{formatKg(totalKg, 3)}</td>
                <td />
                <td className="py-2 text-right tabular-nums">{formatMoney(totalCost)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>

        <Errors messages={errors} />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-stone-500">
            Enter: campo siguiente · Enter en el costo: nuevo ítem · Ctrl+Enter: guardar
          </p>
          <button
            type="submit"
            disabled={saving || missingCatalog}
            className="rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-60"
          >
            {saving ? 'Guardando…' : 'Guardar ingreso'}
          </button>
        </div>
      </form>
    </section>
  );
}
