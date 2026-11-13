import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import type { MovementType, ProductUnit } from '../generated/prisma/enums.js';
import { toIsoDate } from '../invoices/invoice.mapper.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { Decimal, type DecimalInput, nextAverageCost, roundMoney, stockValue } from './costing.js';

type Tx = Prisma.TransactionClient;

export interface StockRow {
  productId: string;
  name: string;
  category: string | null;
  unit: ProductUnit;
  active: boolean;
  /** Suma de los movimientos, 3 decimales. */
  kg: string;
  /** Costo promedio ponderado por kg, a centavos. */
  avgCost: string;
  /** kg × costo promedio (0 si el stock es negativo). */
  value: string;
  minStockKg: string | null;
  /** Stock por debajo del mínimo configurado (si hay uno). */
  lowStock: boolean;
}

export interface StockResponse {
  items: StockRow[];
  totals: { value: string; products: number; lowStock: number };
}

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

export interface SaleMovementInput {
  saleId: string;
  date: Date;
  userId: string;
  /** kg positivos (lo vendido); unitCost: costo promedio al momento de la venta. */
  items: { productId: string; kg: DecimalInput; unitCost: DecimalInput }[];
}

export interface PurchaseMovementInput {
  purchaseId: string;
  date: Date;
  userId: string;
  items: { productId: string; kg: string; costPerKg: string }[];
}

/**
 * Stock como libro de movimientos: nunca se guarda un "stock actual" editable, se suma.
 * Toda operación que mueve stock debe bloquear antes los productos (lockProducts) dentro de su
 * transacción, así dos cargas simultáneas no calculan el costo promedio sobre el mismo stock.
 */
@Injectable()
export class StockService {
  constructor(private readonly prisma: PrismaService) {}

  /** Bloquea las filas de los productos hasta el fin de la transacción (orden fijo: sin deadlocks). */
  async lockProducts(tx: Tx, productIds: string[]): Promise<void> {
    const ids = [...new Set(productIds)].sort();
    if (ids.length === 0) return;
    await tx.$queryRaw`SELECT id FROM "Product" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`;
  }

  /** kg en stock por producto = suma de sus movimientos. */
  async stockOf(tx: Tx | PrismaService, productIds?: string[]): Promise<Map<string, Decimal>> {
    const groups = await tx.stockMovement.groupBy({
      by: ['productId'],
      where: productIds ? { productId: { in: productIds } } : {},
      _sum: { kg: true },
    });
    return new Map(groups.map((g) => [g.productId, g._sum.kg ?? new Decimal(0)]));
  }

  /**
   * Registra los movimientos PURCHASE de un ingreso y recalcula el costo promedio de cada
   * producto. Debe llamarse con los productos ya bloqueados.
   */
  async recordPurchase(tx: Tx, input: PurchaseMovementInput): Promise<void> {
    await this.reweightAverageCost(
      tx,
      input.items.map((i) => ({ productId: i.productId, kg: i.kg, cost: i.costPerKg })),
    );
    await tx.stockMovement.createMany({
      data: input.items.map((item) => ({
        productId: item.productId,
        type: 'PURCHASE' as const,
        kg: item.kg,
        unitCost: item.costPerKg,
        refType: 'Purchase',
        refId: input.purchaseId,
        date: input.date,
        createdById: input.userId,
      })),
    });
  }

  /**
   * Movimientos SALE de una venta (kg negativos). Vender no cambia el costo promedio: sale
   * mercadería al costo promedio vigente, que queda guardado en `unitCost`.
   */
  async recordSale(tx: Tx, input: SaleMovementInput): Promise<void> {
    await tx.stockMovement.createMany({
      data: input.items.map((item) => ({
        productId: item.productId,
        type: 'SALE' as const,
        kg: new Decimal(item.kg).negated(),
        unitCost: item.unitCost,
        refType: 'Sale',
        refId: input.saleId,
        date: input.date,
        createdById: input.userId,
      })),
    });
  }

  /**
   * Anulación de una venta: movimientos SALE_VOID que devuelven exactamente los kg vendidos.
   * La mercadería vuelve al costo con que salió; si desde la venta entró mercadería a otro costo,
   * el promedio se repondera. Ítems sin costo (vendidos sin stock cargado) no lo modifican.
   */
  async recordSaleVoid(tx: Tx, input: SaleMovementInput & { reason: string }): Promise<void> {
    await this.reweightAverageCost(
      tx,
      input.items
        .filter((i) => new Decimal(i.unitCost).gt(0))
        .map((i) => ({ productId: i.productId, kg: i.kg, cost: i.unitCost })),
    );
    await tx.stockMovement.createMany({
      data: input.items.map((item) => ({
        productId: item.productId,
        type: 'SALE_VOID' as const,
        kg: item.kg,
        unitCost: item.unitCost,
        reason: input.reason,
        refType: 'Sale',
        refId: input.saleId,
        date: input.date,
        createdById: input.userId,
      })),
    });
  }

  /**
   * Recalcula el costo promedio por cada entrada de mercadería, en orden: si un producto aparece
   * dos veces, la segunda entrada pondera sobre la primera. Se llama antes de crear los
   * movimientos, con los productos ya bloqueados.
   */
  private async reweightAverageCost(
    tx: Tx,
    entries: { productId: string; kg: DecimalInput; cost: DecimalInput }[],
  ): Promise<void> {
    if (entries.length === 0) return;
    const productIds = [...new Set(entries.map((e) => e.productId))];
    const stock = await this.stockOf(tx, productIds);
    const products = await tx.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, avgCost: true },
    });
    const avgCost = new Map(products.map((p) => [p.id, p.avgCost]));
    for (const entry of entries) {
      const stockKg = stock.get(entry.productId) ?? new Decimal(0);
      avgCost.set(
        entry.productId,
        nextAverageCost({
          stockKg,
          avgCost: avgCost.get(entry.productId) ?? 0,
          kgIn: entry.kg,
          costIn: entry.cost,
        }),
      );
      stock.set(entry.productId, stockKg.plus(entry.kg));
    }
    for (const [id, cost] of avgCost) {
      await tx.product.update({ where: { id }, data: { avgCost: cost } });
    }
  }

  /** Stock actual: productos activos, más los inactivos que todavía tienen kilos. */
  async getStock(): Promise<StockResponse> {
    const [products, stock] = await Promise.all([
      this.prisma.product.findMany({ orderBy: { name: 'asc' } }),
      this.stockOf(this.prisma),
    ]);
    let total = new Decimal(0);
    let lowStock = 0;
    const items: StockRow[] = [];
    for (const p of products) {
      const kg = stock.get(p.id) ?? new Decimal(0);
      if (!p.active && kg.isZero()) continue;
      const value = stockValue(kg, p.avgCost);
      const low = p.minStockKg !== null && kg.lt(p.minStockKg);
      total = total.plus(value);
      if (low) lowStock++;
      items.push({
        productId: p.id,
        name: p.name,
        category: p.category,
        unit: p.unit,
        active: p.active,
        kg: kg.toFixed(3),
        avgCost: roundMoney(p.avgCost).toFixed(2),
        value: value.toFixed(2),
        minStockKg: p.minStockKg?.toFixed(3) ?? null,
        lowStock: low,
      });
    }
    return {
      items,
      totals: { value: total.toFixed(2), products: items.length, lowStock },
    };
  }

  /** Últimos movimientos de un producto (auditoría). */
  async movements(productId: string, limit = 100): Promise<MovementRow[]> {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('Producto no encontrado');
    const rows = await this.prisma.stockMovement.findMany({
      where: { productId },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: limit,
      include: { createdBy: { select: { name: true } } },
    });
    return rows.map((m) => ({
      id: m.id,
      type: m.type,
      date: toIsoDate(m.date),
      kg: m.kg.toFixed(3),
      unitCost: m.unitCost?.toFixed(2) ?? null,
      reason: m.reason,
      refType: m.refType,
      refId: m.refId,
      createdBy: m.createdBy.name,
      createdAt: m.createdAt.toISOString(),
    }));
  }
}
