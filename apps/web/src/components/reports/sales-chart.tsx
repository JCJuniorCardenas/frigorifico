'use client';

import { useState } from 'react';
import { formatIsoDate, formatKg, formatMoney, fromCents } from '@/lib/format';
import type { SalesReport } from '@/lib/reports';

/** Centavos como BigInt, para escalar las barras sin pasar importes por float. */
const cents = (amount: string) => BigInt(amount.replace('.', ''));

/**
 * Ventas por día: una sola serie, barras finas con el extremo redondeado y separación entre
 * barras; al pasar el mouse (o con el teclado) muestra el detalle del día. La misma información
 * está en la tabla "Ventas por día" que se exporta a CSV.
 */
export function SalesByDayChart({ days }: { days: SalesReport['byDay'] }) {
  const [active, setActive] = useState<number | null>(null);
  const max = days.reduce((m, d) => (cents(d.amount) > m ? cents(d.amount) : m), 0n);
  const shown = active === null ? null : days[active];
  const label = (d: SalesReport['byDay'][number]) =>
    `${formatIsoDate(d.date)}: ${formatMoney(d.amount)}, ${d.count} venta(s), ${formatKg(d.kg, 3)}`;

  if (max === 0n) {
    return <p className="text-sm text-stone-500">No hubo ventas en el período.</p>;
  }
  return (
    <figure className="space-y-2">
      <figcaption className="flex min-h-5 justify-between gap-3 text-xs text-stone-600">
        <span>Importe vendido por día</span>
        <span className="tabular-nums" aria-live="polite">
          {shown ? label(shown) : `Máximo: ${formatMoney(fromCents(max))}`}
        </span>
      </figcaption>
      <div
        className="flex h-40 items-end gap-0.5 border-b border-stone-300"
        onMouseLeave={() => setActive(null)}
      >
        {days.map((d, i) => {
          // Altura en décimas de porcentaje, calculada con enteros.
          const height = Number((cents(d.amount) * 1000n) / max) / 10;
          return (
            <button
              key={d.date}
              type="button"
              aria-label={label(d)}
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
              className="group flex h-full flex-1 items-end focus:outline-none"
            >
              <span
                className={`block w-full rounded-t-[4px] ${
                  active === i ? 'bg-stone-500' : 'bg-stone-800'
                } group-focus-visible:ring-2 group-focus-visible:ring-amber-500`}
                style={{ height: `${height}%`, minHeight: cents(d.amount) > 0n ? 2 : 0 }}
              />
            </button>
          );
        })}
      </div>
      <div className="flex justify-between text-xs text-stone-500">
        <span>{formatIsoDate(days[0].date)}</span>
        <span>{formatIsoDate(days[days.length - 1].date)}</span>
      </div>
    </figure>
  );
}
