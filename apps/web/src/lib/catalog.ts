import { api } from './api';

/** Catálogo del módulo de stock. Los decimales viajan como string con punto, nunca number. */

export type ProductUnit = 'KG' | 'UNIT';

export interface Product {
  id: string;
  name: string;
  category: string | null;
  unit: ProductUnit;
  /** Precio sugerido por kg (o por unidad), "8500.00". */
  salePrice: string | null;
  /** Umbral opcional de stock bajo, "10.000". */
  minStockKg: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Supplier {
  id: string;
  name: string;
  cuit: string | null;
  phone: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProductInput {
  name?: string;
  category?: string | null;
  unit?: ProductUnit;
  salePrice?: string | null;
  minStockKg?: string | null;
  active?: boolean;
}

export interface SupplierInput {
  name?: string;
  cuit?: string | null;
  phone?: string | null;
  active?: boolean;
}

export const UNIT_LABELS: Record<ProductUnit, string> = { KG: 'Por kg', UNIT: 'Por unidad' };

/** "30714542431" -> "30-71454243-1". */
export function formatCuit(cuit: string): string {
  return /^\d{11}$/.test(cuit)
    ? `${cuit.slice(0, 2)}-${cuit.slice(2, 10)}-${cuit.slice(10)}`
    : cuit;
}

const query = (activeOnly: boolean) => (activeOnly ? '?active=true' : '');

export const catalogApi = {
  products: (activeOnly = false) => api.get<Product[]>(`/products${query(activeOnly)}`),
  createProduct: (data: ProductInput) => api.post<Product>('/products', data),
  updateProduct: (id: string, data: ProductInput) => api.patch<Product>(`/products/${id}`, data),
  deleteProduct: (id: string) => api.delete(`/products/${id}`),

  suppliers: (activeOnly = false) => api.get<Supplier[]>(`/suppliers${query(activeOnly)}`),
  createSupplier: (data: SupplierInput) => api.post<Supplier>('/suppliers', data),
  updateSupplier: (id: string, data: SupplierInput) =>
    api.patch<Supplier>(`/suppliers/${id}`, data),
  deleteSupplier: (id: string) => api.delete(`/suppliers/${id}`),
};
