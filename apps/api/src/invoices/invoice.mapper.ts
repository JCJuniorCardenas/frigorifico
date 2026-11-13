import type { Invoice } from '../generated/prisma/client.js';
import { type DueInfo, dueInfo } from './due-dates.js';
import type { ParsedInvoice } from './parser/parsed-invoice.js';

/** Date (fecha calendario en UTC) -> "aaaa-mm-dd". */
export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** "aaaa-mm-dd" -> Date en UTC; null si la fecha no existe (ej. 2026-02-31). */
export function fromIsoDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? date
    : null;
}

/** Borrador editable que se manda al frontend (fechas aaaa-mm-dd, importes como string). */
export interface InvoiceDraft {
  salesPoint: string | null;
  voucherNumber: string | null;
  issueDate: string | null;
  paymentDueDate: string | null;
  clientName: string | null;
  clientCuit: string | null;
  herdNumber: string | null;
  slaughterKg: string | null;
  totalAmount: string | null;
  netTaxedAmount: string | null;
  vat21Amount: string | null;
  exemptAmount: string | null;
  cae: string | null;
  caeDueDate: string | null;
}

export function toDraft(parsed: ParsedInvoice): InvoiceDraft {
  const date = (d: Date | null) => (d ? toIsoDate(d) : null);
  return {
    salesPoint: parsed.salesPoint,
    voucherNumber: parsed.voucherNumber,
    issueDate: date(parsed.issueDate),
    paymentDueDate: date(parsed.paymentDueDate),
    clientName: parsed.clientName,
    clientCuit: parsed.clientCuit,
    herdNumber: parsed.herdNumber,
    slaughterKg: parsed.slaughterKg,
    totalAmount: parsed.totalAmount,
    netTaxedAmount: parsed.netTaxedAmount,
    vat21Amount: parsed.vat21Amount,
    exemptAmount: parsed.exemptAmount,
    cae: parsed.cae,
    caeDueDate: date(parsed.caeDueDate),
  };
}

/** Factura tal como la devuelve la API. */
export interface InvoiceResponse {
  id: string;
  salesPoint: string;
  voucherNumber: string;
  issueDate: string;
  paymentDueDate: string;
  clientName: string;
  clientCuit: string;
  herdNumber: string;
  slaughterKg: string;
  totalAmount: string;
  netTaxedAmount: string;
  vat21Amount: string;
  exemptAmount: string;
  cae: string;
  caeDueDate: string;
  status: Invoice['status'];
  paidAt: string | null;
  needsReview: boolean;
  createdAt: string;
  updatedAt: string;
}

export function toInvoiceResponse(invoice: Invoice): InvoiceResponse {
  return {
    id: invoice.id,
    salesPoint: invoice.salesPoint,
    voucherNumber: invoice.voucherNumber,
    issueDate: toIsoDate(invoice.issueDate),
    paymentDueDate: toIsoDate(invoice.paymentDueDate),
    clientName: invoice.clientName,
    clientCuit: invoice.clientCuit,
    herdNumber: invoice.herdNumber,
    slaughterKg: invoice.slaughterKg.toFixed(2),
    totalAmount: invoice.totalAmount.toFixed(2),
    netTaxedAmount: invoice.netTaxedAmount.toFixed(2),
    vat21Amount: invoice.vat21Amount.toFixed(2),
    exemptAmount: invoice.exemptAmount.toFixed(2),
    cae: invoice.cae,
    caeDueDate: toIsoDate(invoice.caeDueDate),
    status: invoice.status,
    paidAt: invoice.paidAt ? toIsoDate(invoice.paidAt) : null,
    needsReview: invoice.needsReview,
    createdAt: invoice.createdAt.toISOString(),
    updatedAt: invoice.updatedAt.toISOString(),
  };
}

/** Fila de la tabla de control: la factura más su estado de vencimiento calculado hoy. */
export interface InvoiceListItem extends InvoiceResponse {
  due: DueInfo;
}

export function toListItem(invoice: Invoice, today: Date): InvoiceListItem {
  return { ...toInvoiceResponse(invoice), due: dueInfo(invoice, today) };
}
