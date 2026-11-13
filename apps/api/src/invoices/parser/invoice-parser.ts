/**
 * Lector de facturas ARCA: a partir del texto del PDF arma el borrador y corre las validaciones
 * cruzadas (CLAUDE.md §5 y §6). Si algo no cierra no se descarta: se agrega una advertencia y
 * `needsReview = true` para que el usuario lo revise antes de guardar.
 */
import { Decimal } from 'decimal.js';
import { formatArgentineDate, parseArgentineDecimal } from './argentine-format.js';
import { isValidCuit } from './cuit.js';
import { extractPageFields, PATTERNS } from './invoice-fields.js';
import {
  InvoiceParseError,
  type InvoiceParseResult,
  type ParsedInvoice,
  type ParseWarning,
} from './parsed-invoice.js';
import type { PdfText, TextLine } from './pdf-text.js';

export interface InvoiceParserOptions {
  /** CUIT del frigorífico (ISSUER_CUIT). Si se indica, se avisa cuando el PDF trae otro emisor. */
  issuerCuit?: string;
}

/** Cantidad de páginas que se leen: ORIGINAL, DUPLICADO y TRIPLICADO. */
export const PAGES_TO_READ = 3;

const VOUCHER_TYPES: Record<string, string> = {
  '01': 'Factura A',
  '02': 'Nota de Débito A',
  '03': 'Nota de Crédito A',
  '06': 'Factura B',
  '07': 'Nota de Débito B',
  '08': 'Nota de Crédito B',
  '11': 'Factura C',
  '12': 'Nota de Débito C',
  '13': 'Nota de Crédito C',
  '51': 'Factura M',
};

export function parseInvoiceText(
  pdf: PdfText,
  options: InvoiceParserOptions = {},
): InvoiceParseResult {
  const [firstPage, ...copies] = pdf.pages;
  if (!firstPage || firstPage.length === 0) {
    throw new InvoiceParseError(
      'NO_TEXT',
      'El PDF no tiene texto seleccionable (puede ser un escaneo). Solo se aceptan facturas ' +
        'electrónicas generadas por ARCA.',
    );
  }
  assertIsInvoiceA(firstPage);

  const { invoice, warnings, copyLabel, vatByRate } = extractPageFields(firstPage);

  if (pdf.pageCount !== PAGES_TO_READ) {
    warnings.push({
      code: 'UNEXPECTED_PAGES',
      message: `El PDF tiene ${pdf.pageCount} página(s); se esperaban 3 (original, duplicado y triplicado).`,
    });
  }
  if (copyLabel !== 'ORIGINAL') {
    warnings.push({
      code: 'UNEXPECTED_PAGES',
      message: 'La primera página no dice "ORIGINAL". Verificá que sea la factura correcta.',
    });
  }

  checkCopies(invoice, copies, warnings);
  checkTotals(invoice, vatByRate, warnings);
  checkHerdLines(invoice, warnings);
  checkCuits(invoice, options, warnings);
  checkDates(invoice, warnings);

  return { invoice, warnings, needsReview: warnings.length > 0 };
}

function assertIsInvoiceA(lines: TextLine[]): void {
  const text = lines.map((l) => l.text).join('\n');
  const code = PATTERNS.voucherCode.exec(text)?.[1];
  if (!code || !PATTERNS.voucher.test(text)) {
    throw new InvoiceParseError(
      'NOT_AN_INVOICE',
      'El PDF no parece ser un comprobante electrónico de ARCA (no se encontró el código de ' +
        'comprobante ni el punto de venta).',
    );
  }
  if (code !== '01' || !PATTERNS.invoiceTitle.test(text)) {
    const type = VOUCHER_TYPES[code] ?? `comprobante código ${code}`;
    throw new InvoiceParseError(
      'UNSUPPORTED_TYPE',
      `El PDF es una ${type}. Solo se aceptan Facturas A (código 01).`,
    );
  }
}

/** Duplicado y triplicado deben tener el mismo comprobante e importe total que el original. */
function checkCopies(invoice: ParsedInvoice, copies: TextLine[][], warnings: ParseWarning[]) {
  copies.forEach((lines, index) => {
    const text = lines.map((l) => l.text).join('\n');
    const voucher = PATTERNS.voucher.exec(text);
    const total = PATTERNS.total.exec(text)?.[1];
    const sameVoucher = voucher?.[2] === invoice.voucherNumber;
    let sameTotal = false;
    try {
      sameTotal =
        total !== undefined &&
        invoice.totalAmount !== null &&
        new Decimal(parseArgentineDecimal(total)).equals(invoice.totalAmount);
    } catch {
      sameTotal = false;
    }
    if (!sameVoucher || !sameTotal) {
      warnings.push({
        code: 'COPIES_MISMATCH',
        message: `La página ${index + 2} no coincide con el original (número de comprobante o importe total distinto).`,
      });
    }
  });
}

/** Neto gravado + IVA (todas las alícuotas) + exento + otros tributos = total. */
function checkTotals(
  invoice: ParsedInvoice,
  vatByRate: Map<string, string>,
  warnings: ParseWarning[],
) {
  const otherRates = [...vatByRate].filter(([rate, amount]) => rate !== '21' && !isZero(amount));
  if (otherRates.length > 0) {
    warnings.push({
      code: 'OTHER_VAT_RATES',
      field: 'vat21Amount',
      message: `La factura tiene IVA de otras alícuotas (${otherRates
        .map(([rate]) => `${rate}%`)
        .join(', ')}); el sistema solo guarda el IVA 21%.`,
    });
  }

  const { netTaxedAmount, exemptAmount, totalAmount, otherTaxesAmount } = invoice;
  if (netTaxedAmount === null || exemptAmount === null || totalAmount === null) return;
  const vatTotal = [...vatByRate.values()].reduce((acc, v) => acc.plus(v), new Decimal(0));
  const computed = new Decimal(netTaxedAmount)
    .plus(vatTotal)
    .plus(exemptAmount)
    .plus(otherTaxesAmount ?? 0);
  if (!computed.equals(totalAmount)) {
    warnings.push({
      code: 'TOTALS_MISMATCH',
      field: 'totalAmount',
      message: `Neto gravado + IVA + exento + otros tributos da $${computed.toFixed(2)}, pero el importe total es $${new Decimal(totalAmount).toFixed(2)}.`,
    });
  }
}

/** Una sola tropa por factura, y kg × precio unitario = subtotal en cada línea de faena. */
function checkHerdLines(invoice: ParsedInvoice, warnings: ParseWarning[]) {
  if (invoice.herdLines.length > 1) {
    warnings.push({
      code: 'MULTIPLE_HERDS',
      field: 'herdNumber',
      message: `La factura tiene ${invoice.herdLines.length} líneas de faena (tropas ${invoice.herdLines
        .map((h) => h.herdNumber)
        .join(', ')}). Se sumaron los kg y se tomó la primera tropa.`,
    });
  }
  for (const line of invoice.herdLines) {
    const computed = new Decimal(line.kg).times(line.unitPrice).toDecimalPlaces(2);
    if (!computed.equals(line.subtotal)) {
      warnings.push({
        code: 'HERD_SUBTOTAL_MISMATCH',
        field: 'slaughterKg',
        message: `Tropa ${line.herdNumber}: ${line.kg} kg × $${line.unitPrice} da $${computed.toFixed(2)}, pero el subtotal es $${line.subtotal}.`,
      });
    }
  }
}

function checkCuits(
  invoice: ParsedInvoice,
  options: InvoiceParserOptions,
  warnings: ParseWarning[],
) {
  if (invoice.clientCuit !== null && !isValidCuit(invoice.clientCuit)) {
    warnings.push({
      code: 'INVALID_CLIENT_CUIT',
      field: 'clientCuit',
      message: `El CUIT del cliente (${invoice.clientCuit}) no es válido.`,
    });
  }
  if (options.issuerCuit && invoice.issuerCuit !== options.issuerCuit) {
    warnings.push({
      code: 'ISSUER_CUIT_MISMATCH',
      message: `El CUIT del emisor (${invoice.issuerCuit ?? 'no encontrado'}) no es el del frigorífico (${options.issuerCuit}).`,
    });
  }
}

function checkDates(invoice: ParsedInvoice, warnings: ParseWarning[]) {
  const { issueDate, paymentDueDate } = invoice;
  if (issueDate && paymentDueDate && paymentDueDate < issueDate) {
    warnings.push({
      code: 'DUE_DATE_BEFORE_ISSUE',
      field: 'paymentDueDate',
      message: `La fecha de vencimiento (${formatArgentineDate(paymentDueDate)}) es anterior a la de emisión (${formatArgentineDate(issueDate)}).`,
    });
  }
}

function isZero(value: string): boolean {
  return new Decimal(value).isZero();
}
