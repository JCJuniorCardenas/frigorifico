import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { todayInArgentina } from '../invoices/due-dates.js';
import { fromIsoDate, toIsoDate } from '../invoices/invoice.mapper.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { Decimal, roundMoney } from './costing.js';
import type {
  AdjustmentType,
  CreateAdjustmentDto,
  ListAdjustmentsQueryDto,
} from './dto/adjustment.dto.js';
import { StockService } from './stock.service.js';

export interface AdjustmentRow {
  id: string;
  date: string;
  type: AdjustmentType;
  productId: string;
  productName: string;
  /** Con signo: negativo = salió del stock. */
  kg: string;
  unitCost: string;
  /** kg × costo (con signo): en una merma, el valor perdido en negativo. */
  value: string;
  reason: string;
  createdBy: string;
  createdAt: string;
}

export interface AdjustmentResult extends AdjustmentRow {
  /** Stock antes y después del movimiento. */
  stockBefore: string;
  stockAfter: string;
}

export interface AdjustmentListResponse {
  items: AdjustmentRow[];
  total: number;
  page: number;
  pageSize: number;
  totals: {
    /** kg perdidos por mermas (positivo) y su valor. */
    wasteKg: string;
    wasteValue: string;
    /** Diferencia neta de los ajustes (con signo) y su valor. */
    adjustmentKg: string;
    adjustmentValue: string;
  };
}

const include = {
  product: { select: { name: true } },
  createdBy: { select: { name: true } },
} satisfies Prisma.StockMovementInclude;

type MovementWithRelations = Prisma.StockMovementGetPayload<{ include: typeof include }>;

function toRow(m: MovementWithRelations): AdjustmentRow {
  const unitCost = m.unitCost ?? new Decimal(0);
  return {
    id: m.id,
    date: toIsoDate(m.date),
    type: m.type as AdjustmentType,
    productId: m.productId,
    productName: m.product.name,
    kg: m.kg.toFixed(3),
    unitCost: unitCost.toFixed(2),
    value: roundMoney(m.kg.times(unitCost)).toFixed(2),
    reason: m.reason ?? '',
    createdBy: m.createdBy.name,
    createdAt: m.createdAt.toISOString(),
  };
}

/** Mermas y ajustes de stock: siempre con motivo; nunca se editan ni se borran. */
@Injectable()
export class AdjustmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
  ) {}

  async create(dto: CreateAdjustmentDto, userId: string): Promise<AdjustmentResult> {
    const today = todayInArgentina();
    const date = dto.date ? fromIsoDate(dto.date) : today;
    if (!date) throw new BadRequestException('La fecha no existe');
    if (date > today) throw new BadRequestException('La fecha no puede ser futura');
    if ((dto.kg === undefined) === (dto.countedKg === undefined)) {
      throw new BadRequestException('Indicá los kg o los kg contados (uno de los dos)');
    }
    if (dto.type === 'WASTE') {
      if (dto.countedKg !== undefined) {
        throw new BadRequestException('En una merma se indican los kg perdidos, no un conteo');
      }
      if (new Decimal(dto.kg as string).lte(0)) {
        throw new BadRequestException('Los kg de la merma deben ser mayores a cero');
      }
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({ where: { id: dto.productId } });
      if (!product) throw new BadRequestException('El producto no existe');
      // Los inactivos se pueden ajustar: sirve para dejar en cero lo que quedó antes de dejar
      // de venderlos.
      await this.stock.lockProducts(tx, [product.id]);
      const before = (await this.stock.stockOf(tx, [product.id])).get(product.id) ?? new Decimal(0);

      let delta: Decimal;
      if (dto.type === 'WASTE') {
        delta = new Decimal(dto.kg as string).negated();
      } else if (dto.countedKg !== undefined) {
        delta = new Decimal(dto.countedKg).minus(before);
        if (delta.isZero()) {
          throw new BadRequestException(
            'El conteo coincide con el stock actual: no hay nada que ajustar',
          );
        }
      } else {
        delta = new Decimal(dto.kg as string);
        if (delta.isZero()) throw new BadRequestException('El ajuste no puede ser de 0 kg');
      }

      const after = before.plus(delta);
      if (after.lt(0) && delta.lt(0) && !dto.confirmNegativeStock) {
        throw new ConflictException({
          statusCode: 409,
          error: 'Conflict',
          code: 'NEGATIVE_STOCK',
          message: `${product.name} quedaría con stock negativo. ¿Confirmás igual?`,
          items: [
            {
              productId: product.id,
              name: product.name,
              stockKg: before.toFixed(3),
              requestedKg: delta.negated().toFixed(3),
              resultingKg: after.toFixed(3),
            },
          ],
        });
      }

      const id = await this.stock.recordAdjustment(tx, {
        productId: product.id,
        type: dto.type,
        kg: delta,
        unitCost: roundMoney(product.avgCost),
        reason: dto.reason,
        date,
        userId,
      });
      return { id, before, after };
    });

    const movement = await this.prisma.stockMovement.findUniqueOrThrow({
      where: { id: result.id },
      include,
    });
    return {
      ...toRow(movement),
      stockBefore: result.before.toFixed(3),
      stockAfter: result.after.toFixed(3),
    };
  }

  async list(query: ListAdjustmentsQueryDto): Promise<AdjustmentListResponse> {
    const where = this.buildWhere(query);
    const [rows, total, all] = await Promise.all([
      this.prisma.stockMovement.findMany({
        where,
        include,
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.stockMovement.count({ where }),
      // Para los totales se necesita kg × costo de cada movimiento del filtro.
      this.prisma.stockMovement.findMany({
        where,
        select: { type: true, kg: true, unitCost: true },
      }),
    ]);
    let wasteKg = new Decimal(0);
    let wasteValue = new Decimal(0);
    let adjustmentKg = new Decimal(0);
    let adjustmentValue = new Decimal(0);
    for (const m of all) {
      const value = roundMoney(m.kg.times(m.unitCost ?? 0));
      if (m.type === 'WASTE') {
        wasteKg = wasteKg.minus(m.kg);
        wasteValue = wasteValue.minus(value);
      } else {
        adjustmentKg = adjustmentKg.plus(m.kg);
        adjustmentValue = adjustmentValue.plus(value);
      }
    }
    return {
      items: rows.map(toRow),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totals: {
        wasteKg: wasteKg.toFixed(3),
        wasteValue: wasteValue.toFixed(2),
        adjustmentKg: adjustmentKg.toFixed(3),
        adjustmentValue: adjustmentValue.toFixed(2),
      },
    };
  }

  private buildWhere(query: ListAdjustmentsQueryDto): Prisma.StockMovementWhereInput {
    const where: Prisma.StockMovementWhereInput = {
      type: query.type ?? { in: ['WASTE', 'ADJUSTMENT'] },
    };
    const from = query.from ? fromIsoDate(query.from) : null;
    const to = query.to ? fromIsoDate(query.to) : null;
    if ((query.from && !from) || (query.to && !to)) {
      throw new BadRequestException('Rango de fechas inválido');
    }
    if (from || to) where.date = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
    if (query.productId) where.productId = query.productId;
    return where;
  }
}
