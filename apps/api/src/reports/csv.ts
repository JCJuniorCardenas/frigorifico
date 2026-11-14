/**
 * Exportación a CSV pensada para abrir con doble clic en Excel configurado en español
 * (Argentina): separador ";", coma decimal, fechas dd/mm/aaaa y BOM UTF-8 para los acentos.
 */

export type CsvValue = string | number | null;

/** Columna: título y cómo formatear el valor. */
export interface CsvColumn<T> {
  header: string;
  value: (row: T) => CsvValue;
  kind?: 'text' | 'decimal' | 'date';
}

const BOM = '﻿';
const SEPARATOR = ';';

/** "1234.50" -> "1234,50"; sin separador de miles para que Excel lo tome como número. */
export function csvDecimal(value: string): string {
  return value.replace('.', ',');
}

/** "2026-11-13" -> "13/11/2026". */
export function csvDate(value: string): string {
  const [y, m, d] = value.split('-');
  return `${d}/${m}/${y}`;
}

function escape(value: string): string {
  // Evita que Excel interprete el texto como fórmula (inyección CSV).
  const safe = /^[=+\-@\t\r]/.test(value) && !/^-?\d/.test(value) ? `'${value}` : value;
  return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv<T>(columns: CsvColumn<T>[], rows: T[]): string {
  const lines = [columns.map((c) => escape(c.header)).join(SEPARATOR)];
  for (const row of rows) {
    lines.push(
      columns
        .map((c) => {
          const raw = c.value(row);
          if (raw === null || raw === '') return '';
          const text = String(raw);
          if (c.kind === 'decimal') return csvDecimal(text);
          if (c.kind === 'date') return csvDate(text);
          return escape(text);
        })
        .join(SEPARATOR),
    );
  }
  return BOM + lines.join('\r\n') + '\r\n';
}
