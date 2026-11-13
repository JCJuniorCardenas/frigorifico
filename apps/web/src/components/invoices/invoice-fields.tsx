'use client';

import { decimalToInput, formatMoney, fromCents, inputToDecimal, toCents } from '@/lib/format';
import {
  FIELD_LABELS,
  type InvoiceDraft,
  type InvoiceField,
  type InvoiceFields,
} from '@/lib/invoices';

/**
 * Campos editables de una factura, compartidos entre la revisión de carga y la edición
 * desde la tabla.
 */

type FieldKind =
  { type: 'text' } | { type: 'date' } | { type: 'decimal' } | { type: 'digits'; length?: number };

const FIELD_KINDS: Record<InvoiceField, FieldKind> = {
  salesPoint: { type: 'digits', length: 5 },
  voucherNumber: { type: 'digits', length: 8 },
  issueDate: { type: 'date' },
  paymentDueDate: { type: 'date' },
  clientName: { type: 'text' },
  clientCuit: { type: 'digits', length: 11 },
  herdNumber: { type: 'digits' },
  slaughterKg: { type: 'decimal' },
  totalAmount: { type: 'decimal' },
  netTaxedAmount: { type: 'decimal' },
  vat21Amount: { type: 'decimal' },
  exemptAmount: { type: 'decimal' },
  cae: { type: 'digits', length: 14 },
  caeDueDate: { type: 'date' },
};

const GROUPS: { title: string; fields: InvoiceField[] }[] = [
  { title: 'Comprobante', fields: ['salesPoint', 'voucherNumber', 'issueDate', 'paymentDueDate'] },
  { title: 'Cliente', fields: ['clientName', 'clientCuit'] },
  { title: 'Faena', fields: ['herdNumber', 'slaughterKg'] },
  { title: 'Importes', fields: ['netTaxedAmount', 'vat21Amount', 'exemptAmount', 'totalAmount'] },
  { title: 'CAE', fields: ['cae', 'caeDueDate'] },
];

export type FieldValues = Record<InvoiceField, string>;
export type FieldErrors = Partial<FieldValues>;

/** Valores de la API -> texto editable (importes con coma). */
export function valuesFrom(source: InvoiceDraft | InvoiceFields): FieldValues {
  const values = {} as FieldValues;
  for (const field of Object.keys(FIELD_LABELS) as InvoiceField[]) {
    const raw = source[field];
    values[field] = FIELD_KINDS[field].type === 'decimal' ? decimalToInput(raw) : (raw ?? '');
  }
  return values;
}

/** Valida y convierte lo que escribió el usuario al formato de la API. */
export function toInvoiceFields(values: FieldValues): {
  data?: InvoiceFields;
  errors: FieldErrors;
} {
  const errors: FieldErrors = {};
  const data = {} as InvoiceFields;
  for (const field of Object.keys(FIELD_KINDS) as InvoiceField[]) {
    const kind = FIELD_KINDS[field];
    const raw = values[field].trim();
    if (raw === '') {
      errors[field] = 'Obligatorio';
      continue;
    }
    if (kind.type === 'decimal') {
      const decimal = inputToDecimal(raw);
      if (decimal === null) errors[field] = 'Número inválido (ej. 1234,56)';
      else data[field] = decimal;
    } else if (kind.type === 'digits') {
      const digits = raw.replace(/[\s-]/g, '');
      if (!/^\d+$/.test(digits)) errors[field] = 'Solo números';
      else if (kind.length && digits.length !== kind.length)
        errors[field] = `Debe tener ${kind.length} dígitos`;
      else data[field] = digits;
    } else {
      data[field] = raw;
    }
  }
  return Object.keys(errors).length > 0 ? { errors } : { data, errors };
}

/** Aviso en vivo si neto + IVA + exento no da el total (otros tributos los avisa el lector). */
function sumNote(values: FieldValues): string | null {
  const amounts = (['netTaxedAmount', 'vat21Amount', 'exemptAmount', 'totalAmount'] as const).map(
    (f) => inputToDecimal(values[f]),
  );
  if (!amounts.every((a): a is string => a !== null)) return null;
  const [net, vat, exempt, total] = amounts;
  const sum = toCents(net) + toCents(vat) + toCents(exempt);
  if (sum === toCents(total)) return null;
  return `Neto + IVA + exento suman ${formatMoney(fromCents(sum))}, distinto del total ${formatMoney(total)}.`;
}

export function InvoiceFieldGroups({
  values,
  original,
  errors,
  warnedFields = new Set(),
  onChange,
}: {
  values: FieldValues;
  original: FieldValues;
  errors: FieldErrors;
  warnedFields?: Set<InvoiceField>;
  onChange: (field: InvoiceField, value: string) => void;
}) {
  const note = sumNote(values);
  return (
    <>
      {GROUPS.map((group) => (
        <fieldset key={group.title} className="space-y-2">
          <legend className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
            {group.title}
          </legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {group.fields.map((field) => (
              <Field
                key={field}
                field={field}
                value={values[field]}
                error={errors[field]}
                warned={warnedFields.has(field)}
                edited={values[field] !== original[field]}
                onChange={(v) => onChange(field, v)}
              />
            ))}
          </div>
          {group.title === 'Importes' && note && <p className="text-xs text-amber-800">{note}</p>}
        </fieldset>
      ))}
    </>
  );
}

function Field({
  field,
  value,
  error,
  warned,
  edited,
  onChange,
}: {
  field: InvoiceField;
  value: string;
  error?: string;
  warned: boolean;
  edited: boolean;
  onChange: (value: string) => void;
}) {
  const kind = FIELD_KINDS[field];
  const id = `invoice-${field}`;
  const border = error
    ? 'border-red-500 bg-red-50'
    : warned
      ? 'border-amber-400 bg-amber-50'
      : 'border-stone-300';
  return (
    <label
      htmlFor={id}
      className={`block text-sm ${field === 'clientName' ? 'sm:col-span-2' : ''}`}
    >
      <span className="mb-1 flex items-center gap-2 font-medium">
        {FIELD_LABELS[field]}
        {edited && <span className="text-xs font-normal text-sky-700">editado</span>}
      </span>
      <input
        id={id}
        name={field}
        type={kind.type === 'date' ? 'date' : 'text'}
        inputMode={
          kind.type === 'decimal' ? 'decimal' : kind.type === 'digits' ? 'numeric' : undefined
        }
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={`w-full rounded-md border px-3 py-1.5 outline-none focus:border-stone-900 ${border} ${
          kind.type === 'decimal' ? 'text-right tabular-nums' : ''
        }`}
      />
      {error && (
        <span id={`${id}-error`} className="mt-0.5 block text-xs text-red-700">
          {error}
        </span>
      )}
    </label>
  );
}
