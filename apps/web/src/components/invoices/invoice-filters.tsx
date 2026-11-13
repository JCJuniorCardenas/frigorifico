'use client';

import type { ClientOption, StatusFilter } from '@/lib/invoices';

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'pending', label: 'Pendientes' },
  { value: 'overdue', label: 'Vencidas' },
  { value: 'paid', label: 'Pagadas' },
  { value: 'all', label: 'Todas' },
];

export interface FilterValues {
  search: string;
  status: StatusFilter;
  clientCuit: string;
  dateField: 'issue' | 'due';
  from: string;
  to: string;
}

export function InvoiceFilters({
  values,
  clients,
  onChange,
  onReset,
}: {
  values: FilterValues;
  clients: ClientOption[];
  onChange: (patch: Partial<FilterValues>) => void;
  onReset: () => void;
}) {
  const input =
    'rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-stone-900';
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border border-stone-200 bg-white p-3">
      <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs text-stone-600">
        Buscar
        <input
          type="search"
          value={values.search}
          onChange={(e) => onChange({ search: e.target.value })}
          placeholder="Cliente, tropa o comprobante"
          className={input}
        />
      </label>

      <div className="flex flex-col gap-1 text-xs text-stone-600">
        Estado
        <div className="flex rounded-md border border-stone-300 p-0.5" role="group">
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange({ status: opt.value })}
              aria-pressed={values.status === opt.value}
              className={`rounded px-2.5 py-1 text-sm ${
                values.status === opt.value
                  ? 'bg-stone-900 text-white'
                  : 'text-stone-700 hover:bg-stone-100'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <label className="flex flex-col gap-1 text-xs text-stone-600">
        Cliente
        <select
          value={values.clientCuit}
          onChange={(e) => onChange({ clientCuit: e.target.value })}
          className={`${input} max-w-56`}
        >
          <option value="">Todos</option>
          {clients.map((c) => (
            <option key={c.clientCuit} value={c.clientCuit}>
              {c.clientName}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-xs text-stone-600">
        Fecha de
        <select
          value={values.dateField}
          onChange={(e) => onChange({ dateField: e.target.value as 'issue' | 'due' })}
          className={input}
        >
          <option value="issue">Emisión</option>
          <option value="due">Vencimiento</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-stone-600">
        Desde
        <input
          type="date"
          value={values.from}
          max={values.to || undefined}
          onChange={(e) => onChange({ from: e.target.value })}
          className={input}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-stone-600">
        Hasta
        <input
          type="date"
          value={values.to}
          min={values.from || undefined}
          onChange={(e) => onChange({ to: e.target.value })}
          className={input}
        />
      </label>

      <button
        type="button"
        onClick={onReset}
        className="rounded-md px-2.5 py-1.5 text-sm text-stone-600 underline hover:text-stone-900"
      >
        Limpiar filtros
      </button>
    </div>
  );
}
