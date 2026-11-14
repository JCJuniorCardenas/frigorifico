import { describe, expect, it } from 'vitest';
import { formatPct, presetPeriod } from './reports';

describe('presetPeriod', () => {
  it('calcula los atajos sin correr días por zona horaria', () => {
    expect(presetPeriod('today', '2026-03-01')).toEqual({ from: '2026-03-01', to: '2026-03-01' });
    expect(presetPeriod('week', '2026-03-03')).toEqual({ from: '2026-02-25', to: '2026-03-03' });
    expect(presetPeriod('month', '2026-02-14')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(presetPeriod('lastMonth', '2026-01-15')).toEqual({
      from: '2025-12-01',
      to: '2025-12-31',
    });
  });
});

describe('formatPct', () => {
  it('usa coma decimal', () => {
    expect(formatPct('43.91')).toBe('43,91 %');
    expect(formatPct('-5.00')).toBe('-5,00 %');
    expect(formatPct(null)).toBe('—');
  });
});
