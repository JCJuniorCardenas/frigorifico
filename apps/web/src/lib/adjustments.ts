import { api } from './api';
import { inputToDecimal } from './format';

/** Mermas y ajustes de stock. Decimales como string con punto, nunca number. */

export type AdjustmentType = 'WASTE' | 'ADJUSTMENT';

export const ADJUSTMENT_LABELS: Record<AdjustmentType, string> = {
  WASTE: 'Merma',
  ADJUSTMENT: 'Ajuste',
};

/** Motivos frecuentes (se pueden escribir otros). */
export const REASON_SUGGESTIONS: Record<AdjustmentType, string[]> = {
  WASTE: ['Vencimiento', 'Recorte / limpieza', 'Deshidratación', 'Rotura de cadena de frío'],
  ADJUSTMENT: ['Conteo físico', 'Error de carga', 'Diferencia de balanza'],
};

export interface AdjustmentRow {
  id: string;
  date: string;
  type: AdjustmentType;
  productId: string;
  productName: string;
  kg: string;
  unitCost: string;
  value: string;
  reason: string;
  createdBy: string;
  createdAt: string;
}

export interface AdjustmentResult extends AdjustmentRow {
  stockBefore: string;
  stockAfter: string;
}

export interface AdjustmentListResponse {
  items: AdjustmentRow[];
  total: number;
  page: number;
  pageSize: number;
  totals: { wasteKg: string; wasteValue: string; adjustmentKg: string; adjustmentValue: string };
}

export interface AdjustmentQuery {
  from?: string;
  to?: string;
  productId?: string;
  type?: AdjustmentType | '';
  page?: number;
  pageSize?: number;
}

export interface AdjustmentInput {
  productId: string;
  type: AdjustmentType;
  kg?: string;
  countedKg?: string;
  reason: string;
  confirmNegativeStock?: boolean;
}

function toQuery(query: AdjustmentQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  return params.toString();
}

export const adjustmentsApi = {
  list: (query: AdjustmentQuery) =>
    api.get<AdjustmentListResponse>(`/stock/adjustments?${toQuery(query)}`),
  create: (data: AdjustmentInput) => api.post<AdjustmentResult>('/stock/adjustments', data),
};

/**
 * Kilos con signo escritos por el usuario -> decimal para la API, o null si no es válido.
 * "-1,5" -> "-1.5", "+2" -> "2", "0,750" -> "0.750". Hasta 3 decimales.
 */
export function signedKgToDecimal(raw: string): string | null {
  const value = raw.trim().replace(/\s/g, '');
  const sign = value.startsWith('-') ? '-' : '';
  const unsigned = inputToDecimal(value.replace(/^[+-]/, ''), 3);
  return unsigned === null ? null : `${sign}${unsigned}`;
}

/** Suma exacta de kg con signo (3 decimales): stock + diferencia. */
export function addKg(a: string, b: string): string {
  const toMilli = (v: string) => {
    const negative = v.startsWith('-');
    const [i, d = ''] = v.replace(/^[+-]/, '').split('.');
    const n = BigInt(i + d.padEnd(3, '0').slice(0, 3));
    return negative ? -n : n;
  };
  const sum = toMilli(a) + toMilli(b);
  const abs = (sum < 0n ? -sum : sum).toString().padStart(4, '0');
  return `${sum < 0n ? '-' : ''}${abs.slice(0, -3)}.${abs.slice(-3)}`;
}

/** Cambia el signo de un decimal string: "1.5" -> "-1.5", "-2" -> "2". */
export function negateKg(value: string): string {
  return value.startsWith('-') ? value.slice(1) : `-${value}`;
}
