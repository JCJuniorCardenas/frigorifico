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

/** Factura de faena (módulo 1) vinculada a un ingreso, o candidata por número de tropa. */
export interface LinkedInvoice {
  id: string;
  salesPoint: string;
  voucherNumber: string;
  issueDate: string;
  clientName: string;
  herdNumber: string;
  slaughterKg: string;
  totalAmount: string;
  status: 'PENDING' | 'PAID';
}

export interface PurchaseSummary {
  id: string;
  date: string;
  supplier: { id: string; name: string };
  herdNumber: string | null;
  invoice: LinkedInvoice | null;
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

const invoiceSelect = {
  id: true,
  salesPoint: true,
  voucherNumber: true,
  issueDate: true,
  clientName: true,
  herdNumber: true,
  slaughterKg: true,
  totalAmount: true,
  status: true,
} satisfies Prisma.InvoiceSelect;

type InvoiceRow = Prisma.InvoiceGetPayload<{ select: typeof invoiceSelect }>;

function toLinkedInvoice(i: InvoiceRow): LinkedInvoice {
  return {
    id: i.id,
    salesPoint: i.salesPoint,
    voucherNumber: i.voucherNumber,
    issueDate: toIsoDate(i.issueDate),
    clientName: i.clientName,
    herdNumber: i.herdNumber,
    slaughterKg: i.slaughterKg.toFixed(2),
    totalAmount: i.totalAmount.toFixed(2),
    status: i.status,
  };
}

const purchaseInclude = {
  supplier: { select: { id: true, name: true } },
  createdBy: { select: { name: true } },
  invoice: { select: invoiceSelect },
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
    invoice: p.invoice ? toLinkedInvoice(p.invoice) : null,
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

      const link = dto.invoiceId
        ? await this.checkInvoiceLink(tx, dto.invoiceId, dto.herdNumber ?? null)
        : null;

      await this.stock.lockProducts(tx, productIds);
      const purchase = await tx.purchase.create({
        data: {
          date,
          supplierId: supplier.id,
          // Sin tropa cargada, se toma la de la factura vinculada.
          herdNumber: dto.herdNumber ?? link?.herdNumber ?? null,
          invoiceId: link?.id ?? null,
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

  /**
   * Facturas de faena con ese número de tropa, para sugerir el vínculo al cargar un ingreso
   * (lo normal es una sola; si hay más, el usuario elige).
   */
  async invoiceCandidates(herdNumber: string): Promise<LinkedInvoice[]> {
    const invoices = await this.prisma.invoice.findMany({
      where: { herdNumber },
      select: invoiceSelect,
      orderBy: { issueDate: 'desc' },
      take: 10,
    });
    return invoices.map(toLinkedInvoice);
  }

  /**
   * Vincula (o desvincula, con null) un ingreso ya cargado a una factura de faena. No toca el
   * stock: es un dato de trazabilidad, por eso se permite aunque los ingresos no se editan.
   */
  async setInvoice(id: string, invoiceId: string | null): Promise<PurchaseDetail> {
    await this.prisma.$transaction(async (tx) => {
      const purchase = await tx.purchase.findUnique({ where: { id } });
      if (!purchase) throw new NotFoundException('Ingreso no encontrado');
      if (invoiceId === null) {
        await tx.purchase.update({ where: { id }, data: { invoiceId: null } });
        return;
      }
      const invoice = await this.checkInvoiceLink(tx, invoiceId, purchase.herdNumber);
      await tx.purchase.update({
        where: { id },
        data: { invoiceId: invoice.id, herdNumber: purchase.herdNumber ?? invoice.herdNumber },
      });
    });
    return this.findOne(id);
  }

  /** La factura existe y, si el ingreso tiene tropa, es la misma tropa. */
  private async checkInvoiceLink(
    tx: Prisma.TransactionClient,
    invoiceId: string,
    herdNumber: string | null,
  ): Promise<{ id: string; herdNumber: string }> {
    const invoice = await tx.invoice.findUnique({
      where: { id: invoiceId },
      select: { id: true, herdNumber: true, salesPoint: true, voucherNumber: true },
    });
    if (!invoice) throw new BadRequestException('La factura de faena no existe');
    if (herdNumber && invoice.herdNumber !== herdNumber) {
      throw new BadRequestException(
        `La factura ${invoice.salesPoint}-${invoice.voucherNumber} es de la tropa ` +
          `${invoice.herdNumber}, no de la ${herdNumber}`,
      );
    }
    return invoice;
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
