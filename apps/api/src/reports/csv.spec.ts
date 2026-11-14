import { daysOf, resolvePeriod } from './period.js';
import { csvDate, csvDecimal, toCsv } from './csv.js';

describe('CSV', () => {
  const columns = [
    { header: 'Producto', value: (r: { name: string }) => r.name },
    { header: 'Importe', value: (r: { amount: string }) => r.amount, kind: 'decimal' as const },
    { header: 'Fecha', value: (r: { date: string }) => r.date, kind: 'date' as const },
  ];

  it('usa ";", coma decimal, fechas dd/mm/aaaa, CRLF y BOM', () => {
    const csv = toCsv(columns, [{ name: 'Vacío', amount: '1234.50', date: '2026-11-13' }]);
    expect(csv).toBe('﻿Producto;Importe;Fecha\r\nVacío;1234,50;13/11/2026\r\n');
  });

  it('escapa comillas y separadores, y neutraliza fórmulas', () => {
    const csv = toCsv(columns, [
      { name: 'Bife "ancho"; premium', amount: '-5.00', date: '2026-01-02' },
      { name: '=HYPERLINK("x")', amount: '0.10', date: '2026-01-02' },
    ]);
    const lines = csv.slice(1).split('\r\n');
    expect(lines[1]).toBe('"Bife ""ancho""; premium";-5,00;02/01/2026');
    expect(lines[2]).toBe(`"'=HYPERLINK(""x"")";0,10;02/01/2026`);
  });

  it('formatea números y fechas sueltos', () => {
    expect(csvDecimal('439211.86')).toBe('439211,86');
    expect(csvDate('2026-02-01')).toBe('01/02/2026');
  });
});

describe('período de los reportes', () => {
  it('por defecto es el mes actual en Argentina', () => {
    // 1/12 a las 01:00 UTC todavía es 30/11 en Argentina.
    const p = resolvePeriod(undefined, undefined, new Date('2026-12-01T01:00:00Z'));
    expect(p.from.toISOString().slice(0, 10)).toBe('2026-11-01');
    expect(p.to.toISOString().slice(0, 10)).toBe('2026-11-30');
  });

  it('valida el rango', () => {
    expect(() => resolvePeriod('2026-11-10', '2026-11-01')).toThrow('posterior');
    expect(() => resolvePeriod('2026-02-30', '2026-03-01')).toThrow('inválido');
    expect(() => resolvePeriod('2020-01-01', '2026-01-01')).toThrow('2 años');
  });

  it('lista todos los días del período', () => {
    expect(daysOf(resolvePeriod('2026-02-27', '2026-03-02'))).toEqual([
      '2026-02-27',
      '2026-02-28',
      '2026-03-01',
      '2026-03-02',
    ]);
  });
});
