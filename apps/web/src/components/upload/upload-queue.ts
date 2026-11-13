import type { DuplicateInfo, Invoice, ParseResponse } from '@/lib/invoices';

export type QueueStatus =
  'queued' | 'parsing' | 'ready' | 'saving' | 'saved' | 'duplicate' | 'error';

export interface QueueItem {
  id: string;
  file: File;
  /** URL local (blob:) para mostrar el PDF sin volver a pedirlo al servidor. */
  previewUrl: string | null;
  status: QueueStatus;
  parse?: ParseResponse;
  error?: string;
  duplicate?: DuplicateInfo;
  saved?: Invoice;
}

export const STATUS_LABELS: Record<QueueStatus, string> = {
  queued: 'En espera',
  parsing: 'Procesando…',
  ready: 'Listo para revisar',
  saving: 'Guardando…',
  saved: 'Guardada',
  duplicate: 'Duplicada',
  error: 'Error',
};

export const STATUS_STYLES: Record<QueueStatus, string> = {
  queued: 'bg-stone-100 text-stone-600',
  parsing: 'bg-sky-100 text-sky-800',
  ready: 'bg-amber-100 text-amber-900',
  saving: 'bg-sky-100 text-sky-800',
  saved: 'bg-green-100 text-green-800',
  duplicate: 'bg-orange-100 text-orange-900',
  error: 'bg-red-100 text-red-800',
};

export function duplicateMessage(d: DuplicateInfo): string {
  const voucher = `${d.salesPoint}-${d.voucherNumber}`;
  return d.reason === 'SAME_FILE'
    ? `Este PDF ya está cargado (factura ${voucher}, ${d.clientName}).`
    : `Ya existe la factura ${voucher} (${d.clientName}).`;
}

/** Corre tareas con un máximo de `limit` en paralelo. */
export async function runWithLimit<T>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
      await task(item);
    }
  });
  await Promise.all(workers);
}
