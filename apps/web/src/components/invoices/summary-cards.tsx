'use client';

import { formatMoney } from '@/lib/format';
import type { InvoiceSummary, SummaryBucket } from '@/lib/invoices';

export type SummaryKey = 'pending' | 'overdue' | 'dueThisWeek' | 'collectedThisMonth';

const CARDS: { key: SummaryKey; title: string; tone: string }[] = [
  { key: 'pending', title: 'Pendiente de cobro', tone: 'border-stone-200' },
  { key: 'overdue', title: 'Vencido', tone: 'border-red-300 bg-red-50' },
  { key: 'dueThisWeek', title: 'Vence esta semana', tone: 'border-amber-300 bg-amber-50' },
  { key: 'collectedThisMonth', title: 'Cobrado en el mes', tone: 'border-green-300 bg-green-50' },
];

function facturas(bucket: SummaryBucket): string {
  return bucket.count === 1 ? '1 factura' : `${bucket.count} facturas`;
}

export function SummaryCards({
  summary,
  active,
  onSelect,
}: {
  summary: InvoiceSummary | null;
  active: SummaryKey | null;
  onSelect: (key: SummaryKey) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {CARDS.map((card) => {
        const bucket = summary?.[card.key];
        return (
          <button
            key={card.key}
            type="button"
            onClick={() => onSelect(card.key)}
            aria-pressed={active === card.key}
            className={`rounded-lg border bg-white p-3 text-left transition-shadow hover:shadow-sm ${card.tone} ${
              active === card.key ? 'ring-2 ring-stone-900' : ''
            }`}
          >
            <p className="text-xs font-medium text-stone-600">{card.title}</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">
              {bucket ? formatMoney(bucket.amount) : '—'}
            </p>
            <p className="text-xs text-stone-500">{bucket ? facturas(bucket) : 'Cargando…'}</p>
          </button>
        );
      })}
    </div>
  );
}
