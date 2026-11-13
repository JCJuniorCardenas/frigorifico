import { describe, expect, it } from 'vitest';
import { dueLabel } from './due';

describe('dueLabel', () => {
  it('vencidas muestran los días de atraso', () => {
    expect(dueLabel({ state: 'overdue', daysToDue: -1 })).toBe('Vencida hace 1 día');
    expect(dueLabel({ state: 'overdue', daysToDue: -12 })).toBe('Vencida hace 12 días');
  });

  it('por vencer', () => {
    expect(dueLabel({ state: 'due_soon', daysToDue: 0 })).toBe('Vence hoy');
    expect(dueLabel({ state: 'due_soon', daysToDue: 1 })).toBe('Vence mañana');
    expect(dueLabel({ state: 'due_soon', daysToDue: 3 })).toBe('Vence en 3 días');
  });

  it('pagadas y al día no tienen alerta', () => {
    expect(dueLabel({ state: 'paid', daysToDue: null })).toBeNull();
    expect(dueLabel({ state: 'ok', daysToDue: 10 })).toBeNull();
  });
});
