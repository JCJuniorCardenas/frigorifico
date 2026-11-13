import { describe, expect, it } from 'vitest';
import {
  decimalToInput,
  formatIsoDate,
  formatKg,
  formatMoney,
  fromCents,
  inputToDecimal,
  toCents,
} from './format';

// Intl usa un espacio duro entre "$" y el número.
const normalizeSpaces = (s: string) => s.replace(/\s/g, ' ');

describe('formatMoney', () => {
  it('formatea en es-AR con separador de miles y coma decimal', () => {
    expect(normalizeSpaces(formatMoney('439211.86'))).toBe('$ 439.211,86');
    expect(normalizeSpaces(formatMoney('0'))).toBe('$ 0,00');
  });

  it('no pierde precisión con importes grandes', () => {
    expect(normalizeSpaces(formatMoney('123456789012.34'))).toBe('$ 123.456.789.012,34');
  });
});

describe('formatKg', () => {
  it('formatea kg con dos decimales', () => {
    expect(formatKg('811.00')).toBe('811,00 kg');
    expect(formatKg('1200.5')).toBe('1.200,50 kg');
  });
});

describe('formatIsoDate', () => {
  it('pasa de aaaa-mm-dd a dd/mm/aaaa sin corrimiento de zona', () => {
    expect(formatIsoDate('2026-11-12')).toBe('12/11/2026');
    expect(formatIsoDate('2027-01-01')).toBe('01/01/2027');
  });
});

describe('toCents / fromCents', () => {
  it('suma importes exactos', () => {
    const sum = toCents('348730.00') + toCents('73233.30') + toCents('17248.56');
    expect(fromCents(sum)).toBe('439211.86');
  });

  it('maneja enteros y un decimal', () => {
    expect(toCents('811')).toBe(81100n);
    expect(toCents('0.5')).toBe(50n);
    expect(fromCents(5n)).toBe('0.05');
  });
});

describe('decimalToInput / inputToDecimal', () => {
  it('convierte para editar y vuelve igual', () => {
    expect(decimalToInput('439211.86')).toBe('439211,86');
    expect(decimalToInput(null)).toBe('');
    expect(inputToDecimal(decimalToInput('439211.86'))).toBe('439211.86');
  });

  it.each([
    ['439211,86', '439211.86'],
    ['439.211,86', '439211.86'],
    ['1.234.567,8', '1234567.8'],
    ['811', '811'],
    ['1.234', '1234'],
    ['$ 17248,56', '17248.56'],
    ['007,50', '7.50'],
  ])('acepta "%s" -> "%s"', (input, expected) => {
    expect(inputToDecimal(input)).toBe(expected);
  });

  it.each(['', 'abc', '12,345', '1.23', '-5', '439211.86', '1,2,3', '12.34,5'])(
    'rechaza "%s"',
    (input) => {
      expect(inputToDecimal(input)).toBeNull();
    },
  );
});
