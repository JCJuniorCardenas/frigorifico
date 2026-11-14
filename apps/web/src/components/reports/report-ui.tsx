'use client';

import { type ReactNode, useState } from 'react';
import { type PeriodQuery, type ReportName, downloadCsv } from '@/lib/reports';

export interface Column<T> {
  header: string;
  cell: (row: T) => ReactNode;
  /** Celda de la fila de totales. */
  total?: ReactNode;
  align?: 'right';
}

/** Tabla de un reporte, con su fila de totales y el botón para exportarla a CSV. */
export function ReportTable<T>({
  title,
  columns,
  rows,
  rowKey,
  empty = 'Sin datos en el período.',
  csv,
}: {
  title: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  empty?: string;
  csv?: { report: ReportName; section: string; period: PeriodQuery };
}) {
  const hasTotals = columns.some((c) => c.total !== undefined);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-medium">{title}</h3>
        {csv && <CsvButton {...csv} />}
      </div>
      <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-stone-200 bg-stone-50 text-stone-600">
            <tr>
              {columns.map((c) => (
                <th
                  key={c.header}
                  className={`px-4 py-2 font-medium ${c.align === 'right' ? 'text-right' : ''}`}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-4 py-6 text-center text-stone-500">
                  {empty}
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={rowKey(row)} className="border-b border-stone-100 last:border-0">
                {columns.map((c) => (
                  <td
                    key={c.header}
                    className={`px-4 py-2 ${c.align === 'right' ? 'text-right tabular-nums' : ''}`}
                  >
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {hasTotals && rows.length > 0 && (
            <tfoot className="border-t border-stone-200 bg-stone-50 font-semibold">
              <tr>
                {columns.map((c) => (
                  <td
                    key={c.header}
                    className={`px-4 py-2 ${c.align === 'right' ? 'text-right tabular-nums' : ''}`}
                  >
                    {c.total}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

export function CsvButton({
  report,
  section,
  period,
}: {
  report: ReportName;
  section: string;
  period: PeriodQuery;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        setFailed(false);
        downloadCsv(report, section, period)
          .catch(() => setFailed(true))
          .finally(() => setBusy(false));
      }}
      className="rounded-md border border-stone-300 bg-white px-2.5 py-1 text-xs hover:bg-stone-100 disabled:opacity-60"
    >
      {busy ? 'Descargando…' : failed ? 'Error, reintentar' : 'Exportar CSV'}
    </button>
  );
}

export function StatCard({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail?: ReactNode;
  tone?: 'warn' | 'bad';
}) {
  const border =
    tone === 'bad'
      ? 'border-red-300 bg-red-50'
      : tone === 'warn'
        ? 'border-amber-300 bg-amber-50'
        : 'border-stone-200 bg-white';
  return (
    <div className={`rounded-lg border p-3 ${border}`}>
      <p className="text-xs text-stone-600">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
      {detail && <p className="mt-0.5 text-xs text-stone-600">{detail}</p>}
    </div>
  );
}
