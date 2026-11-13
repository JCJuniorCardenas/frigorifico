import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import type { PaymentMethod } from '../generated/prisma/enums.js';
import { todayInArgentina } from '../invoices/due-dates.js';
import { fromIsoDate, toIsoDate } from '../invoices/invoice.mapper.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { Decimal, lineTotal, roundMoney } from '../stock/costing.js';
import { StockService } from '../stock/stock.service.js';
import type { CreateSaleDto, ListSalesQueryDto } from './dto/sale.dto.js';

export interface SaleItemView {
  id: string;
  productId: string;
  productName: string;
  kg: string;
  pricePerKg: string;
  subtotal: string;
  unitCost: string;
}

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
  items: SaleItemView[];
}

export interface SaleListResponse {
  items: SaleSummary[];
  total: number;
  page: number;
  pageSize: number;
  /** Totales de las ventas NO anuladas del filtro (las anuladas no cuentan). */
  totals: { count: number; amount: string; kg: string };
}

/** Producto que quedaría con stock negativo si se confirma la venta. */
export interface NegativeStockItem {
  productId: string;
  name: string;
  stockKg: string;
  requestedKg: string;
  resultingKg: string;
}

const saleInclude = {
  createdBy: { select: { name: true } },
  voidedBy: { select: { name: true } },
  items: { include: { product: { select: { name: true } } }, orderBy: { line: 'asc' } },
} satisfies Prisma.SaleInclude;

type SaleWithRelations = Prisma.SaleGetPayload<{ include: typeof saleInclude }>;

function toDetail(s: SaleWithRelations): SaleDetail {
  return {
    id: s.id,
    date: toIsoDate(s.date),
    customerName: s.customerName,
    paymentMethod: s.paymentMethod,
    total: s.total.toFixed(2),
    totalKg: s.items.reduce((acc, i) => acc.plus(i.kg), new Decimal(0)).toFixed(3),
    itemCount: s.items.length,
    notes: s.notes,
    createdBy: s.createdBy.name,
    createdAt: s.createdAt.toISOString(),
    voided: s.voided,
    voidedAt: s.voidedAt?.toISOString() ?? null,
    voidedBy: s.voidedBy?.name ?? null,
    voidReason: s.voidReason,
    items: s.items.map((i) => ({
      id: i.id,
      productId: i.productId,
      productName: i.product.name,
      kg: i.kg.toFixed(3),
      pricePerKg: i.pricePerKg.toFixed(2),
      subtotal: i.subtotal.toFixed(2),
      unitCost: i.unitCost.toFixed(2),
    })),
  };
}

@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
  ) {}

  /**
   * Registra una venta: un movimiento SALE por ítem y el costo unitario (promedio vigente) de
   * cada uno, para calcular el margen. Si algún producto quedaría con stock negativo, responde
   * 409 NEGATIVE_STOCK salvo que venga `confirmNegativeStock`.
   */
  async create(dto: CreateSaleDto, userId: string): Promise<SaleDetail> {
    const today = todayInArgentina();
    const date = dto.date ? fromIsoDate(dto.date) : today;
    if (!date) throw new BadRequestException('La fecha no existe');
    if (date > today) throw new BadRequestException('La fecha de la venta no puede ser futura');
    const problems: string[] = [];
    dto.items.forEach((item, i) => {
      if (new Decimal(item.kg).lte(0))
        problems.push(`Ítem ${i + 1}: los kg deben ser mayores a cero`);
      if (new Decimal(item.pricePerKg).lte(0)) {
        problems.push(`Ítem ${i + 1}: el precio por kg debe ser mayor a cero`);
      }
    });
    if (problems.length > 0) throw new BadRequestException(problems);

    const productIds = [...new Set(dto.items.map((i) => i.productId))];
    const id = await this.prisma.$transaction(async (tx) => {
      const products = await tx.product.findMany({ where: { id: { in: productIds } } });
      if (products.length !== productIds.length) {
        throw new BadRequestException('Algún producto elegido no existe');
      }
      const inactive = products.filter((p) => !p.active).map((p) => p.name);
      if (inactive.length > 0) {
        throw new BadRequestException(`Productos inactivos: ${inactive.join(', ')}`);
      }

      await this.stock.lockProducts(tx, productIds);
      // Con los productos bloqueados, el stock y el costo leídos no cambian hasta el commit.
      const stock = await this.stock.stockOf(tx, productIds);
      const locked = await tx.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, name: true, avgCost: true },
      });
      const byId = new Map(locked.map((p) => [p.id, p]));

      if (!dto.confirmNegativeStock) {
        const negative = this.negativeStock(dto, stock, byId);
        if (negative.length > 0) {
          throw new ConflictException({
            statusCode: 409,
            error: 'Conflict',
            code: 'NEGATIVE_STOCK',
            message:
              negative.length === 1
                ? `${negative[0].name} quedaría con stock negativo. ¿Confirmás la venta igual?`
                : 'Algunos productos quedarían con stock negativo. ¿Confirmás la venta igual?',
            items: negative,
          });
        }
      }

      const items = dto.items.map((item, index) => ({
        line: index + 1,
        productId: item.productId,
        kg: item.kg,
        pricePerKg: item.pricePerKg,
        subtotal: lineTotal(item.kg, item.pricePerKg),
        unitCost: roundMoney(byId.get(item.productId)?.avgCost ?? new Decimal(0)),
      }));
      const total = items.reduce((acc, i) => acc.plus(i.subtotal), new Decimal(0));
      const sale = await tx.sale.create({
        data: {
          date,
          customerName: dto.customerName ?? null,
          paymentMethod: dto.paymentMethod ?? 'CASH',
          notes: dto.notes ?? null,
          total,
          createdById: userId,
          items: { create: items },
        },
      });
      await this.stock.recordSale(tx, { saleId: sale.id, date, userId, items });
      return sale.id;
    });
    return this.findOne(id);
  }

  /** Anula una venta: la marca y devuelve al stock exactamente los kg vendidos. */
  async void(id: string, reason: string, userId: string): Promise<SaleDetail> {
    await this.prisma.$transaction(async (tx) => {
      // Bloquea la venta: dos anulaciones simultáneas no devuelven el stock dos veces.
      await tx.$queryRaw`SELECT id FROM "Sale" WHERE id = ${id} FOR UPDATE`;
      const sale = await tx.sale.findUnique({ where: { id }, include: { items: true } });
      if (!sale) throw new NotFoundException('Venta no encontrada');
      if (sale.voided) throw new ConflictException('La venta ya está anulada');

      await this.stock.lockProducts(
        tx,
        sale.items.map((i) => i.productId),
      );
      await tx.sale.update({
        where: { id },
        data: { voided: true, voidedAt: new Date(), voidedById: userId, voidReason: reason },
      });
      await this.stock.recordSaleVoid(tx, {
        saleId: id,
        date: todayInArgentina(),
        userId,
        reason: `Anulación de venta: ${reason}`,
        items: sale.items.map((i) => ({ productId: i.productId, kg: i.kg, unitCost: i.unitCost })),
      });
    });
    return this.findOne(id);
  }

  async findOne(id: string): Promise<SaleDetail> {
    const sale = await this.prisma.sale.findUnique({ where: { id }, include: saleInclude });
    if (!sale) throw new NotFoundException('Venta no encontrada');
    return toDetail(sale);
  }

  async list(query: ListSalesQueryDto): Promise<SaleListResponse> {
    const where = this.buildWhere(query);
    const activeWhere: Prisma.SaleWhereInput = { AND: [where, { voided: false }] };
    const [rows, total, sums, kg] = await Promise.all([
      this.prisma.sale.findMany({
        where,
        include: saleInclude,
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.sale.count({ where }),
      this.prisma.sale.aggregate({ where: activeWhere, _sum: { total: true }, _count: true }),
      this.prisma.saleItem.aggregate({ where: { sale: activeWhere }, _sum: { kg: true } }),
    ]);
    return {
      items: rows.map((r) => {
        const { items: _items, ...summary } = toDetail(r);
        return summary;
      }),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totals: {
        count: sums._count,
        amount: (sums._sum.total ?? new Decimal(0)).toFixed(2),
        kg: (kg._sum.kg ?? new Decimal(0)).toFixed(3),
      },
    };
  }

  private negativeStock(
    dto: CreateSaleDto,
    stock: Map<string, Decimal>,
    products: Map<string, { name: string }>,
  ): NegativeStockItem[] {
    const requested = new Map<string, Decimal>();
    for (const item of dto.items) {
      requested.set(
        item.productId,
        (requested.get(item.productId) ?? new Decimal(0)).plus(item.kg),
      );
    }
    const result: NegativeStockItem[] = [];
    for (const [productId, kg] of requested) {
      const current = stock.get(productId) ?? new Decimal(0);
      const resulting = current.minus(kg);
      if (resulting.lt(0)) {
        result.push({
          productId,
          name: products.get(productId)?.name ?? '',
          stockKg: current.toFixed(3),
          requestedKg: kg.toFixed(3),
          resultingKg: resulting.toFixed(3),
        });
      }
    }
    return result;
  }

  private buildWhere(query: ListSalesQueryDto): Prisma.SaleWhereInput {
    const where: Prisma.SaleWhereInput = {};
    const from = query.from ? fromIsoDate(query.from) : null;
    const to = query.to ? fromIsoDate(query.to) : null;
    if ((query.from && !from) || (query.to && !to)) {
      throw new BadRequestException('Rango de fechas inválido');
    }
    if (from || to) where.date = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
    if (query.paymentMethod) where.paymentMethod = query.paymentMethod;
    if (query.status === 'active') where.voided = false;
    if (query.status === 'voided') where.voided = true;
    return where;
  }
}
