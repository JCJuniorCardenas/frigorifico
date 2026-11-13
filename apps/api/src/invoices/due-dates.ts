/**
 * Vencimientos. "Hoy" se calcula en la zona horaria de Argentina y se representa como fecha
 * calendario en UTC (00:00Z), igual que las columnas `@db.Date`, para comparar sin corrimientos.
 */

export const AR_TIMEZONE = 'America/Argentina/Buenos_Aires';
/** Una factura pendiente que vence dentro de estos días (o hoy) se marca "por vencer". */
export const DUE_SOON_DAYS = 3;
/** Ventana de la tarjeta "vence esta semana": de hoy a hoy + 7 días. */
export const DUE_WEEK_DAYS = 7;

const DAY_MS = 86_400_000;

const arDateFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: AR_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Fecha calendario de hoy en Argentina, como Date 00:00 UTC. */
export function todayInArgentina(now: Date = new Date()): Date {
  // en-CA formatea como aaaa-mm-dd.
  return new Date(`${arDateFormat.format(now)}T00:00:00.000Z`);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/** Días calendario entre dos fechas UTC 00:00 (b - a). */
export function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}

export type DueState = 'paid' | 'overdue' | 'due_soon' | 'ok';

export interface DueInfo {
  state: DueState;
  /** Días hasta el vencimiento (negativo = días de atraso). null si está pagada. */
  daysToDue: number | null;
}

/** Estado de vencimiento: solo las pendientes tienen alerta. */
export function dueInfo(
  invoice: { status: 'PENDING' | 'PAID'; paymentDueDate: Date },
  today: Date,
): DueInfo {
  if (invoice.status === 'PAID') return { state: 'paid', daysToDue: null };
  const daysToDue = daysBetween(today, invoice.paymentDueDate);
  if (daysToDue < 0) return { state: 'overdue', daysToDue };
  if (daysToDue <= DUE_SOON_DAYS) return { state: 'due_soon', daysToDue };
  return { state: 'ok', daysToDue };
}

/** Primer y último día del mes de `today` (para "cobrado en el mes"). */
export function monthRange(today: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0));
  return { start, end };
}
