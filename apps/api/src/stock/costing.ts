import { Prisma } from '../generated/prisma/client.js';

/**
 * Cálculo de costos del stock, aislado para poder cambiar el método (por ejemplo a FIFO) sin
 * tocar el resto. Todo con Decimal: nunca number.
 */

export type Decimal = Prisma.Decimal;
export const Decimal = Prisma.Decimal;
export type DecimalInput = Prisma.Decimal | string | number;

const ROUND_HALF_UP = Prisma.Decimal.ROUND_HALF_UP;

/** Decimales con los que se guarda el costo promedio del producto (Product.avgCost). */
export const AVG_COST_DECIMALS = 4;

/** Importe en pesos redondeado a centavos (redondeo comercial, mitad hacia arriba). */
export function roundMoney(value: Prisma.Decimal): Prisma.Decimal {
  return value.toDecimalPlaces(2, ROUND_HALF_UP);
}

/** kg × precio por kg, redondeado a centavos: 12,345 kg × $ 1.000,99 = $ 12.357,22. */
export function lineTotal(kg: DecimalInput, pricePerKg: DecimalInput): Prisma.Decimal {
  return roundMoney(new Decimal(kg).times(pricePerKg));
}

/**
 * Costo promedio ponderado después de un ingreso:
 *
 *   nuevo = (stock × promedio + kg ingresados × costo) / (stock + kg ingresados)
 *
 * Si el stock previo es cero o negativo (se vendió antes de cargar el ingreso), lo que había no
 * tiene un costo que ponderar: el promedio pasa a ser el costo del ingreso.
 */
export function nextAverageCost(input: {
  stockKg: DecimalInput;
  avgCost: DecimalInput;
  kgIn: DecimalInput;
  costIn: DecimalInput;
}): Prisma.Decimal {
  const stockKg = new Decimal(input.stockKg);
  const kgIn = new Decimal(input.kgIn);
  const costIn = new Decimal(input.costIn);
  if (kgIn.lte(0)) throw new Error('Los kg ingresados deben ser mayores a cero');
  if (stockKg.lte(0)) return costIn.toDecimalPlaces(AVG_COST_DECIMALS, ROUND_HALF_UP);
  return stockKg
    .times(input.avgCost)
    .plus(kgIn.times(costIn))
    .dividedBy(stockKg.plus(kgIn))
    .toDecimalPlaces(AVG_COST_DECIMALS, ROUND_HALF_UP);
}

/** Valor del stock de un producto: kg × costo promedio. El stock negativo no tiene valor. */
export function stockValue(stockKg: DecimalInput, avgCost: DecimalInput): Prisma.Decimal {
  const kg = new Decimal(stockKg);
  return kg.lte(0) ? new Decimal(0) : roundMoney(kg.times(avgCost));
}
