const WEIGHTS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];

/** Quita guiones y espacios: "30-71454243-1" -> "30714542431". */
export function normalizeCuit(raw: string): string {
  return raw.replace(/[\s-]/g, '');
}

/** Valida un CUIT/CUIL: 11 dígitos y dígito verificador (módulo 11). */
export function isValidCuit(raw: string): boolean {
  const cuit = normalizeCuit(raw);
  if (!/^\d{11}$/.test(cuit)) return false;
  const digits = cuit.split('').map(Number);
  const sum = WEIGHTS.reduce((acc, weight, i) => acc + weight * digits[i], 0);
  const remainder = 11 - (sum % 11);
  const expected = remainder === 11 ? 0 : remainder;
  // Un resultado de 10 no es un dígito válido: ese CUIT no puede existir.
  return expected !== 10 && expected === digits[10];
}
