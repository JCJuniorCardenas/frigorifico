import { BadRequestException } from '@nestjs/common';
import { monthRange, todayInArgentina } from '../invoices/due-dates.js';
import { fromIsoDate, toIsoDate } from '../invoices/invoice.mapper.js';

/** Rango de fechas de un reporte (fechas calendario a las 00:00 UTC, inclusivas). */
export interface Period {
  from: Date;
  to: Date;
}

/** Más de esto no tiene sentido para el desglose por día y haría lentas las consultas. */
export const MAX_PERIOD_DAYS = 731;
const DAY_MS = 86_400_000;

/** Por defecto, el mes actual (en Argentina). */
export function resolvePeriod(from?: string, to?: string, now = new Date()): Period {
  const month = monthRange(todayInArgentina(now));
  const start = from ? fromIsoDate(from) : month.start;
  const end = to ? fromIsoDate(to) : month.end;
  if (!start || !end) throw new BadRequestException('Rango de fechas inválido');
  if (start > end) throw new BadRequestException('La fecha "desde" es posterior a "hasta"');
  if ((end.getTime() - start.getTime()) / DAY_MS + 1 > MAX_PERIOD_DAYS) {
    throw new BadRequestException('El período no puede superar los 2 años');
  }
  return { from: start, to: end };
}

/** Todos los días del período, "aaaa-mm-dd", para que el desglose diario no tenga huecos. */
export function daysOf(period: Period): string[] {
  const days: string[] = [];
  for (let t = period.from.getTime(); t <= period.to.getTime(); t += DAY_MS) {
    days.push(toIsoDate(new Date(t)));
  }
  return days;
}

export function periodView(period: Period): { from: string; to: string } {
  return { from: toIsoDate(period.from), to: toIsoDate(period.to) };
}
