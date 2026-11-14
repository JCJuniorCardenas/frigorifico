import { ApiError, api } from './api';
import type { StockResponse } from './stock';
import type { PaymentMethod } from './sales';

/** Reportes del módulo de stock. Todos los cálculos los hace la API (Decimal). */

export interface Period {
  from: string;
  to: string;
}

export interface SalesReport {
  period: Period;
  totals: { count: number; kg: string; amount: string; averageTicket: string | null };
  byDay: { date: string; count: number; kg: string; amount: string }[];
  byProduct: { productId: string; name: string; kg: string; amount: string }[];
  byPaymentMethod: { method: PaymentMethod; count: number; amount: string }[];
}

export interface ProfitRow {
  productId: string;
  name: string;
  kg: string;
  revenue: string;
  cost: string;
  profit: string;
  marginPct: string | null;
}

export interface ProfitReport {
  period: Period;
  totals: Omit<ProfitRow, 'productId' | 'name'>;
  byProduct: ProfitRow[];
}

export interface WasteReport {
  period: Period;
  totals: { kg: string; value: string; purchasedKg: string; pctOfPurchased: string | null };
  byReason: { reason: string; count: number; kg: string; value: string }[];
  byProduct: {
    productId: string;
    name: string;
    kg: string;
    value: string;
    purchasedKg: string;
    pctOfPurchased: string | null;
  }[];
}

export interface PurchasesReport {
  period: Period;
  totals: { count: number; kg: string; amount: string };
  bySupplier: { supplierId: string; name: string; count: number; kg: string; amount: string }[];
  byProduct: { productId: string; name: string; kg: string; amount: string; averageCost: string }[];
}

export interface Bucket {
  count: number;
  amount: string;
}

export interface Dashboard {
  today: string;
  month: Period;
  salesToday: Bucket;
  salesMonth: Bucket;
  profitMonth: { profit: string; marginPct: string | null };
  stockValue: string;
  lowStockProducts: number;
  invoices: { pending: Bucket; overdue: Bucket };
}

export type ReportName = 'sales' | 'profit' | 'waste' | 'purchases' | 'stock';

/** Período elegido; vacío = mes actual (lo resuelve la API). */
export type PeriodQuery = Partial<Period>;

function query(period: PeriodQuery, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams(extra);
  if (period.from) params.set('from', period.from);
  if (period.to) params.set('to', period.to);
  return params.toString();
}

export const reportsApi = {
  dashboard: () => api.get<Dashboard>('/reports/dashboard'),
  sales: (p: PeriodQuery) => api.get<SalesReport>(`/reports/sales?${query(p)}`),
  profit: (p: PeriodQuery) => api.get<ProfitReport>(`/reports/profit?${query(p)}`),
  waste: (p: PeriodQuery) => api.get<WasteReport>(`/reports/waste?${query(p)}`),
  purchases: (p: PeriodQuery) => api.get<PurchasesReport>(`/reports/purchases?${query(p)}`),
  stock: () => api.get<StockResponse>('/reports/stock'),
};

/**
 * Descarga una tabla de un reporte como CSV (para Excel). Va por fetch y no por un link para
 * poder renovar la sesión si venció, igual que el resto de las llamadas.
 */
export async function downloadCsv(
  report: ReportName,
  section: string,
  period: PeriodQuery,
): Promise<void> {
  const url = `/api/reports/${report}?${query(period, { format: 'csv', section })}`;
  let res = await fetch(url);
  if (res.status === 401 && (await fetch('/api/auth/refresh', { method: 'POST' })).ok) {
    res = await fetch(url);
  }
  if (!res.ok) throw new ApiError(res.status, 'No se pudo descargar el CSV');
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? `${report}.csv`;
  const href = URL.createObjectURL(await res.blob());
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(href);
}

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/** Atajos de período a partir de "hoy" (aaaa-mm-dd en Argentina). */
export function presetPeriod(
  preset: 'today' | 'week' | 'month' | 'lastMonth',
  today: string,
): Period {
  const [y, m, d] = today.split('-').map(Number);
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'week':
      return { from: iso(new Date(Date.UTC(y, m - 1, d - 6))), to: today };
    case 'month':
      return { from: iso(new Date(Date.UTC(y, m - 1, 1))), to: iso(new Date(Date.UTC(y, m, 0))) };
    case 'lastMonth':
      return {
        from: iso(new Date(Date.UTC(y, m - 2, 1))),
        to: iso(new Date(Date.UTC(y, m - 1, 0))),
      };
  }
}

/** "43.91" -> "43,91 %". */
export function formatPct(value: string | null): string {
  return value === null ? '—' : `${value.replace('.', ',')} %`;
}
