'use client';

import { type FormEvent, useState } from 'react';
import { ApiError } from '@/lib/api';
import { decimalToInput, formatMoney, fromCents, inputToDecimal, toCents } from '@/lib/format';
import {
  createInvoice,
  type DuplicateInfo,
  FIELD_LABELS,
  type Invoice,
  type InvoiceField,
  type InvoiceFields,
  type ParseResponse,
  warningField,
} from '@/lib/invoices';

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
  {
    title: 'Importes',
    fields: ['netTaxedAmount', 'vat21Amount', 'exemptAmount', 'totalAmount'],
  },
  { title: 'CAE', fields: ['cae', 'caeDueDate'] },
];

type Values = Record<InvoiceField, string>;

function initialValues(parse: ParseResponse): Values {
  const values = {} as Values;
  for (const field of Object.keys(FIELD_LABELS) as InvoiceField[]) {
    const raw = parse.draft[field];
    values[field] = FIELD_KINDS[field].type === 'decimal' ? decimalToInput(raw) : (raw ?? '');
  }
  return values;
}

/** Valida y convierte lo que escribió el usuario al formato de la API. */
function toInvoiceFields(values: Values): { data?: InvoiceFields; errors: Partial<Values> } {
  const errors: Partial<Values> = {};
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

interface Props {
  file: File;
  parse: ParseResponse;
  onSaving: () => void;
  onFailed: () => void;
  onSaved: (invoice: Invoice) => void;
  onDuplicate: (duplicate: DuplicateInfo) => void;
  onSkip: () => void;
}

export function InvoiceReviewForm({
  file,
  parse,
  onSaving,
  onFailed,
  onSaved,
  onDuplicate,
  onSkip,
}: Props) {
  const [original] = useState(() => initialValues(parse));
  const [values, setValues] = useState<Values>(original);
  const [errors, setErrors] = useState<Partial<Values>>({});
  const [serverErrors, setServerErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const warnedFields = new Set(
    parse.warnings.map(warningField).filter((f): f is InvoiceField => f !== undefined),
  );

  function setValue(field: InvoiceField, value: string) {
    setValues((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const { data, errors: validation } = toInvoiceFields(values);
    setErrors(validation);
    setServerErrors([]);
    if (!data) return;

    setSaving(true);
    onSaving();
    try {
      onSaved(await createInvoice(file, data));
    } catch (error) {
      setSaving(false);
      if (error instanceof ApiError && error.status === 409 && error.body.duplicate) {
        onDuplicate(error.body.duplicate as DuplicateInfo);
        return;
      }
      onFailed();
      setServerErrors(
        error instanceof ApiError ? error.messages : ['No se pudo guardar la factura.'],
      );
    }
  }

  // Control en vivo: neto + IVA + exento contra el total (otros tributos/alícuotas los avisa el lector).
  const amounts = (['netTaxedAmount', 'vat21Amount', 'exemptAmount', 'totalAmount'] as const).map(
    (f) => inputToDecimal(values[f]),
  );
  let sumNote: string | null = null;
  if (amounts.every((a): a is string => a !== null)) {
    const [net, vat, exempt, total] = amounts;
    const sum = toCents(net) + toCents(vat) + toCents(exempt);
    if (sum !== toCents(total)) {
      sumNote = `Neto + IVA + exento suman ${formatMoney(fromCents(sum))}, distinto del total ${formatMoney(total)}.`;
    }
  }

  return (
    <form
      onSubmit={(e) => void onSubmit(e)}
      noValidate
      className="space-y-4 rounded-lg border border-stone-200 bg-white p-4"
      aria-label={`Revisión de ${file.name}`}
    >
      <div>
        <h2 className="font-semibold">Revisá los datos</h2>
        <p className="truncate text-xs text-stone-500" title={file.name}>
          {file.name}
        </p>
      </div>

      {parse.warnings.length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-medium">Revisá estas advertencias antes de guardar:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {parse.warnings.map((w, i) => (
              <li key={`${w.code}-${i}`}>{w.message}</li>
            ))}
          </ul>
        </div>
      )}

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
                onChange={(v) => setValue(field, v)}
              />
            ))}
          </div>
          {group.title === 'Importes' && sumNote && (
            <p className="text-xs text-amber-800">{sumNote}</p>
          )}
        </fieldset>
      ))}

      {serverErrors.length > 0 && (
        <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {serverErrors.map((m) => (
            <p key={m}>{m}</p>
          ))}
        </div>
      )}
      {Object.values(errors).some(Boolean) && (
        <p role="alert" className="text-sm text-red-700">
          Corregí los campos marcados en rojo.
        </p>
      )}

      <div className="flex flex-wrap justify-end gap-2 border-t border-stone-100 pt-3">
        <button
          type="button"
          onClick={onSkip}
          disabled={saving}
          className="rounded-md border border-stone-300 px-3 py-2 text-sm hover:bg-stone-100 disabled:opacity-60"
        >
          Revisar después
        </button>
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-60"
        >
          {saving ? 'Guardando…' : 'Confirmar y guardar'}
        </button>
      </div>
    </form>
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
