import {
  formatArgentineDate,
  parseArgentineDate,
  parseArgentineDecimal,
} from './argentine-format.js';

describe('parseArgentineDecimal', () => {
  it.each([
    ['439211,86', '439211.86'],
    ['1.234.567,89', '1234567.89'],
    ['811,00', '811.00'],
    ['0,00', '0.00'],
    ['3777,14', '3777.14'],
    ['12.345,6', '12345.6'],
    ['1.234', '1234'],
    ['430', '430'],
    ['$ 17248,56', '17248.56'],
    ['  348730,00 ', '348730.00'],
    ['-1.500,25', '-1500.25'],
    ['007,50', '7.50'],
  ])('"%s" -> "%s"', (input, expected) => {
    expect(parseArgentineDecimal(input)).toBe(expected);
  });

  it.each(['', 'abc', '1,2,3', '12.34,5', '1.23', '1,234.56', '12.', ',5', '1 234,00'])(
    'rechaza "%s"',
    (input) => {
      expect(() => parseArgentineDecimal(input)).toThrow();
    },
  );
});

describe('parseArgentineDate', () => {
  it('convierte dd/mm/aaaa a fecha UTC sin corrimiento de zona', () => {
    const date = parseArgentineDate('12/11/2026');
    expect(date.toISOString()).toBe('2026-11-12T00:00:00.000Z');
  });

  it('acepta el 29/02 de un año bisiesto', () => {
    expect(parseArgentineDate('29/02/2028').toISOString()).toBe('2028-02-29T00:00:00.000Z');
  });

  it.each(['31/02/2026', '29/02/2026', '00/01/2026', '12/13/2026', '2026-11-12', '1/1/2026', ''])(
    'rechaza "%s"',
    (input) => {
      expect(() => parseArgentineDate(input)).toThrow();
    },
  );

  it('formatArgentineDate es la inversa', () => {
    expect(formatArgentineDate(parseArgentineDate('05/01/2027'))).toBe('05/01/2027');
  });
});
