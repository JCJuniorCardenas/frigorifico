/**
 * Conversión de formatos argentinos. Los importes nunca pasan por `number`: se devuelven como
 * string decimal normalizado ("1234567.89") listo para Decimal/Prisma.
 */

const WITH_DECIMALS = /^(-)?(\d{1,3}(?:\.\d{3})+|\d+),(\d+)$/;
const THOUSANDS_ONLY = /^(-)?(\d{1,3}(?:\.\d{3})+)$/;
const INTEGER = /^(-)?(\d+)$/;

/**
 * "439211,86" -> "439211.86"; "1.234.567,89" -> "1234567.89"; "1.234" -> "1234".
 * Lanza error si el texto no es un número en formato argentino.
 */
export function parseArgentineDecimal(raw: string): string {
  const value = raw.trim().replace(/^\$\s*/, '');
  const withDecimals = WITH_DECIMALS.exec(value);
  if (withDecimals) {
    const [, sign = '', intPart, decimals] = withDecimals;
    return `${sign}${stripLeadingZeros(intPart.replace(/\./g, ''))}.${decimals}`;
  }
  const thousands = THOUSANDS_ONLY.exec(value) ?? INTEGER.exec(value);
  if (thousands) {
    const [, sign = '', intPart] = thousands;
    return `${sign}${stripLeadingZeros(intPart.replace(/\./g, ''))}`;
  }
  throw new Error(`Número con formato inválido: "${raw}"`);
}

function stripLeadingZeros(digits: string): string {
  return digits.replace(/^0+(?=\d)/, '');
}

const DATE = /^(\d{2})\/(\d{2})\/(\d{4})$/;

/**
 * "12/11/2026" -> Date 2026-11-12T00:00:00.000Z.
 * Se arma en UTC a propósito: es una fecha calendario (columna `@db.Date`), sin hora ni zona,
 * así no se corre un día según dónde corra el servidor. Nunca usar `new Date(string)`.
 */
export function parseArgentineDate(raw: string): Date {
  const match = DATE.exec(raw.trim());
  if (!match) throw new Error(`Fecha con formato inválido: "${raw}" (se espera dd/mm/aaaa)`);
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`Fecha inexistente: "${raw}"`);
  }
  return date;
}

/** Date (fecha calendario en UTC) -> "dd/mm/aaaa", para mensajes al usuario. */
export function formatArgentineDate(date: Date): string {
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${date.getUTCFullYear()}`;
}
