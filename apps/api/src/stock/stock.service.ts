import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import type { MovementType, ProductUnit } from '../generated/prisma/enums.js';
import { toIsoDate } from '../invoices/invoice.mapper.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { Decimal, nextAverageCost, roundMoney, stockValue } from './costing.js';

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
    const productIds = input.items.map((i) => i.productId);
    const stock = await this.stockOf(tx, productIds);
    const products = await tx.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, avgCost: true },
    });
    const avgCost = new Map(products.map((p) => [p.id, p.avgCost]));

    // Ítems en orden: si un producto aparece dos veces, el segundo pondera sobre el primero.
    for (const item of input.items) {
      const stockKg = stock.get(item.productId) ?? new Decimal(0);
      const newAvg = nextAverageCost({
        stockKg,
        avgCost: avgCost.get(item.productId) ?? 0,
        kgIn: item.kg,
        costIn: item.costPerKg,
      });
      stock.set(item.productId, stockKg.plus(item.kg));
      avgCost.set(item.productId, newAvg);
    }

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
    for (const [id, cost] of avgCost) {
      if (productIds.includes(id)) {
        await tx.product.update({ where: { id }, data: { avgCost: cost } });
      }
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
