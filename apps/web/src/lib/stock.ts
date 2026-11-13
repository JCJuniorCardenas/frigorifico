import { api } from './api';
import type { ProductUnit } from './catalog';

/** Stock e ingresos de mercadería. Decimales como string con punto, nunca number. */

export interface StockRow {
  productId: string;
  name: string;
  category: string | null;
  unit: ProductUnit;
  active: boolean;
  kg: string;
  avgCost: string;
  value: string;
  minStockKg: string | null;
  lowStock: boolean;
}

export interface StockResponse {
  items: StockRow[];
  totals: { value: string; products: number; lowStock: number };
}

export type MovementType = 'PURCHASE' | 'SALE' | 'WASTE' | 'ADJUSTMENT' | 'SALE_VOID';

export const MOVEMENT_LABELS: Record<MovementType, string> = {
  PURCHASE: 'Ingreso',
  SALE: 'Venta',
  WASTE: 'Merma',
  ADJUSTMENT: 'Ajuste',
  SALE_VOID: 'Venta anulada',
};

export interface MovementRow {
  id: string;
  type: MovementType;
  date: string;
  kg: string;
  unitCost: string | null;
  reason: string | null;
  refType: string | null;
  refId: string | null;
  createdBy: string;
  createdAt: string;
}

export interface PurchaseSummary {
  id: string;
  date: string;
  supplier: { id: string; name: string };
  herdNumber: string | null;
  notes: string | null;
  itemCount: number;
  totalKg: string;
  totalCost: string;
  createdBy: string;
  createdAt: string;
}

export interface PurchaseDetail extends PurchaseSummary {
  items: {
    id: string;
    productId: string;
    productName: string;
    kg: string;
    costPerKg: string;
    totalCost: string;
  }[];
}

export interface PurchaseListResponse {
  items: PurchaseSummary[];
  total: number;
  page: number;
  pageSize: number;
  totals: { kg: string; cost: string };
}

export interface PurchaseQuery {
  from?: string;
  to?: string;
  supplierId?: string;
  herdNumber?: string;
  page?: number;
  pageSize?: number;
}

export interface PurchaseInput {
  date: string;
  supplierId: string;
  herdNumber: string | null;
  notes: string | null;
  items: { productId: string; kg: string; costPerKg: string }[];
}

function toQuery(query: PurchaseQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  return params.toString();
}

export const stockApi = {
  stock: () => api.get<StockResponse>('/stock'),
  movements: (productId: string) => api.get<MovementRow[]>(`/stock/${productId}/movements`),
  purchases: (query: PurchaseQuery) =>
    api.get<PurchaseListResponse>(`/purchases?${toQuery(query)}`),
  purchase: (id: string) => api.get<PurchaseDetail>(`/purchases/${id}`),
  createPurchase: (data: PurchaseInput) => api.post<PurchaseDetail>('/purchases', data),
};

/** Fecha de hoy en Argentina como "aaaa-mm-dd". */
export function todayInArgentina(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** "12.345" -> 12345n en la escala pedida (milésimas para kg, centavos para pesos). */
function toScaled(decimal: string, scale: number): bigint {
  const [intPart, decPart = ''] = decimal.split('.');
  return BigInt(intPart + decPart.padEnd(scale, '0').slice(0, scale));
}

function fromScaled(value: bigint, scale: number): string {
  const digits = value.toString().padStart(scale + 1, '0');
  return `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
}

/**
 * kg × precio por kg, redondeado a centavos (mitad hacia arriba), igual que la API.
 * Exacto con BigInt: 12.345 × 1000.99 = "12357.22". Solo valores no negativos.
 */
export function lineTotal(kg: string, pricePerKg: string): string {
  const product = toScaled(kg, 3) * toScaled(pricePerKg, 2); // escala 10^-5
  return fromScaled((product + 500n) / 1000n, 2);
}

/** Suma de decimales con la misma escala (3 para kg, 2 para pesos). */
export function sumDecimals(values: string[], scale: number): string {
  return fromScaled(
    values.reduce((acc, v) => acc + toScaled(v, scale), 0n),
    scale,
  );
}
