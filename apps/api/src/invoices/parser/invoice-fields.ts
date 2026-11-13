/**
 * Extracción de campos de una factura ARCA a partir de las líneas de texto de UNA página.
 * Cada campo tiene su regex; si no aparece o no se puede convertir, queda en null con una advertencia.
 */
import { Decimal } from 'decimal.js';
import { parseArgentineDate, parseArgentineDecimal } from './argentine-format.js';
import { normalizeCuit } from './cuit.js';
import type { HerdLine, ParsedInvoice, ParseWarning } from './parsed-invoice.js';
import type { TextLine } from './pdf-text.js';

const NUM = String.raw`-?[\d.]+(?:,\d+)?`;
const DATE = String.raw`\d{2}/\d{2}/\d{4}`;

export const PATTERNS = {
  voucherCode: /\bCOD\.\s*(\d{2,3})\b/i,
  invoiceTitle: /\bFACTURA\b/i,
  copyLabel: /\b(ORIGINAL|DUPLICADO|TRIPLICADO)\b/i,
  voucher: /Punto\s+de\s+Venta:\s*(\d{4,5})\s+Comp\.\s*Nro:\s*(\d{8})/i,
  issueDate: new RegExp(String.raw`Fecha\s+de\s+Emisi[óo]n:\s*(${DATE})`, 'i'),
  paymentDueDate: new RegExp(String.raw`Fecha\s+de\s+Vto\.\s+para\s+el\s+pago:\s*(${DATE})`, 'i'),
  cuit: /CUIT:\s*(\d{2}-?\d{8}-?\d)\b/gi,
  clientName: /Apellido\s+y\s+Nombre\s*\/\s*Raz[óo]n\s+Social:\s*(.+)$/i,
  herdLine: new RegExp(
    String.raw`Servicio\s+(?:de\s+)?faena\s+tropa\s+(?:N[°º]?\s*)?(\d+)\s+(${NUM})\s+kg\s+(${NUM})\s+(${NUM})\s+(${NUM})`,
    'i',
  ),
  total: new RegExp(String.raw`Importe\s+Total:\s*\$\s*(${NUM})`, 'i'),
  netTaxed: new RegExp(String.raw`Importe\s+Neto\s+Gravado:\s*\$\s*(${NUM})`, 'i'),
  exempt: new RegExp(String.raw`Importe\s+Exento:\s*\$\s*(${NUM})`, 'i'),
  otherTaxes: new RegExp(String.raw`Importe\s+Otros\s+Tributos:\s*\$\s*(${NUM})`, 'gi'),
  vatRate: new RegExp(String.raw`IVA\s+(\d+(?:[.,]\d+)?)%:\s*\$\s*(${NUM})`, 'gi'),
  cae: /CAE\s+N[°º]:\s*(\d{14})\b/i,
  caeDueDate: new RegExp(String.raw`Fecha\s+de\s+Vto\.\s+de\s+CAE:\s*(${DATE})`, 'i'),
};

export interface PageFields {
  invoice: ParsedInvoice;
  warnings: ParseWarning[];
  /** "ORIGINAL", "DUPLICADO", "TRIPLICADO" o null. */
  copyLabel: string | null;
  /** Montos de IVA por alícuota ("21" -> "73233.30"). */
  vatByRate: Map<string, string>;
}

export function extractPageFields(lines: TextLine[]): PageFields {
  const warnings: ParseWarning[] = [];
  const texts = lines.map((l) => l.text);
  const fullText = texts.join('\n');

  const firstMatch = (re: RegExp): RegExpExecArray | null => {
    for (const text of texts) {
      const m = re.exec(text);
      if (m) return m;
    }
    return null;
  };

  const missing = (field: keyof ParsedInvoice, label: string) =>
    warnings.push({ code: 'FIELD_MISSING', field, message: `No se encontró ${label} en el PDF.` });

  const decimalField = (re: RegExp, field: keyof ParsedInvoice, label: string): string | null => {
    const m = firstMatch(re);
    if (!m) {
      missing(field, label);
      return null;
    }
    return toDecimal(m[1], field, label, warnings);
  };

  const dateField = (re: RegExp, field: keyof ParsedInvoice, label: string): Date | null => {
    const m = firstMatch(re);
    if (!m) {
      missing(field, label);
      return null;
    }
    try {
      return parseArgentineDate(m[1]);
    } catch {
      warnings.push({ code: 'FIELD_INVALID', field, message: `${label} inválida: "${m[1]}".` });
      return null;
    }
  };

  // Comprobante
  const voucher = firstMatch(PATTERNS.voucher);
  if (!voucher) missing('voucherNumber', 'el punto de venta y número de comprobante');
  const salesPoint = voucher ? voucher[1].padStart(5, '0') : null;
  const voucherNumber = voucher ? voucher[2] : null;

  // CUITs: el primero es el del emisor; el del cliente es el que está en la línea de su razón social.
  const cuits = [...fullText.matchAll(PATTERNS.cuit)].map((m) => normalizeCuit(m[1]));
  const clientLine = lines.find((l) => PATTERNS.clientName.test(l.text));
  const clientLineCuit = clientLine
    ? [...clientLine.text.matchAll(PATTERNS.cuit)].map((m) => normalizeCuit(m[1]))[0]
    : undefined;
  const issuerCuit = cuits[0] ?? null;
  const clientCuit = clientLineCuit ?? cuits[1] ?? null;
  if (!clientCuit) missing('clientCuit', 'el CUIT del cliente');

  let clientName: string | null = null;
  if (clientLine) {
    clientName = PATTERNS.clientName.exec(clientLine.text)?.[1].trim() || null;
  }
  if (!clientName) missing('clientName', 'la razón social del cliente');

  // Líneas de faena (puede haber más de una: se avisa en las validaciones).
  const herdLines: HerdLine[] = [];
  for (const text of texts) {
    const m = PATTERNS.herdLine.exec(text);
    if (!m) continue;
    const kg = toDecimal(m[2], 'slaughterKg', 'los kg de faena', warnings);
    const unitPrice = toDecimal(m[3], 'slaughterKg', 'el precio unitario de faena', warnings);
    const subtotal = toDecimal(m[5], 'slaughterKg', 'el subtotal de faena', warnings);
    if (kg && unitPrice && subtotal) herdLines.push({ herdNumber: m[1], kg, unitPrice, subtotal });
  }
  if (herdLines.length === 0) {
    missing('herdNumber', 'la línea "Servicio faena tropa" (número de tropa y kg)');
  }

  // IVA por alícuota
  const vatByRate = new Map<string, string>();
  for (const m of fullText.matchAll(PATTERNS.vatRate)) {
    const rate = m[1].replace(',', '.');
    const amount = toDecimal(m[2], 'vat21Amount', `el IVA ${rate}%`, warnings);
    if (amount !== null) vatByRate.set(rate, amount);
  }
  const vat21Amount = vatByRate.get('21') ?? null;
  if (vat21Amount === null) missing('vat21Amount', 'el importe de IVA 21%');

  // "Importe Otros Tributos" aparece dos veces (recuadro de tributos y bloque de totales);
  // se toma el último, que es el del bloque de totales.
  const otherTaxesMatches = [...fullText.matchAll(PATTERNS.otherTaxes)];
  const otherTaxesRaw = otherTaxesMatches.at(-1)?.[1];
  const otherTaxesAmount =
    otherTaxesRaw !== undefined
      ? toDecimal(otherTaxesRaw, 'otherTaxesAmount', 'el importe de otros tributos', warnings)
      : '0';

  const copyLabel = firstMatch(PATTERNS.copyLabel)?.[1].toUpperCase() ?? null;

  const invoice: ParsedInvoice = {
    salesPoint,
    voucherNumber,
    issueDate: dateField(PATTERNS.issueDate, 'issueDate', 'Fecha de emisión'),
    paymentDueDate: dateField(
      PATTERNS.paymentDueDate,
      'paymentDueDate',
      'Fecha de vencimiento para el pago',
    ),
    clientName,
    clientCuit,
    herdNumber: herdLines[0]?.herdNumber ?? null,
    slaughterKg: herdLines.length > 0 ? sumDecimals(herdLines.map((h) => h.kg)) : null,
    totalAmount: decimalField(PATTERNS.total, 'totalAmount', 'el importe total'),
    netTaxedAmount: decimalField(PATTERNS.netTaxed, 'netTaxedAmount', 'el importe neto gravado'),
    vat21Amount,
    exemptAmount: decimalField(PATTERNS.exempt, 'exemptAmount', 'el importe exento'),
    cae: firstMatch(PATTERNS.cae)?.[1] ?? null,
    caeDueDate: dateField(PATTERNS.caeDueDate, 'caeDueDate', 'Fecha de vencimiento del CAE'),
    issuerCuit,
    otherTaxesAmount,
    herdLines,
  };
  if (!invoice.cae) missing('cae', 'el número de CAE');

  return { invoice, warnings, copyLabel, vatByRate };
}

function toDecimal(
  raw: string,
  field: keyof ParsedInvoice,
  label: string,
  warnings: ParseWarning[],
): string | null {
  try {
    return parseArgentineDecimal(raw);
  } catch {
    warnings.push({ code: 'FIELD_INVALID', field, message: `No se pudo leer ${label}: "${raw}".` });
    return null;
  }
}

/** Suma exacta de decimales en string (decimal.js, sin pasar por float). Conserva la mayor escala. */
export function sumDecimals(values: string[]): string {
  const scale = Math.max(0, ...values.map((v) => v.split('.')[1]?.length ?? 0));
  return values.reduce((acc, v) => acc.plus(v), new Decimal(0)).toFixed(scale);
}
