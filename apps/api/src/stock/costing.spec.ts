import { lineTotal, nextAverageCost, roundMoney, stockValue, Decimal } from './costing.js';

describe('costing', () => {
  describe('nextAverageCost (promedio ponderado)', () => {
    it('dos ingresos del mismo producto con distinto costo', () => {
      // 100 kg a $1.000 y después 50 kg a $1.300: (100.000 + 65.000) / 150 = $1.100.
      const first = nextAverageCost({ stockKg: 0, avgCost: 0, kgIn: '100', costIn: '1000' });
      expect(first.toFixed(4)).toBe('1000.0000');
      const second = nextAverageCost({
        stockKg: '100',
        avgCost: first,
        kgIn: '50',
        costIn: '1300',
      });
      expect(second.toFixed(4)).toBe('1100.0000');
    });

    it('con kilos fraccionados redondea a 4 decimales', () => {
      // (10,5 × 4.200 + 3,25 × 4.750,50) / 13,75 = (44.100 + 15.439,125) / 13,75 = 4.330,1182
      const avg = nextAverageCost({
        stockKg: '10.5',
        avgCost: '4200',
        kgIn: '3.25',
        costIn: '4750.50',
      });
      expect(avg.toFixed(4)).toBe('4330.1182');
    });

    it('si el stock previo es cero o negativo, el promedio es el costo del ingreso', () => {
      expect(
        nextAverageCost({ stockKg: '0', avgCost: '900', kgIn: '20', costIn: '1500' }).toFixed(2),
      ).toBe('1500.00');
      expect(
        nextAverageCost({ stockKg: '-5', avgCost: '900', kgIn: '20', costIn: '1500' }).toFixed(2),
      ).toBe('1500.00');
    });

    it('no acepta ingresos sin kilos', () => {
      expect(() =>
        nextAverageCost({ stockKg: '10', avgCost: '1', kgIn: '0', costIn: '1' }),
      ).toThrow();
    });
  });

  it('lineTotal multiplica kg × precio y redondea a centavos (mitad hacia arriba)', () => {
    expect(lineTotal('811', '430').toFixed(2)).toBe('348730.00');
    expect(lineTotal('12.345', '1000.99').toFixed(2)).toBe('12357.22'); // 12357.22155
    expect(lineTotal('0.005', '1').toFixed(2)).toBe('0.01'); // 0.005 -> 0.01
  });

  it('roundMoney no usa float: 0,1 + 0,2 da exactamente 0,30', () => {
    expect(roundMoney(new Decimal('0.1').plus('0.2')).toFixed(2)).toBe('0.30');
  });

  it('stockValue: kg × promedio; el stock negativo vale cero', () => {
    expect(stockValue('150', '1100').toFixed(2)).toBe('165000.00');
    expect(stockValue('-2', '1100').toFixed(2)).toBe('0.00');
  });
});
