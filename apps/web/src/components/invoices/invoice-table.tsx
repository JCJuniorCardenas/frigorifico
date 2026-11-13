'use client';

import { DUE_BADGE_STYLES, DUE_ROW_STYLES, dueLabel } from '@/lib/due';
import { formatIsoDate, formatKg, formatMoney } from '@/lib/format';
import { type InvoiceListItem, invoicesApi, type SortField } from '@/lib/invoices';

const COLUMNS: { label: string; sort?: SortField; align?: 'right' }[] = [
  { label: 'Cliente', sort: 'clientName' },
  { label: 'N° de tropa', sort: 'herdNumber' },
  { label: 'Kg de faena', sort: 'slaughterKg', align: 'right' },
  { label: 'Importe total', sort: 'totalAmount', align: 'right' },
  { label: 'Vencimiento', sort: 'paymentDueDate' },
  { label: 'N° de comprobante', sort: 'voucherNumber' },
  { label: 'Estado', sort: 'status' },
  { label: 'Acciones' },
];

export interface TableActions {
  onPay: (invoice: InvoiceListItem) => void;
  onRevert: (invoice: InvoiceListItem) => void;
  onEdit: (invoice: InvoiceListItem) => void;
  onDelete?: (invoice: InvoiceListItem) => void;
}

export function InvoiceTable({
  items,
  loading,
  sort,
  dir,
  onSort,
  selected,
  onToggle,
  onToggleAll,
  actions,
}: {
  items: InvoiceListItem[];
  loading: boolean;
  sort: SortField;
  dir: 'asc' | 'desc';
  onSort: (field: SortField) => void;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: (checked: boolean) => void;
  actions: TableActions;
}) {
  const allSelected = items.length > 0 && items.every((i) => selected.has(i.id));

  return (
    <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-stone-200 bg-stone-50 text-xs text-stone-600">
          <tr>
            <th className="w-8 px-3 py-2">
              <input
                type="checkbox"
                aria-label="Seleccionar todas las de esta página"
                checked={allSelected}
                onChange={(e) => onToggleAll(e.target.checked)}
              />
            </th>
            {COLUMNS.map((col) => (
              <th
                key={col.label}
                className={`px-3 py-2 font-medium whitespace-nowrap ${col.align === 'right' ? 'text-right' : ''}`}
                aria-sort={
                  col.sort && col.sort === sort
                    ? dir === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : undefined
                }
              >
                {col.sort ? (
                  <button
                    type="button"
                    onClick={() => onSort(col.sort!)}
                    className="inline-flex items-center gap-1 hover:text-stone-900"
                  >
                    {col.label}
                    <span aria-hidden className="w-2 text-stone-400">
                      {col.sort === sort ? (dir === 'asc' ? '▲' : '▼') : ''}
                    </span>
                  </button>
                ) : (
                  col.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className={loading ? 'opacity-60' : ''}>
          {items.length === 0 && (
            <tr>
              <td colSpan={COLUMNS.length + 1} className="px-3 py-10 text-center text-stone-500">
                {loading ? 'Cargando…' : 'No hay facturas con estos filtros.'}
              </td>
            </tr>
          )}
          {items.map((inv) => {
            const label = dueLabel(inv.due);
            return (
              <tr
                key={inv.id}
                className={`border-b border-stone-100 last:border-0 ${DUE_ROW_STYLES[inv.due.state]}`}
              >
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label={`Seleccionar factura ${inv.salesPoint}-${inv.voucherNumber}`}
                    checked={selected.has(inv.id)}
                    onChange={() => onToggle(inv.id)}
                  />
                </td>
                <td className="max-w-56 px-3 py-2">
                  <span className="block truncate font-medium" title={inv.clientName}>
                    {inv.clientName}
                  </span>
                  {inv.needsReview && (
                    <span
                      className="rounded bg-amber-100 px-1 text-xs text-amber-900"
                      title="El lector encontró advertencias en esta factura"
                    >
                      Revisar
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 tabular-nums">{inv.herdNumber}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
                  {formatKg(inv.slaughterKg)}
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
                  {formatMoney(inv.totalAmount)}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <span className="tabular-nums">{formatIsoDate(inv.paymentDueDate)}</span>
                  {label && (
                    <span
                      className={`ml-2 rounded px-1.5 py-0.5 text-xs ${DUE_BADGE_STYLES[inv.due.state]}`}
                    >
                      {label}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                  {inv.salesPoint}-{inv.voucherNumber}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {inv.status === 'PAID' ? (
                    <span className="rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-800">
                      Pagada {inv.paidAt ? formatIsoDate(inv.paidAt) : ''}
                    </span>
                  ) : (
                    <span className="rounded bg-stone-100 px-1.5 py-0.5 text-xs text-stone-700">
                      Pendiente
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <div className="flex items-center gap-1">
                    {inv.status === 'PENDING' ? (
                      <button
                        type="button"
                        onClick={() => actions.onPay(inv)}
                        className="rounded-md bg-stone-900 px-2 py-1 text-xs font-medium text-white hover:bg-stone-800"
                      >
                        Marcar pagada
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => actions.onRevert(inv)}
                        className="rounded-md border border-stone-300 px-2 py-1 text-xs hover:bg-stone-100"
                      >
                        Revertir
                      </button>
                    )}
                    <a
                      href={invoicesApi.pdfUrl(inv.id)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-md px-2 py-1 text-xs text-stone-700 hover:bg-stone-100"
                    >
                      PDF
                    </a>
                    <button
                      type="button"
                      onClick={() => actions.onEdit(inv)}
                      className="rounded-md px-2 py-1 text-xs text-stone-700 hover:bg-stone-100"
                    >
                      Editar
                    </button>
                    {actions.onDelete && (
                      <button
                        type="button"
                        onClick={() => actions.onDelete?.(inv)}
                        className="rounded-md px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                      >
                        Eliminar
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
