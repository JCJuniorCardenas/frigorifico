import { apiFetch } from './api';

/** Campos editables de una factura. Fechas "aaaa-mm-dd"; importes decimal string con punto. */
export interface InvoiceFields {
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
}

export type InvoiceField = keyof InvoiceFields;

/** Borrador que devuelve el lector: un campo puede venir vacío si no se encontró. */
export type InvoiceDraft = { [K in InvoiceField]: string | null };

export interface ParseWarning {
  code: string;
  message: string;
  field?: string;
}

export interface ParseResponse {
  draft: InvoiceDraft;
  warnings: ParseWarning[];
  needsReview: boolean;
  fileHash: string;
}

export interface Invoice extends InvoiceFields {
  id: string;
  status: 'PENDING' | 'PAID';
  paidAt: string | null;
  needsReview: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Datos de la factura ya cargada cuando la API responde 409. */
export interface DuplicateInfo {
  id: string;
  reason: 'SAME_FILE' | 'SAME_VOUCHER';
  salesPoint: string;
  voucherNumber: string;
  clientName: string;
}

function pdfForm(file: File, data?: InvoiceFields): FormData {
  const form = new FormData();
  if (data) form.append('data', JSON.stringify(data));
  form.append('file', file);
  return form;
}

export function parseInvoicePdf(file: File): Promise<ParseResponse> {
  return apiFetch<ParseResponse>('/invoices/parse', { method: 'POST', body: pdfForm(file) });
}

export function createInvoice(file: File, data: InvoiceFields): Promise<Invoice> {
  return apiFetch<Invoice>('/invoices', { method: 'POST', body: pdfForm(file, data) });
}

export const FIELD_LABELS: Record<InvoiceField, string> = {
  salesPoint: 'Punto de venta',
  voucherNumber: 'N° de comprobante',
  issueDate: 'Fecha de emisión',
  paymentDueDate: 'Vencimiento de pago',
  clientName: 'Cliente (razón social)',
  clientCuit: 'CUIT del cliente',
  herdNumber: 'N° de tropa',
  slaughterKg: 'Kg de faena',
  totalAmount: 'Importe total',
  netTaxedAmount: 'Neto gravado',
  vat21Amount: 'IVA 21%',
  exemptAmount: 'Importe exento',
  cae: 'CAE',
  caeDueDate: 'Vencimiento del CAE',
};

/** Advertencias del lector que apuntan a campos que no son del formulario. */
const WARNING_FIELD_ALIASES: Record<string, InvoiceField> = {
  otherTaxesAmount: 'totalAmount',
};

export function warningField(warning: ParseWarning): InvoiceField | undefined {
  if (!warning.field) return undefined;
  if (warning.field in FIELD_LABELS) return warning.field as InvoiceField;
  return WARNING_FIELD_ALIASES[warning.field];
}
