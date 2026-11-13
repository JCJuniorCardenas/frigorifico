/** Helpers de validación compartidos por los DTOs del catálogo. */

export const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Texto opcional: "" o solo espacios se guarda como null (permite borrar el dato). */
export const trimToNull = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

/** CUIT opcional: quita guiones y espacios; vacío -> null. */
export const cuitOrNull = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const digits = value.replace(/[\s-]/g, '');
  return digits === '' ? null : digits;
};

/** Importe no negativo con hasta 2 decimales, como string con punto ("4500.50"). Nunca number. */
export const MONEY = /^\d{1,12}(\.\d{1,2})?$/;
/** Kilos no negativos con hasta 3 decimales ("12.345"). */
export const KG = /^\d{1,9}(\.\d{1,3})?$/;
