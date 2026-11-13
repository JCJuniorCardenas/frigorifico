/**
 * Formatos argentinos para la interfaz. Los importes viajan como string decimal con punto
 * ("439211.86"); en pantalla se muestran y editan con coma ("439211,86"). Nunca pasan por float.
 */

const moneyFormat = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const kgFormat = new Intl.NumberFormat('es-AR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Formatea un decimal string para mostrar ("439211.86" -> "$ 439.211,86").
 * Intl acepta strings decimales sin perder precisión (no se convierte a number).
 */
export function formatMoney(value: string): string {
  return moneyFormat.format(value as unknown as number);
}

export function formatKg(value: string): string {
  return `${kgFormat.format(value as unknown as number)} kg`;
}

/** "2026-11-12" -> "12/11/2026" (sin pasar por Date, para no correr el día por zona horaria). */
export function formatIsoDate(value: string): string {
  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
}

/** Decimal de la API -> texto editable: "439211.86" -> "439211,86". */
export function decimalToInput(value: string | null): string {
  return value === null ? '' : value.replace('.', ',');
}

const WITH_DECIMALS = /^(\d{1,3}(?:\.\d{3})+|\d+),(\d{1,2})$/;
const INTEGER = /^(\d{1,3}(?:\.\d{3})+|\d+)$/;

/**
 * Texto editado por el usuario -> decimal para la API, o null si no es válido.
 * Acepta "439211,86", "439.211,86", "439211" y "1.234". Máximo 2 decimales, no negativo.
 */
export function inputToDecimal(raw: string): string | null {
  const value = raw.trim().replace(/^\$\s*/, '');
  const withDecimals = WITH_DECIMALS.exec(value);
  if (withDecimals) {
    return `${stripZeros(withDecimals[1].replace(/\./g, ''))}.${withDecimals[2]}`;
  }
  const integer = INTEGER.exec(value);
  if (integer) return stripZeros(integer[1].replace(/\./g, ''));
  return null;
}

/** Decimal string -> centavos como BigInt, para sumar importes sin errores de redondeo. */
export function toCents(decimal: string): bigint {
  const [intPart, decPart = ''] = decimal.split('.');
  return BigInt(intPart + decPart.padEnd(2, '0').slice(0, 2));
}

/** Centavos -> decimal string ("43921186" -> "439211.86"). */
export function fromCents(cents: bigint): string {
  const digits = cents.toString().padStart(3, '0');
  return `${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

function stripZeros(digits: string): string {
  return digits.replace(/^0+(?=\d)/, '');
}
