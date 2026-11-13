import { api } from './api';

/** Ventas de mostrador. Decimales como string con punto, nunca number. */

export type PaymentMethod = 'CASH' | 'TRANSFER' | 'CARD' | 'OTHER';

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  CASH: 'Efectivo',
  TRANSFER: 'Transferencia',
  CARD: 'Tarjeta',
  OTHER: 'Otro',
};

export const PAYMENT_METHODS = Object.keys(PAYMENT_LABELS) as PaymentMethod[];

export interface SaleSummary {
  id: string;
  date: string;
  customerName: string | null;
  paymentMethod: PaymentMethod;
  total: string;
  totalKg: string;
  itemCount: number;
  notes: string | null;
  createdBy: string;
  createdAt: string;
  voided: boolean;
  voidedAt: string | null;
  voidedBy: string | null;
  voidReason: string | null;
}

export interface SaleDetail extends SaleSummary {
  items: {
    id: string;
    productId: string;
    productName: string;
    kg: string;
    pricePerKg: string;
    subtotal: string;
    unitCost: string;
  }[];
}

export interface SaleListResponse {
  items: SaleSummary[];
  total: number;
  page: number;
  pageSize: number;
  /** Solo ventas no anuladas. */
  totals: { count: number; amount: string; kg: string };
}

export type SaleStatusFilter = 'active' | 'voided' | 'all';

export interface SaleQuery {
  from?: string;
  to?: string;
  paymentMethod?: PaymentMethod | '';
  status?: SaleStatusFilter;
  page?: number;
  pageSize?: number;
}

export interface SaleInput {
  customerName: string | null;
  paymentMethod: PaymentMethod;
  items: { productId: string; kg: string; pricePerKg: string }[];
  confirmNegativeStock?: boolean;
}

/** Detalle del 409 NEGATIVE_STOCK: productos que quedarían con stock negativo. */
export interface NegativeStockItem {
  productId: string;
  name: string;
  stockKg: string;
  requestedKg: string;
  resultingKg: string;
}

function toQuery(query: SaleQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  return params.toString();
}

export const salesApi = {
  list: (query: SaleQuery) => api.get<SaleListResponse>(`/sales?${toQuery(query)}`),
  detail: (id: string) => api.get<SaleDetail>(`/sales/${id}`),
  create: (data: SaleInput) => api.post<SaleDetail>('/sales', data),
  void: (id: string, reason: string) => api.post<SaleDetail>(`/sales/${id}/void`, { reason }),
};

/** Hora local de Argentina de un timestamp ISO: "14:05". */
export function formatTime(iso: string): string {
  return new Intl.DateTimeFormat('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(new Date(iso));
}

/** Fecha y hora de Argentina de un timestamp ISO: "13/11/2026 14:05". */
export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(new Date(iso));
}
