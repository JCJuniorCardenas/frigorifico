import { describe, expect, it } from 'vitest';
import { lineTotal, sumDecimals, todayInArgentina } from './stock';

describe('lineTotal', () => {
  it('multiplica kg × precio exacto y redondea a centavos como la API', () => {
    expect(lineTotal('811', '430')).toBe('348730.00');
    expect(lineTotal('12.345', '1000.99')).toBe('12357.22');
    expect(lineTotal('0.005', '1')).toBe('0.01');
    expect(lineTotal('0.004', '1')).toBe('0.00');
  });
});

describe('sumDecimals', () => {
  it('suma sin errores de punto flotante', () => {
    expect(sumDecimals(['0.1', '0.2'], 2)).toBe('0.30');
    expect(sumDecimals(['12.345', '8.5'], 3)).toBe('20.845');
    expect(sumDecimals([], 2)).toBe('0.00');
  });
});

describe('todayInArgentina', () => {
  it('usa la zona horaria de Buenos Aires (UTC-3)', () => {
    expect(todayInArgentina(new Date('2026-11-14T02:30:00Z'))).toBe('2026-11-13');
    expect(todayInArgentina(new Date('2026-11-14T03:30:00Z'))).toBe('2026-11-14');
  });
});
