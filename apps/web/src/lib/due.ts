import type { DueState } from './invoices';

/** Texto de la alerta de vencimiento (solo facturas pendientes). */
export function dueLabel(due: { state: DueState; daysToDue: number | null }): string | null {
  const days = due.daysToDue;
  if (due.state === 'paid' || days === null) return null;
  if (due.state === 'overdue') {
    const late = -days;
    return late === 1 ? 'Vencida hace 1 día' : `Vencida hace ${late} días`;
  }
  if (days === 0) return 'Vence hoy';
  if (days === 1) return 'Vence mañana';
  if (due.state === 'due_soon') return `Vence en ${days} días`;
  return null;
}

export const DUE_ROW_STYLES: Record<DueState, string> = {
  overdue: 'bg-red-50',
  due_soon: 'bg-amber-50',
  ok: '',
  paid: '',
};

export const DUE_BADGE_STYLES: Record<DueState, string> = {
  overdue: 'bg-red-100 text-red-800',
  due_soon: 'bg-amber-100 text-amber-900',
  ok: '',
  paid: '',
};
