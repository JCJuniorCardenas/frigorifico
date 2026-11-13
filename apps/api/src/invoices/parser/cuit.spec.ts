import { isValidCuit, normalizeCuit } from './cuit.js';

describe('isValidCuit', () => {
  it.each([
    '30714542431', // cliente del PDF de ejemplo
    '27252783119', // emisor del PDF de ejemplo
    '30-71454243-1',
    '20000000001',
  ])('acepta %s', (cuit) => {
    expect(isValidCuit(cuit)).toBe(true);
  });

  it.each([
    '30714542432', // dígito verificador incorrecto
    '3071454243', // 10 dígitos
    '307145424311', // 12 dígitos
    '3071454243A',
    '',
  ])('rechaza "%s"', (cuit) => {
    expect(isValidCuit(cuit)).toBe(false);
  });
});

describe('normalizeCuit', () => {
  it('quita guiones y espacios', () => {
    expect(normalizeCuit('30-71454243-1')).toBe('30714542431');
    expect(normalizeCuit(' 27 25278311 9 ')).toBe('27252783119');
  });
});
