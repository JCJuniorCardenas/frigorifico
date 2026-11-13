'use client';

import { type FormEvent, useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { ConfirmDialog } from '@/components/invoices/invoice-dialogs';
import { Modal } from '@/components/ui/modal';
import { type Product, type ProductInput, UNIT_LABELS, catalogApi } from '@/lib/catalog';
import { decimalToInput, formatKg, formatMoney, inputToDecimal } from '@/lib/format';
import {
  Errors,
  Field,
  ListToolbar,
  StatusBadge,
  errorMessages,
  inputClass,
  matches,
  primaryButton,
  rowButton,
  secondaryButton,
  useList,
} from './catalog-ui';

type Dialog =
  { kind: 'form'; product: Product | null } | { kind: 'delete'; product: Product } | null;

export function ProductsPanel({ onNotice }: { onNotice: (message: string) => void }) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const { items, error, reload } = useList(() => catalogApi.products());
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const visible = (items ?? []).filter(
    (p) =>
      (showInactive || p.active) &&
      (matches(p.name, search) || (p.category !== null && matches(p.category, search))),
  );

  async function toggleActive(product: Product) {
    setBusyId(product.id);
    setRowError(null);
    try {
      await catalogApi.updateProduct(product.id, { active: !product.active });
      onNotice(`${product.name} ${product.active ? 'desactivado' : 'activado'}`);
      reload();
    } catch (e) {
      setRowError(errorMessages(e).join('. '));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-3">
      <ListToolbar
        search={search}
        onSearch={setSearch}
        placeholder="Buscar por nombre o categoría"
        showInactive={showInactive}
        onShowInactive={setShowInactive}
        newLabel="Nuevo producto"
        onNew={() => setDialog({ kind: 'form', product: null })}
      />
      {(error ?? rowError) && <Errors messages={[(error ?? rowError) as string]} />}

      <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-stone-200 bg-stone-50 text-stone-600">
            <tr>
              <th className="px-4 py-2 font-medium">Producto</th>
              <th className="px-4 py-2 font-medium">Categoría</th>
              <th className="px-4 py-2 font-medium">Unidad</th>
              <th className="px-4 py-2 text-right font-medium">Precio sugerido</th>
              <th className="px-4 py-2 text-right font-medium">Stock mínimo</th>
              <th className="px-4 py-2 font-medium">Estado</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {items === null && !error && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-stone-500">
                  Cargando…
                </td>
              </tr>
            )}
            {items !== null && visible.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-stone-500">
                  {items.length === 0
                    ? 'Todavía no hay productos. Cargá los cortes que vendés con “Nuevo producto”.'
                    : search.trim() === ''
                      ? 'No hay productos activos. Marcá “Mostrar inactivos” para ver los demás.'
                      : 'Ningún producto coincide con la búsqueda.'}
                </td>
              </tr>
            )}
            {visible.map((p) => (
              <tr
                key={p.id}
                className={`border-b border-stone-100 last:border-0 ${p.active ? '' : 'text-stone-500'}`}
              >
                <td className="px-4 py-2 font-medium">{p.name}</td>
                <td className="px-4 py-2">{p.category ?? '—'}</td>
                <td className="px-4 py-2">{UNIT_LABELS[p.unit]}</td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {p.salePrice === null ? '—' : formatMoney(p.salePrice)}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {p.minStockKg === null ? '—' : formatKg(p.minStockKg, 3)}
                </td>
                <td className="px-4 py-2">
                  <StatusBadge active={p.active} />
                </td>
                <td className="px-4 py-2">
                  <div className="flex justify-end gap-1.5">
                    <button
                      type="button"
                      className={rowButton}
                      onClick={() => setDialog({ kind: 'form', product: p })}
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      className={rowButton}
                      disabled={busyId === p.id}
                      onClick={() => void toggleActive(p)}
                    >
                      {p.active ? 'Desactivar' : 'Activar'}
                    </button>
                    {isAdmin && (
                      <button
                        type="button"
                        className={`${rowButton} text-red-700`}
                        onClick={() => setDialog({ kind: 'delete', product: p })}
                      >
                        Borrar
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {dialog?.kind === 'form' && (
        <ProductDialog
          product={dialog.product}
          onClose={() => setDialog(null)}
          onSaved={(message) => {
            setDialog(null);
            onNotice(message);
            reload();
          }}
        />
      )}
      {dialog?.kind === 'delete' && (
        <ConfirmDialog
          title="Borrar producto"
          confirmLabel="Borrar"
          destructive
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await catalogApi.deleteProduct(dialog.product.id);
            setDialog(null);
            onNotice(`${dialog.product.name} borrado`);
            reload();
          }}
        >
          <p>
            ¿Borrar <strong>{dialog.product.name}</strong>? Esta acción no se puede deshacer.
          </p>
          <p className="mt-2 text-stone-500">
            Si el producto ya tiene movimientos de stock no se puede borrar: desactivalo para que no
            aparezca al cargar ingresos y ventas.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}

function ProductDialog({
  product,
  onClose,
  onSaved,
}: {
  product: Product | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const text = (key: string) => String(form.get(key) ?? '').trim();

    // Precio y stock mínimo se escriben con coma ("8.500,50"); vacío borra el dato.
    const problems: string[] = [];
    const salePrice = text('salePrice') === '' ? null : inputToDecimal(text('salePrice'));
    if (text('salePrice') !== '' && salePrice === null) {
      problems.push('El precio sugerido no es válido (ej. 8500,50)');
    }
    const minStockKg = text('minStockKg') === '' ? null : inputToDecimal(text('minStockKg'), 3);
    if (text('minStockKg') !== '' && minStockKg === null) {
      problems.push('El stock mínimo no es válido (ej. 10,5; hasta 3 decimales)');
    }
    if (problems.length > 0) {
      setErrors(problems);
      return;
    }

    const data: ProductInput = {
      name: text('name'),
      category: text('category') || null,
      unit: text('unit') === 'UNIT' ? 'UNIT' : 'KG',
      salePrice,
      minStockKg,
    };
    setSaving(true);
    setErrors([]);
    try {
      if (product) {
        await catalogApi.updateProduct(product.id, data);
        onSaved(`${data.name} actualizado`);
      } else {
        await catalogApi.createProduct(data);
        onSaved(`${data.name} creado`);
      }
    } catch (err) {
      setErrors(errorMessages(err));
      setSaving(false);
    }
  }

  return (
    <Modal title={product ? 'Editar producto' : 'Nuevo producto'} onClose={onClose}>
      <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
        <Field label="Nombre">
          <input
            name="name"
            required
            minLength={2}
            maxLength={100}
            defaultValue={product?.name}
            placeholder="Ej. Asado, Vacío, Bife de chorizo"
            className={inputClass}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Categoría (opcional)">
            <input
              name="category"
              maxLength={50}
              list="product-categories"
              defaultValue={product?.category ?? ''}
              placeholder="Ej. vacuno"
              className={inputClass}
            />
            <datalist id="product-categories">
              {['vacuno', 'cerdo', 'pollo', 'achuras', 'embutidos'].map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
          <Field label="Se vende">
            <select name="unit" defaultValue={product?.unit ?? 'KG'} className={inputClass}>
              <option value="KG">{UNIT_LABELS.KG}</option>
              <option value="UNIT">{UNIT_LABELS.UNIT}</option>
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Precio sugerido (opcional)" hint="Se precarga al vender.">
            <input
              name="salePrice"
              inputMode="decimal"
              defaultValue={decimalToInput(product?.salePrice ?? null)}
              placeholder="Ej. 8500,00"
              className={inputClass}
            />
          </Field>
          <Field label="Stock mínimo en kg (opcional)" hint="Avisa cuando el stock baja de esto.">
            <input
              name="minStockKg"
              inputMode="decimal"
              defaultValue={decimalToInput(product?.minStockKg ?? null)}
              placeholder="Ej. 10"
              className={inputClass}
            />
          </Field>
        </div>
        <Errors messages={errors} />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving} className={secondaryButton}>
            Cancelar
          </button>
          <button type="submit" disabled={saving} className={primaryButton}>
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
