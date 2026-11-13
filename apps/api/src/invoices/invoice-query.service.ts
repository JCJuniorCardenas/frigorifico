import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { addDays, DUE_WEEK_DAYS, monthRange, todayInArgentina } from './due-dates.js';
import type { ListInvoicesQueryDto, SortField } from './dto/list-invoices.dto.js';
import { fromIsoDate, type InvoiceListItem, toIsoDate, toListItem } from './invoice.mapper.js';

export interface Totals {
  count: number;
  /** Suma de kg de faena (decimal string). */
  kg: string;
  /** Suma de importes totales (decimal string). */
  amount: string;
}

export interface InvoiceListResponse {
  items: InvoiceListItem[];
  page: number;
  pageSize: number;
  /** Totales de TODAS las facturas que cumplen el filtro (no solo esta página). */
  totals: Totals;
  /** Fecha de hoy en Argentina usada para calcular vencimientos. */
  today: string;
}

export interface SummaryBucket {
  count: number;
  amount: string;
}

export interface InvoiceSummary {
  today: string;
  pending: SummaryBucket;
  overdue: SummaryBucket;
  dueThisWeek: SummaryBucket;
  collectedThisMonth: SummaryBucket;
}

export interface ClientOption {
  clientCuit: string;
  clientName: string;
}

@Injectable()
export class InvoiceQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListInvoicesQueryDto, now = new Date()): Promise<InvoiceListResponse> {
    const today = todayInArgentina(now);
    const where = this.buildWhere(query, today);
    const [rows, aggregate] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        orderBy: this.buildOrderBy(query),
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.invoice.aggregate({
        where,
        _count: { _all: true },
        _sum: { slaughterKg: true, totalAmount: true },
      }),
    ]);
    return {
      items: rows.map((row) => toListItem(row, today)),
      page: query.page,
      pageSize: query.pageSize,
      totals: {
        count: aggregate._count._all,
        kg: (aggregate._sum.slaughterKg ?? new Prisma.Decimal(0)).toFixed(2),
        amount: (aggregate._sum.totalAmount ?? new Prisma.Decimal(0)).toFixed(2),
      },
      today: toIsoDate(today),
    };
  }

  /**
   * Tarjetas de resumen. Usan exactamente los mismos filtros que la tabla, así el total de
   * cada tarjeta coincide con la suma de las filas que muestra la tabla con ese filtro.
   */
  async summary(now = new Date()): Promise<InvoiceSummary> {
    const today = todayInArgentina(now);
    const { start, end } = monthRange(today);
    const bucket = async (where: Prisma.InvoiceWhereInput): Promise<SummaryBucket> => {
      const result = await this.prisma.invoice.aggregate({
        where,
        _count: { _all: true },
        _sum: { totalAmount: true },
      });
      return {
        count: result._count._all,
        amount: (result._sum.totalAmount ?? new Prisma.Decimal(0)).toFixed(2),
      };
    };
    const [pending, overdue, dueThisWeek, collectedThisMonth] = await Promise.all([
      bucket(statusWhere('pending', today)),
      bucket(statusWhere('overdue', today)),
      bucket({
        status: 'PENDING',
        paymentDueDate: { gte: today, lte: addDays(today, DUE_WEEK_DAYS) },
      }),
      bucket({ status: 'PAID', paidAt: { gte: start, lte: end } }),
    ]);
    return { today: toIsoDate(today), pending, overdue, dueThisWeek, collectedThisMonth };
  }

  /** Clientes distintos (para el filtro por cliente). */
  async clients(): Promise<ClientOption[]> {
    const rows = await this.prisma.invoice.groupBy({
      by: ['clientCuit'],
      _max: { clientName: true },
    });
    return rows
      .map((r) => ({ clientCuit: r.clientCuit, clientName: r._max.clientName ?? r.clientCuit }))
      .sort((a, b) => a.clientName.localeCompare(b.clientName, 'es'));
  }

  private buildWhere(query: ListInvoicesQueryDto, today: Date): Prisma.InvoiceWhereInput {
    const and: Prisma.InvoiceWhereInput[] = [statusWhere(query.status, today)];

    if (query.clientCuit) and.push({ clientCuit: query.clientCuit });

    if (query.from || query.to) {
      const range: Prisma.DateTimeFilter = {};
      if (query.from) range.gte = parseDate(query.from, 'desde');
      if (query.to) range.lte = parseDate(query.to, 'hasta');
      and.push(query.dateField === 'due' ? { paymentDueDate: range } : { issueDate: range });
    }

    if (query.q) and.push(searchWhere(query.q));
    return { AND: and };
  }

  private buildOrderBy(query: ListInvoicesQueryDto): Prisma.InvoiceOrderByWithRelationInput[] {
    const field: SortField = query.sort ?? (query.status === 'paid' ? 'paidAt' : 'paymentDueDate');
    const dir = query.dir ?? (query.sort ? 'asc' : query.status === 'paid' ? 'desc' : 'asc');
    const primary: Prisma.InvoiceOrderByWithRelationInput[] =
      field === 'voucherNumber'
        ? [{ salesPoint: dir }, { voucherNumber: dir }]
        : field === 'paidAt'
          ? [{ paidAt: { sort: dir, nulls: 'last' } }]
          : [{ [field]: dir }];
    // Desempate estable para que la paginación no repita ni saltee filas.
    return [...primary, { salesPoint: 'asc' }, { voucherNumber: 'asc' }];
  }
}

/** Filtro por estado, compartido entre la tabla y las tarjetas. */
export function statusWhere(
  status: ListInvoicesQueryDto['status'],
  today: Date,
): Prisma.InvoiceWhereInput {
  switch (status) {
    case 'pending':
      return { status: 'PENDING' };
    case 'overdue':
      return { status: 'PENDING', paymentDueDate: { lt: today } };
    case 'paid':
      return { status: 'PAID' };
    default:
      return {};
  }
}

/** Busca en cliente, tropa y comprobante. Acepta "00004-00000115" o solo el número. */
function searchWhere(q: string): Prisma.InvoiceWhereInput {
  const or: Prisma.InvoiceWhereInput[] = [
    { clientName: { contains: q, mode: 'insensitive' } },
    { clientCuit: { contains: q.replace(/-/g, '') } },
    { herdNumber: { contains: q } },
    { voucherNumber: { contains: q } },
  ];
  const voucher = /^(\d{1,5})-(\d{1,8})$/.exec(q);
  if (voucher) {
    or.push({
      salesPoint: voucher[1].padStart(5, '0'),
      voucherNumber: { endsWith: voucher[2].replace(/^0+/, '') || '0' },
    });
  }
  return { OR: or };
}

function parseDate(value: string, label: string): Date {
  const date = fromIsoDate(value);
  if (!date) throw new BadRequestException(`La fecha "${label}" no es válida: ${value}`);
  return date;
}
