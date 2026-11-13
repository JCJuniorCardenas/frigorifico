'use client';

import { type FormEvent, useEffect, useState } from 'react';
import { Errors, errorMessages, inputClass } from '@/components/catalog/catalog-ui';
import { Modal } from '@/components/ui/modal';
import { formatIsoDate, formatKg, formatMoney } from '@/lib/format';
import { PAYMENT_LABELS, type SaleDetail, formatDateTime, formatTime, salesApi } from '@/lib/sales';

/** Detalle de una venta (ítems, forma de pago, anulación). */
export function SaleDetailDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const [sale, setSale] = useState<SaleDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    salesApi
      .detail(id)
      .then(setSale)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'No se pudo cargar'));
  }, [id]);

  return (
    <Modal title="Detalle de la venta" onClose={onClose} wide>
      {error && <Errors messages={[error]} />}
      {!sale && !error && <p className="text-sm text-stone-500">Cargando…</p>}
      {sale && (
        <div className="space-y-3 text-sm">
          {sale.voided && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-red-800">
              Anulada por {sale.voidedBy} el {sale.voidedAt ? formatDateTime(sale.voidedAt) : ''}:{' '}
              {sale.voidReason}
            </p>
          )}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
            <Item
              label="Fecha"
              value={`${formatIsoDate(sale.date)} ${formatTime(sale.createdAt)}`}
            />
            <Item label="Cliente" value={sale.customerName ?? 'Mostrador'} />
            <Item label="Forma de pago" value={PAYMENT_LABELS[sale.paymentMethod]} />
            <Item label="Vendió" value={sale.createdBy} />
          </dl>
          <table className="w-full text-left">
            <thead className="border-b border-stone-200 text-stone-600">
              <tr>
                <th className="py-1.5 font-medium">Producto</th>
                <th className="py-1.5 text-right font-medium">Kg</th>
                <th className="py-1.5 text-right font-medium">Precio/kg</th>
                <th className="py-1.5 text-right font-medium">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {sale.items.map((i) => (
                <tr key={i.id} className="border-b border-stone-100">
                  <td className="py-1.5">{i.productName}</td>
                  <td className="py-1.5 text-right tabular-nums">{formatKg(i.kg, 3)}</td>
                  <td className="py-1.5 text-right tabular-nums">{formatMoney(i.pricePerKg)}</td>
                  <td className="py-1.5 text-right tabular-nums">{formatMoney(i.subtotal)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td className="py-1.5">Total</td>
                <td className="py-1.5 text-right tabular-nums">{formatKg(sale.totalKg, 3)}</td>
                <td />
                <td className="py-1.5 text-right tabular-nums">{formatMoney(sale.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Modal>
  );
}

/** Anular una venta (solo ADMIN): pide el motivo. */
export function VoidSaleDialog({
  sale,
  onClose,
  onVoided,
}: {
  sale: { id: string; total: string; date: string };
  onClose: () => void;
  onVoided: () => void;
}) {
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErrors([]);
    try {
      await salesApi.void(sale.id, reason);
      onVoided();
    } catch (err) {
      setErrors(errorMessages(err));
      setSaving(false);
    }
  }

  return (
    <Modal title="Anular venta" onClose={onClose}>
      <form onSubmit={(e) => void onSubmit(e)} className="space-y-4 text-sm">
        <p className="text-stone-700">
          Venta del {formatIsoDate(sale.date)} por <strong>{formatMoney(sale.total)}</strong>. Los
          kilos vuelven al stock y la venta deja de contar en los totales. No se puede deshacer.
        </p>
        <label className="block">
          <span className="mb-1 block font-medium">Motivo</span>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
            minLength={3}
            maxLength={200}
            placeholder="Ej. error de carga, devolución"
            className={inputClass}
          />
        </label>
        <Errors messages={errors} />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-md border border-stone-300 px-3 py-2 hover:bg-stone-100"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-red-700 px-4 py-2 font-medium text-white hover:bg-red-800 disabled:opacity-60"
          >
            {saving ? 'Anulando…' : 'Anular venta'}
          </button>
        </div>
      </form>
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
