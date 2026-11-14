import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import type { PaymentMethod } from '../generated/prisma/enums.js';
import { monthRange, todayInArgentina } from '../invoices/due-dates.js';
import { InvoiceQueryService, type SummaryBucket } from '../invoices/invoice-query.service.js';
import { toIsoDate } from '../invoices/invoice.mapper.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { Decimal, roundMoney } from '../stock/costing.js';
import { type StockResponse, StockService } from '../stock/stock.service.js';
import { type Period, daysOf, periodView } from './period.js';

/**
 * Reportes del módulo de stock. Todos los cálculos con Decimal; las ventas anuladas no cuentan.
 * Criterios:
 * - Ventas: suma de los subtotales de los ítems (lo que se cobró).
 * - Costo de lo vendido: kg × costo unitario guardado en cada ítem al vender, redondeado a
 *   centavos por ítem.
 * - Ganancia bruta = ventas − costo de lo vendido; margen = ganancia / ventas.
 * - Mermas: solo movimientos WASTE (los ajustes por conteo no son mermas), valorizados al costo
 *   unitario con que se registraron; % sobre los kg comprados en el mismo período.
 */

const PAYMENT_METHODS: PaymentMethod[] = ['CASH', 'TRANSFER', 'CARD', 'OTHER'];

/** Porcentaje con 2 decimales (mitad hacia arriba); null si no hay base. */
export function percent(part: Decimal, whole: Decimal): string | null {
  if (whole.isZero()) return null;
  return part.times(100).dividedBy(whole).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

const zero = () => new Decimal(0);

export interface SalesReport {
  period: { from: string; to: string };
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
  /** Margen sobre ventas, en %. */
  marginPct: string | null;
}

export interface ProfitReport {
  period: { from: string; to: string };
  totals: Omit<ProfitRow, 'productId' | 'name'>;
  byProduct: ProfitRow[];
}

export interface WasteReport {
  period: { from: string; to: string };
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
  period: { from: string; to: string };
  totals: { count: number; kg: string; amount: string };
  bySupplier: { supplierId: string; name: string; count: number; kg: string; amount: string }[];
  byProduct: {
    productId: string;
    name: string;
    kg: string;
    amount: string;
    /** Costo promedio pagado en el período (monto / kg). */
    averageCost: string;
  }[];
}

export interface DashboardReport {
  today: string;
  month: { from: string; to: string };
  salesToday: { count: number; amount: string };
  salesMonth: { count: number; amount: string };
  profitMonth: { profit: string; marginPct: string | null };
  stockValue: string;
  lowStockProducts: number;
  /** Del módulo 1: facturas de faena pendientes de pago y vencidas. */
  invoices: { pending: SummaryBucket; overdue: SummaryBucket };
}

interface Acc {
  count: number;
  kg: Decimal;
  amount: Decimal;
}
const acc = (): Acc => ({ count: 0, kg: zero(), amount: zero() });

function sortByAmount<T extends { amount: string }>(rows: T[]): T[] {
  return rows.sort((a, b) => new Decimal(b.amount).comparedTo(a.amount));
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
    private readonly invoices: InvoiceQueryService,
  ) {}

  /** Stock valorizado: es el estado actual, no depende del período. */
  stockReport(): Promise<StockResponse> {
    return this.stock.getStock();
  }

  private saleItems(period: Period) {
    return this.prisma.saleItem.findMany({
      where: { sale: { voided: false, date: { gte: period.from, lte: period.to } } },
      select: {
        kg: true,
        subtotal: true,
        unitCost: true,
        productId: true,
        product: { select: { name: true } },
        sale: { select: { id: true, date: true, paymentMethod: true } },
      },
    });
  }

  async sales(period: Period): Promise<SalesReport> {
    const items = await this.saleItems(period);
    const totals = acc();
    const saleIds = new Set<string>();
    const byDay = new Map<string, Acc & { sales: Set<string> }>(
      daysOf(period).map((d) => [d, { ...acc(), sales: new Set<string>() }]),
    );
    const byProduct = new Map<string, Acc & { name: string }>();
    const byMethod = new Map<PaymentMethod, Acc & { sales: Set<string> }>(
      PAYMENT_METHODS.map((m) => [m, { ...acc(), sales: new Set<string>() }]),
    );

    for (const item of items) {
      saleIds.add(item.sale.id);
      totals.kg = totals.kg.plus(item.kg);
      totals.amount = totals.amount.plus(item.subtotal);

      const day = byDay.get(toIsoDate(item.sale.date));
      if (day) {
        day.sales.add(item.sale.id);
        day.kg = day.kg.plus(item.kg);
        day.amount = day.amount.plus(item.subtotal);
      }
      const product = byProduct.get(item.productId) ?? { ...acc(), name: item.product.name };
      product.kg = product.kg.plus(item.kg);
      product.amount = product.amount.plus(item.subtotal);
      byProduct.set(item.productId, product);

      const method = byMethod.get(item.sale.paymentMethod);
      if (method) {
        method.sales.add(item.sale.id);
        method.amount = method.amount.plus(item.subtotal);
      }
    }

    totals.count = saleIds.size;
    return {
      period: periodView(period),
      totals: {
        count: totals.count,
        kg: totals.kg.toFixed(3),
        amount: totals.amount.toFixed(2),
        averageTicket:
          totals.count === 0 ? null : roundMoney(totals.amount.dividedBy(totals.count)).toFixed(2),
      },
      byDay: [...byDay].map(([date, d]) => ({
        date,
        count: d.sales.size,
        kg: d.kg.toFixed(3),
        amount: d.amount.toFixed(2),
      })),
      byProduct: sortByAmount(
        [...byProduct].map(([productId, p]) => ({
          productId,
          name: p.name,
          kg: p.kg.toFixed(3),
          amount: p.amount.toFixed(2),
        })),
      ),
      byPaymentMethod: [...byMethod].map(([method, m]) => ({
        method,
        count: m.sales.size,
        amount: m.amount.toFixed(2),
      })),
    };
  }

  async profit(period: Period): Promise<ProfitReport> {
    const items = await this.saleItems(period);
    const byProduct = new Map<
      string,
      { name: string; kg: Decimal; revenue: Decimal; cost: Decimal }
    >();
    let revenue = zero();
    let cost = zero();
    let kg = zero();
    for (const item of items) {
      const itemCost = roundMoney(item.kg.times(item.unitCost));
      revenue = revenue.plus(item.subtotal);
      cost = cost.plus(itemCost);
      kg = kg.plus(item.kg);
      const row = byProduct.get(item.productId) ?? {
        name: item.product.name,
        kg: zero(),
        revenue: zero(),
        cost: zero(),
      };
      row.kg = row.kg.plus(item.kg);
      row.revenue = row.revenue.plus(item.subtotal);
      row.cost = row.cost.plus(itemCost);
      byProduct.set(item.productId, row);
    }
    const view = (r: { kg: Decimal; revenue: Decimal; cost: Decimal }) => {
      const profit = r.revenue.minus(r.cost);
      return {
        kg: r.kg.toFixed(3),
        revenue: r.revenue.toFixed(2),
        cost: r.cost.toFixed(2),
        profit: profit.toFixed(2),
        marginPct: percent(profit, r.revenue),
      };
    };
    return {
      period: periodView(period),
      totals: view({ kg, revenue, cost }),
      byProduct: [...byProduct]
        .map(([productId, r]) => ({ productId, name: r.name, ...view(r) }))
        .sort((a, b) => new Decimal(b.profit).comparedTo(a.profit)),
    };
  }

  async waste(period: Period): Promise<WasteReport> {
    const dateFilter = { gte: period.from, lte: period.to };
    const [movements, purchased] = await Promise.all([
      this.prisma.stockMovement.findMany({
        where: { type: 'WASTE', date: dateFilter },
        select: {
          kg: true,
          unitCost: true,
          reason: true,
          productId: true,
          product: { select: { name: true } },
        },
      }),
      this.prisma.purchaseItem.groupBy({
        by: ['productId'],
        where: { purchase: { date: dateFilter } },
        _sum: { kg: true },
      }),
    ]);
    const purchasedByProduct = new Map(purchased.map((p) => [p.productId, p._sum.kg ?? zero()]));
    const purchasedKg = purchased.reduce((s, p) => s.plus(p._sum.kg ?? 0), zero());

    let kg = zero();
    let value = zero();
    const byReason = new Map<string, Acc>();
    const byProduct = new Map<string, { name: string; kg: Decimal; value: Decimal }>();
    for (const m of movements) {
      const lostKg = m.kg.negated(); // las mermas se guardan con kg negativos
      const lostValue = roundMoney(lostKg.times(m.unitCost ?? 0));
      kg = kg.plus(lostKg);
      value = value.plus(lostValue);
      const reason = m.reason ?? 'Sin motivo';
      const r = byReason.get(reason) ?? acc();
      r.count++;
      r.kg = r.kg.plus(lostKg);
      r.amount = r.amount.plus(lostValue);
      byReason.set(reason, r);
      const p = byProduct.get(m.productId) ?? { name: m.product.name, kg: zero(), value: zero() };
      p.kg = p.kg.plus(lostKg);
      p.value = p.value.plus(lostValue);
      byProduct.set(m.productId, p);
    }
    return {
      period: periodView(period),
      totals: {
        kg: kg.toFixed(3),
        value: value.toFixed(2),
        purchasedKg: purchasedKg.toFixed(3),
        pctOfPurchased: percent(kg, purchasedKg),
      },
      byReason: [...byReason]
        .map(([reason, r]) => ({
          reason,
          count: r.count,
          kg: r.kg.toFixed(3),
          value: r.amount.toFixed(2),
        }))
        .sort((a, b) => new Decimal(b.value).comparedTo(a.value)),
      byProduct: [...byProduct]
        .map(([productId, p]) => {
          const bought = purchasedByProduct.get(productId) ?? zero();
          return {
            productId,
            name: p.name,
            kg: p.kg.toFixed(3),
            value: p.value.toFixed(2),
            purchasedKg: bought.toFixed(3),
            pctOfPurchased: percent(p.kg, bought),
          };
        })
        .sort((a, b) => new Decimal(b.value).comparedTo(a.value)),
    };
  }

  async purchases(period: Period): Promise<PurchasesReport> {
    const items = await this.prisma.purchaseItem.findMany({
      where: { purchase: { date: { gte: period.from, lte: period.to } } },
      select: {
        kg: true,
        totalCost: true,
        productId: true,
        product: { select: { name: true } },
        purchase: { select: { id: true, supplierId: true, supplier: { select: { name: true } } } },
      },
    });
    const totals = acc();
    const purchaseIds = new Set<string>();
    const bySupplier = new Map<string, Acc & { name: string; purchases: Set<string> }>();
    const byProduct = new Map<string, Acc & { name: string }>();
    for (const item of items) {
      purchaseIds.add(item.purchase.id);
      totals.kg = totals.kg.plus(item.kg);
      totals.amount = totals.amount.plus(item.totalCost);
      const s = bySupplier.get(item.purchase.supplierId) ?? {
        ...acc(),
        name: item.purchase.supplier.name,
        purchases: new Set<string>(),
      };
      s.purchases.add(item.purchase.id);
      s.kg = s.kg.plus(item.kg);
      s.amount = s.amount.plus(item.totalCost);
      bySupplier.set(item.purchase.supplierId, s);
      const p = byProduct.get(item.productId) ?? { ...acc(), name: item.product.name };
      p.kg = p.kg.plus(item.kg);
      p.amount = p.amount.plus(item.totalCost);
      byProduct.set(item.productId, p);
    }
    return {
      period: periodView(period),
      totals: {
        count: purchaseIds.size,
        kg: totals.kg.toFixed(3),
        amount: totals.amount.toFixed(2),
      },
      bySupplier: sortByAmount(
        [...bySupplier].map(([supplierId, s]) => ({
          supplierId,
          name: s.name,
          count: s.purchases.size,
          kg: s.kg.toFixed(3),
          amount: s.amount.toFixed(2),
        })),
      ),
      byProduct: sortByAmount(
        [...byProduct].map(([productId, p]) => ({
          productId,
          name: p.name,
          kg: p.kg.toFixed(3),
          amount: p.amount.toFixed(2),
          averageCost: roundMoney(p.amount.dividedBy(p.kg)).toFixed(2),
        })),
      ),
    };
  }

  async dashboard(now = new Date()): Promise<DashboardReport> {
    const today = todayInArgentina(now);
    const month = monthRange(today);
    const salesBucket = async (from: Date, to: Date) => {
      const r = await this.prisma.sale.aggregate({
        where: { voided: false, date: { gte: from, lte: to } },
        _count: { _all: true },
        _sum: { total: true },
      });
      return { count: r._count._all, amount: (r._sum.total ?? new Prisma.Decimal(0)).toFixed(2) };
    };
    const [salesToday, salesMonth, profit, stock, invoices] = await Promise.all([
      salesBucket(today, today),
      salesBucket(month.start, month.end),
      this.profit({ from: month.start, to: month.end }),
      this.stock.getStock(),
      this.invoices.summary(now),
    ]);
    return {
      today: toIsoDate(today),
      month: periodView({ from: month.start, to: month.end }),
      salesToday,
      salesMonth,
      profitMonth: { profit: profit.totals.profit, marginPct: profit.totals.marginPct },
      stockValue: stock.totals.value,
      lowStockProducts: stock.totals.lowStock,
      invoices: { pending: invoices.pending, overdue: invoices.overdue },
    };
  }
}
