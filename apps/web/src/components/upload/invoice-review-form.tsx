'use client';

import { type FormEvent, useState } from 'react';
import { ApiError } from '@/lib/api';
import {
  createInvoice,
  type DuplicateInfo,
  type Invoice,
  type InvoiceField,
  type ParseResponse,
  warningField,
} from '@/lib/invoices';
import {
  type FieldErrors,
  type FieldValues,
  InvoiceFieldGroups,
  toInvoiceFields,
  valuesFrom,
} from '../invoices/invoice-fields';

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
  const [original] = useState(() => valuesFrom(parse.draft));
  const [values, setValues] = useState<FieldValues>(original);
  const [errors, setErrors] = useState<FieldErrors>({});
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

      <InvoiceFieldGroups
        values={values}
        original={original}
        errors={errors}
        warnedFields={warnedFields}
        onChange={setValue}
      />

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
