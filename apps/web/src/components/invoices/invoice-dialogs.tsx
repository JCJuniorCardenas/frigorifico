'use client';

import { type FormEvent, type ReactNode, useState } from 'react';
import { Modal } from '@/components/ui/modal';
import { ApiError } from '@/lib/api';
import { formatIsoDate, formatMoney } from '@/lib/format';
import type { InvoiceField, InvoiceFields, InvoiceListItem } from '@/lib/invoices';
import {
  type FieldErrors,
  type FieldValues,
  InvoiceFieldGroups,
  toInvoiceFields,
  valuesFrom,
} from './invoice-fields';

function errorMessages(error: unknown): string[] {
  return error instanceof ApiError ? error.messages : ['Ocurrió un error. Probá de nuevo.'];
}

const primary =
  'rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-60';
const secondary =
  'rounded-md border border-stone-300 px-3 py-2 text-sm hover:bg-stone-100 disabled:opacity-60';
const danger =
  'rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-60';

function Errors({ messages }: { messages: string[] }) {
  if (messages.length === 0) return null;
  return (
    <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
      {messages.map((m) => (
        <p key={m}>{m}</p>
      ))}
    </div>
  );
}

/** Marcar una o varias facturas como pagadas, con la fecha de cobro (por defecto hoy). */
export function PayDialog({
  invoices,
  today,
  onConfirm,
  onClose,
}: {
  invoices: InvoiceListItem[];
  today: string;
  onConfirm: (paidAt: string) => Promise<void>;
  onClose: () => void;
}) {
  const [paidAt, setPaidAt] = useState(today);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const single = invoices.length === 1 ? invoices[0] : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!paidAt) return setErrors(['Indicá la fecha de pago.']);
    if (paidAt > today) return setErrors(['La fecha de pago no puede ser futura.']);
    setSaving(true);
    try {
      await onConfirm(paidAt);
    } catch (error) {
      setErrors(errorMessages(error));
      setSaving(false);
    }
  }

  return (
    <Modal
      title={single ? 'Marcar como pagada' : `Marcar ${invoices.length} facturas como pagadas`}
      onClose={onClose}
    >
      <form onSubmit={(e) => void submit(e)} className="space-y-4">
        <p className="text-sm text-stone-600">
          {single
            ? `${single.clientName} · ${single.salesPoint}-${single.voucherNumber} · ${formatMoney(single.totalAmount)}`
            : 'Se van a marcar todas con la misma fecha de pago.'}
        </p>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Fecha de pago</span>
          <input
            type="date"
            value={paidAt}
            max={today}
            required
            onChange={(e) => setPaidAt(e.target.value)}
            className="w-full rounded-md border border-stone-300 px-3 py-1.5 outline-none focus:border-stone-900"
          />
        </label>
        <Errors messages={errors} />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving} className={secondary}>
            Cancelar
          </button>
          <button type="submit" disabled={saving} className={primary}>
            {saving ? 'Guardando…' : 'Marcar pagada'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Confirmación genérica (revertir a pendiente, eliminar). */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  destructive = false,
  onConfirm,
  onClose,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  async function confirm(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await onConfirm();
    } catch (error) {
      setErrors(errorMessages(error));
      setSaving(false);
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={(e) => void confirm(e)} className="space-y-4">
        <div className="text-sm text-stone-700">{children}</div>
        <Errors messages={errors} />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving} className={secondary}>
            Cancelar
          </button>
          <button type="submit" disabled={saving} className={destructive ? danger : primary}>
            {saving ? 'Procesando…' : confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Editar los datos de una factura guardada. */
export function EditDialog({
  invoice,
  onSave,
  onClose,
}: {
  invoice: InvoiceListItem;
  onSave: (data: InvoiceFields & { needsReview: boolean }) => Promise<void>;
  onClose: () => void;
}) {
  const [original] = useState<FieldValues>(() => valuesFrom(invoice));
  const [values, setValues] = useState<FieldValues>(original);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [needsReview, setNeedsReview] = useState(invoice.needsReview);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  function setValue(field: InvoiceField, value: string) {
    setValues((prev) => ({ ...prev, [field]: value }));
    setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const { data, errors: validation } = toInvoiceFields(values);
    setFieldErrors(validation);
    setErrors([]);
    if (!data) return;
    setSaving(true);
    try {
      await onSave({ ...data, needsReview });
    } catch (error) {
      setErrors(errorMessages(error));
      setSaving(false);
    }
  }

  return (
    <Modal
      title={`Editar factura ${invoice.salesPoint}-${invoice.voucherNumber}`}
      onClose={onClose}
      wide
    >
      <form onSubmit={(e) => void submit(e)} noValidate className="space-y-4">
        <InvoiceFieldGroups
          values={values}
          original={original}
          errors={fieldErrors}
          onChange={setValue}
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={needsReview}
            onChange={(e) => setNeedsReview(e.target.checked)}
          />
          Marcada para revisar
        </label>
        {invoice.status === 'PAID' && invoice.paidAt && (
          <p className="text-xs text-stone-500">
            Pagada el {formatIsoDate(invoice.paidAt)}. La fecha de pago se cambia con
            &quot;Revertir&quot; y volviendo a marcarla pagada.
          </p>
        )}
        <Errors messages={errors} />
        <div className="flex justify-end gap-2 border-t border-stone-100 pt-3">
          <button type="button" onClick={onClose} disabled={saving} className={secondary}>
            Cancelar
          </button>
          <button type="submit" disabled={saving} className={primary}>
            {saving ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
