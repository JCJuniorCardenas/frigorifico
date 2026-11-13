import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { todayInArgentina } from '../invoices/due-dates.js';
import { fromIsoDate, toIsoDate } from '../invoices/invoice.mapper.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { Decimal, lineTotal } from './costing.js';
import type { CreatePurchaseDto, ListPurchasesQueryDto } from './dto/purchase.dto.js';
import { StockService } from './stock.service.js';

export interface PurchaseItemView {
  id: string;
  productId: string;
  productName: string;
  kg: string;
  costPerKg: string;
  totalCost: string;
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
  items: PurchaseItemView[];
}

export interface PurchaseListResponse {
  items: PurchaseSummary[];
  total: number;
  page: number;
  pageSize: number;
  totals: { kg: string; cost: string };
}

const purchaseInclude = {
  supplier: { select: { id: true, name: true } },
  createdBy: { select: { name: true } },
  items: { include: { product: { select: { name: true } } }, orderBy: { line: 'asc' } },
} satisfies Prisma.PurchaseInclude;

type PurchaseWithRelations = Prisma.PurchaseGetPayload<{ include: typeof purchaseInclude }>;

function toDetail(p: PurchaseWithRelations): PurchaseDetail {
  const totalKg = p.items.reduce((acc, i) => acc.plus(i.kg), new Decimal(0));
  const totalCost = p.items.reduce((acc, i) => acc.plus(i.totalCost), new Decimal(0));
  return {
    id: p.id,
    date: toIsoDate(p.date),
    supplier: p.supplier,
    herdNumber: p.herdNumber,
    notes: p.notes,
    itemCount: p.items.length,
    totalKg: totalKg.toFixed(3),
    totalCost: totalCost.toFixed(2),
    createdBy: p.createdBy.name,
    createdAt: p.createdAt.toISOString(),
    items: p.items.map((i) => ({
      id: i.id,
      productId: i.productId,
      productName: i.product.name,
      kg: i.kg.toFixed(3),
      costPerKg: i.costPerKg.toFixed(2),
      totalCost: i.totalCost.toFixed(2),
    })),
  };
}

@Injectable()
export class PurchasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
  ) {}

  /** Registra un ingreso: guarda la compra, genera un PURCHASE por ítem y recalcula costos. */
  async create(dto: CreatePurchaseDto, userId: string): Promise<PurchaseDetail> {
    const date = fromIsoDate(dto.date);
    if (!date) throw new BadRequestException('La fecha no existe');
    if (date > todayInArgentina()) {
      throw new BadRequestException('La fecha del ingreso no puede ser futura');
    }
    const problems: string[] = [];
    dto.items.forEach((item, i) => {
      if (new Decimal(item.kg).lte(0))
        problems.push(`Ítem ${i + 1}: los kg deben ser mayores a cero`);
      if (new Decimal(item.costPerKg).lte(0)) {
        problems.push(`Ítem ${i + 1}: el costo por kg debe ser mayor a cero`);
      }
    });
    if (problems.length > 0) throw new BadRequestException(problems);

    const productIds = [...new Set(dto.items.map((i) => i.productId))];
    const id = await this.prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.findUnique({ where: { id: dto.supplierId } });
      if (!supplier) throw new BadRequestException('El proveedor no existe');
      if (!supplier.active)
        throw new BadRequestException(`El proveedor ${supplier.name} está inactivo`);

      const products = await tx.product.findMany({ where: { id: { in: productIds } } });
      const missing = productIds.filter((pid) => !products.some((p) => p.id === pid));
      if (missing.length > 0) throw new BadRequestException('Algún producto elegido no existe');
      const inactive = products.filter((p) => !p.active).map((p) => p.name);
      if (inactive.length > 0) {
        throw new BadRequestException(`Productos inactivos: ${inactive.join(', ')}`);
      }

      await this.stock.lockProducts(tx, productIds);
      const purchase = await tx.purchase.create({
        data: {
          date,
          supplierId: supplier.id,
          herdNumber: dto.herdNumber ?? null,
          notes: dto.notes ?? null,
          createdById: userId,
          items: {
            create: dto.items.map((item, index) => ({
              line: index + 1,
              productId: item.productId,
              kg: item.kg,
              costPerKg: item.costPerKg,
              totalCost: lineTotal(item.kg, item.costPerKg),
            })),
          },
        },
      });
      await this.stock.recordPurchase(tx, {
        purchaseId: purchase.id,
        date,
        userId,
        items: dto.items,
      });
      return purchase.id;
    });
    return this.findOne(id);
  }

  async findOne(id: string): Promise<PurchaseDetail> {
    const purchase = await this.prisma.purchase.findUnique({
      where: { id },
      include: purchaseInclude,
    });
    if (!purchase) throw new NotFoundException('Ingreso no encontrado');
    return toDetail(purchase);
  }

  async list(query: ListPurchasesQueryDto): Promise<PurchaseListResponse> {
    const where = this.buildWhere(query);
    const [rows, total, sums] = await Promise.all([
      this.prisma.purchase.findMany({
        where,
        include: purchaseInclude,
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.purchase.count({ where }),
      this.prisma.purchaseItem.aggregate({
        where: { purchase: where },
        _sum: { kg: true, totalCost: true },
      }),
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
        kg: (sums._sum.kg ?? new Decimal(0)).toFixed(3),
        cost: (sums._sum.totalCost ?? new Decimal(0)).toFixed(2),
      },
    };
  }

  private buildWhere(query: ListPurchasesQueryDto): Prisma.PurchaseWhereInput {
    const where: Prisma.PurchaseWhereInput = {};
    const from = query.from ? fromIsoDate(query.from) : null;
    const to = query.to ? fromIsoDate(query.to) : null;
    if ((query.from && !from) || (query.to && !to)) {
      throw new BadRequestException('Rango de fechas inválido');
    }
    if (from || to) where.date = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
    if (query.supplierId) where.supplierId = query.supplierId;
    if (query.herdNumber) where.herdNumber = query.herdNumber;
    return where;
  }
}
