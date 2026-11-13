import { addDays, daysBetween, dueInfo, monthRange, todayInArgentina } from './due-dates.js';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('todayInArgentina', () => {
  it('usa la fecha de Argentina (UTC-3), no la UTC', () => {
    // 02:30 UTC del 13/11 = 23:30 del 12/11 en Buenos Aires.
    expect(todayInArgentina(new Date('2026-11-13T02:30:00Z')).toISOString()).toBe(
      '2026-11-12T00:00:00.000Z',
    );
    // 03:30 UTC del 13/11 = 00:30 del 13/11 en Buenos Aires.
    expect(todayInArgentina(new Date('2026-11-13T03:30:00Z')).toISOString()).toBe(
      '2026-11-13T00:00:00.000Z',
    );
  });
});

describe('dueInfo', () => {
  const today = d('2026-11-13');
  const pending = (due: string) => ({ status: 'PENDING' as const, paymentDueDate: d(due) });

  it('vencida: con días de atraso', () => {
    expect(dueInfo(pending('2026-11-10'), today)).toEqual({ state: 'overdue', daysToDue: -3 });
    expect(dueInfo(pending('2026-11-12'), today)).toEqual({ state: 'overdue', daysToDue: -1 });
  });

  it('vence hoy o en 3 días o menos: por vencer', () => {
    expect(dueInfo(pending('2026-11-13'), today)).toEqual({ state: 'due_soon', daysToDue: 0 });
    expect(dueInfo(pending('2026-11-16'), today)).toEqual({ state: 'due_soon', daysToDue: 3 });
  });

  it('vence más adelante: sin alerta', () => {
    expect(dueInfo(pending('2026-11-17'), today)).toEqual({ state: 'ok', daysToDue: 4 });
  });

  it('pagada: nunca tiene alerta, aunque la fecha haya pasado', () => {
    expect(dueInfo({ status: 'PAID', paymentDueDate: d('2026-01-01') }, today)).toEqual({
      state: 'paid',
      daysToDue: null,
    });
  });

  it('cruza fin de mes y de año sin errores', () => {
    expect(daysBetween(d('2026-12-30'), d('2027-01-02'))).toBe(3);
    expect(addDays(d('2026-02-27'), 2).toISOString().slice(0, 10)).toBe('2026-03-01');
  });
});

describe('monthRange', () => {
  it('devuelve el primer y último día del mes', () => {
    const { start, end } = monthRange(d('2026-02-14'));
    expect(start.toISOString().slice(0, 10)).toBe('2026-02-01');
    expect(end.toISOString().slice(0, 10)).toBe('2026-02-28');
  });
});
