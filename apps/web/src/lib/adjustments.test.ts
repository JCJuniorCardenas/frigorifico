import { describe, expect, it } from 'vitest';
import { addKg, negateKg, signedKgToDecimal } from './adjustments';

describe('signedKgToDecimal', () => {
  it('acepta signo, coma decimal y hasta 3 decimales', () => {
    expect(signedKgToDecimal('-1,5')).toBe('-1.5');
    expect(signedKgToDecimal('+2')).toBe('2');
    expect(signedKgToDecimal(' 0,750 ')).toBe('0.750');
    expect(signedKgToDecimal('1.234,567')).toBe('1234.567');
  });

  it('rechaza lo inválido', () => {
    expect(signedKgToDecimal('1,2345')).toBeNull();
    expect(signedKgToDecimal('abc')).toBeNull();
    expect(signedKgToDecimal('')).toBeNull();
  });
});

describe('addKg', () => {
  it('suma kg con signo sin errores de punto flotante', () => {
    expect(addKg('47.500', '-0.750')).toBe('46.750');
    expect(addKg('48', '-50')).toBe('-2.000');
    expect(addKg('-2.000', '2')).toBe('0.000');
    expect(addKg('0.1', '0.2')).toBe('0.300');
  });
});

describe('negateKg + addKg (diferencia de un conteo)', () => {
  it('contado − stock', () => {
    expect(addKg('46.750', negateKg('47.500'))).toBe('-0.750');
    expect(addKg('0', negateKg('-2.000'))).toBe('2.000');
  });
});
