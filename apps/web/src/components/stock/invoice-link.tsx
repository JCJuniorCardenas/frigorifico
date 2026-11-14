'use client';

import { useEffect, useState } from 'react';
import { formatIsoDate, formatKg, formatMoney } from '@/lib/format';
import { type LinkedInvoice, stockApi } from '@/lib/stock';

/** Vínculo ingreso ↔ factura de faena (módulo 1) por número de tropa. */

export const voucherOf = (i: LinkedInvoice) => `${i.salesPoint}-${i.voucherNumber}`;

function StatusPill({ status }: { status: LinkedInvoice['status'] }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-xs ${
        status === 'PAID' ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'
      }`}
    >
      {status === 'PAID' ? 'Pagada' : 'Pendiente'}
    </span>
  );
}

/** Acceso directo al PDF de la factura (ruta autenticada del módulo 1, en otra pestaña). */
export function InvoicePdfLink({ invoice, label }: { invoice: LinkedInvoice; label?: string }) {
  return (
    <a
      href={stockApi.invoicePdfUrl(invoice.id)}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="inline-flex items-center gap-1 rounded-md border border-stone-300 bg-white px-2 py-0.5 text-xs text-stone-800 hover:bg-stone-100"
      title={`Abrir la factura de faena ${voucherOf(invoice)}`}
    >
      {label ?? `Factura ${voucherOf(invoice)}`} ↗
    </a>
  );
}

/** Datos de la factura vinculada, con el acceso directo y (opcional) desvincular. */
export function InvoiceCard({
  invoice,
  onUnlink,
  busy,
}: {
  invoice: LinkedInvoice;
  onUnlink?: () => void;
  busy?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm">
      <div>
        <p className="font-medium">
          Factura de faena {voucherOf(invoice)} <StatusPill status={invoice.status} />
        </p>
        <p className="text-xs text-stone-600">
          {invoice.clientName} · tropa {invoice.herdNumber} · {formatIsoDate(invoice.issueDate)} ·{' '}
          {formatKg(invoice.slaughterKg)} · {formatMoney(invoice.totalAmount)}
        </p>
      </div>
      <div className="flex gap-2">
        <InvoicePdfLink invoice={invoice} label="Ver factura (PDF)" />
        {onUnlink && (
          <button
            type="button"
            onClick={onUnlink}
            disabled={busy}
            className="rounded-md px-2 py-0.5 text-xs text-stone-600 hover:bg-white disabled:opacity-60"
          >
            Desvincular
          </button>
        )}
      </div>
    </div>
  );
}

/** Busca las facturas de faena de una tropa (con una pequeña espera mientras se escribe). */
export function useInvoiceCandidates(herdNumber: string): LinkedInvoice[] | null {
  const [state, setState] = useState<{ herd: string; list: LinkedInvoice[] } | null>(null);
  const herd = herdNumber.trim();

  useEffect(() => {
    if (!herd) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      stockApi
        .invoiceCandidates(herd)
        .then((list) => !cancelled && setState({ herd, list }))
        .catch(() => !cancelled && setState({ herd, list: [] }));
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [herd]);

  // Solo vale el resultado de la tropa actual (evita mostrar el de una tropa anterior).
  return herd && state?.herd === herd ? state.list : null;
}

/**
 * Sugerencia al cargar un ingreso con tropa: muestra la(s) factura(s) de faena de esa tropa para
 * vincularla. `selectedId` null = sin vincular.
 */
export function InvoiceSuggestion({
  herdNumber,
  selectedId,
  onChange,
}: {
  herdNumber: string;
  selectedId: string | null;
  onChange: (invoiceId: string | null) => void;
}) {
  const candidates = useInvoiceCandidates(herdNumber);

  // Si hay exactamente una, se propone vinculada (el usuario puede destildarla).
  useEffect(() => {
    if (candidates?.length === 1) onChange(candidates[0].id);
    else onChange(null);
    // onChange es el setter de estado del formulario (estable).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates]);

  if (!herdNumber.trim() || candidates === null) return null;
  if (candidates.length === 0) {
    return (
      <p className="text-xs text-stone-500">
        No hay una factura de faena cargada con la tropa {herdNumber.trim()}. Se puede vincular
        después, desde el detalle del ingreso.
      </p>
    );
  }
  return (
    <fieldset className="space-y-2 rounded-md border border-sky-200 bg-sky-50 p-3 text-sm">
      <legend className="px-1 text-xs font-medium text-sky-900">
        Factura de faena de la tropa {herdNumber.trim()}
      </legend>
      {candidates.map((c) => (
        <label key={c.id} className="flex flex-wrap items-center gap-2">
          <input
            type="checkbox"
            checked={selectedId === c.id}
            onChange={(e) => onChange(e.target.checked ? c.id : null)}
          />
          <span>
            Vincular a <strong>{voucherOf(c)}</strong> · {c.clientName} · {formatKg(c.slaughterKg)}{' '}
            · {formatMoney(c.totalAmount)}
          </span>
          <StatusPill status={c.status} />
          <InvoicePdfLink invoice={c} label="Ver" />
        </label>
      ))}
    </fieldset>
  );
}
