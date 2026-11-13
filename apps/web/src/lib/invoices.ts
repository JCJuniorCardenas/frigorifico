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

// ---------- Tabla de control ----------

export type DueState = 'paid' | 'overdue' | 'due_soon' | 'ok';

export interface InvoiceListItem extends Invoice {
  due: { state: DueState; daysToDue: number | null };
}

export interface Totals {
  count: number;
  kg: string;
  amount: string;
}

export interface InvoiceListResponse {
  items: InvoiceListItem[];
  page: number;
  pageSize: number;
  totals: Totals;
  today: string;
}

export type StatusFilter = 'pending' | 'overdue' | 'paid' | 'all';
export type SortField =
  | 'clientName'
  | 'herdNumber'
  | 'slaughterKg'
  | 'totalAmount'
  | 'paymentDueDate'
  | 'issueDate'
  | 'voucherNumber'
  | 'status'
  | 'paidAt';

export interface InvoiceQuery {
  q?: string;
  status: StatusFilter;
  clientCuit?: string;
  dateField: 'issue' | 'due';
  from?: string;
  to?: string;
  sort?: SortField;
  dir?: 'asc' | 'desc';
  page: number;
  pageSize: number;
}

export interface SummaryBucket {
  count: number;
  amount: string;
}

export interface InvoiceSummary {
  today: string;
  pending: SummaryBucket;
  overdue: SummaryBucket;
  dueThisWeek: SummaryBucket;
  collectedThisMonth: SummaryBucket;
}

export interface ClientOption {
  clientCuit: string;
  clientName: string;
}

export interface InvoiceDetail extends InvoiceListItem {
  uploadedBy: string;
  paidBy: string | null;
  statusLogs: {
    fromStatus: 'PENDING' | 'PAID';
    toStatus: 'PENDING' | 'PAID';
    changedBy: string;
    changedAt: string;
  }[];
}

function toQueryString(query: InvoiceQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  return params.toString();
}

export const invoicesApi = {
  list: (query: InvoiceQuery) => apiFetch<InvoiceListResponse>(`/invoices?${toQueryString(query)}`),
  summary: () => apiFetch<InvoiceSummary>('/invoices/summary'),
  clients: () => apiFetch<ClientOption[]>('/invoices/clients'),
  detail: (id: string) => apiFetch<InvoiceDetail>(`/invoices/${id}`),
  setStatus: (id: string, status: 'PENDING' | 'PAID', paidAt?: string) =>
    apiFetch<InvoiceListItem>(`/invoices/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status, paidAt }),
    }),
  setStatusBulk: (ids: string[], status: 'PENDING' | 'PAID', paidAt?: string) =>
    apiFetch<{ items: InvoiceListItem[]; changed: number }>('/invoices/status/bulk', {
      method: 'POST',
      body: JSON.stringify({ ids, status, paidAt }),
    }),
  update: (id: string, data: Partial<InvoiceFields> & { needsReview?: boolean }) =>
    apiFetch<InvoiceListItem>(`/invoices/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  remove: (id: string) => apiFetch<void>(`/invoices/${id}`, { method: 'DELETE' }),
  pdfUrl: (id: string) => `/api/invoices/${id}/pdf`,
};
