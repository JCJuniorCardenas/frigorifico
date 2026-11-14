import { BadRequestException, Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { type CsvColumn, toCsv } from './csv.js';
import { ReportQueryDto } from './dto/report-query.dto.js';
import { type Period, periodView, resolvePeriod } from './period.js';
import { type DashboardReport, ReportsService } from './reports.service.js';

const PAYMENT_LABELS: Record<string, string> = {
  CASH: 'Efectivo',
  TRANSFER: 'Transferencia',
  CARD: 'Tarjeta',
  OTHER: 'Otro',
};

/** Una tabla exportable: columnas y filas (con una fila de totales al final si corresponde). */
interface Table {
  columns: CsvColumn<Record<string, string | number | null>>[];
  rows: Record<string, string | number | null>[];
}

type Row = Record<string, string | number | null>;

const text = (header: string, key: string): Table['columns'][number] => ({
  header,
  value: (r) => r[key],
});
const num = (header: string, key: string): Table['columns'][number] => ({
  header,
  value: (r) => r[key],
  kind: 'decimal',
});
const date = (header: string, key: string): Table['columns'][number] => ({
  header,
  value: (r) => r[key],
  kind: 'date',
});

const asRows = (rows: object[]): Row[] => rows as unknown as Row[];

@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('dashboard')
  dashboard(): Promise<DashboardReport> {
    return this.reports.dashboard();
  }

  @Get('stock')
  async stock(@Query() q: ReportQueryDto, @Res({ passthrough: true }) res: Response) {
    const report = await this.reports.stockReport();
    return this.respond(q, res, 'stock', null, report, {
      product: {
        columns: [
          text('Producto', 'name'),
          text('Categoría', 'category'),
          num('Kg', 'kg'),
          num('Costo promedio', 'avgCost'),
          num('Valor', 'value'),
        ],
        rows: [
          ...asRows(report.items),
          { name: 'TOTAL', category: null, kg: null, avgCost: null, value: report.totals.value },
        ],
      },
    });
  }

  @Get('sales')
  async sales(@Query() q: ReportQueryDto, @Res({ passthrough: true }) res: Response) {
    const period = resolvePeriod(q.from, q.to);
    const r = await this.reports.sales(period);
    const total = { kg: r.totals.kg, amount: r.totals.amount, count: r.totals.count };
    return this.respond(q, res, 'ventas', period, r, {
      day: {
        columns: [
          date('Fecha', 'date'),
          text('Ventas', 'count'),
          num('Kg', 'kg'),
          num('Importe', 'amount'),
        ],
        rows: [...asRows(r.byDay), { date: null, ...total }],
      },
      product: {
        columns: [text('Producto', 'name'), num('Kg', 'kg'), num('Importe', 'amount')],
        rows: [...asRows(r.byProduct), { name: 'TOTAL', kg: total.kg, amount: total.amount }],
      },
      payment: {
        columns: [
          text('Forma de pago', 'label'),
          text('Ventas', 'count'),
          num('Importe', 'amount'),
        ],
        rows: [
          ...r.byPaymentMethod.map((m) => ({ ...m, label: PAYMENT_LABELS[m.method] })),
          { label: 'TOTAL', count: total.count, amount: total.amount },
        ],
      },
    });
  }

  @Get('profit')
  async profit(@Query() q: ReportQueryDto, @Res({ passthrough: true }) res: Response) {
    const period = resolvePeriod(q.from, q.to);
    const r = await this.reports.profit(period);
    return this.respond(q, res, 'ganancia', period, r, {
      product: {
        columns: [
          text('Producto', 'name'),
          num('Kg vendidos', 'kg'),
          num('Ventas', 'revenue'),
          num('Costo de lo vendido', 'cost'),
          num('Ganancia bruta', 'profit'),
          num('Margen %', 'marginPct'),
        ],
        rows: [...asRows(r.byProduct), { name: 'TOTAL', ...r.totals }],
      },
    });
  }

  @Get('waste')
  async waste(@Query() q: ReportQueryDto, @Res({ passthrough: true }) res: Response) {
    const period = resolvePeriod(q.from, q.to);
    const r = await this.reports.waste(period);
    return this.respond(q, res, 'mermas', period, r, {
      reason: {
        columns: [
          text('Motivo', 'reason'),
          text('Registros', 'count'),
          num('Kg', 'kg'),
          num('Valor perdido', 'value'),
        ],
        rows: [
          ...asRows(r.byReason),
          { reason: 'TOTAL', count: null, kg: r.totals.kg, value: r.totals.value },
        ],
      },
      product: {
        columns: [
          text('Producto', 'name'),
          num('Kg perdidos', 'kg'),
          num('Valor perdido', 'value'),
          num('Kg comprados', 'purchasedKg'),
          num('% sobre lo comprado', 'pctOfPurchased'),
        ],
        rows: [...asRows(r.byProduct), { name: 'TOTAL', ...r.totals }],
      },
    });
  }

  @Get('purchases')
  async purchases(@Query() q: ReportQueryDto, @Res({ passthrough: true }) res: Response) {
    const period = resolvePeriod(q.from, q.to);
    const r = await this.reports.purchases(period);
    return this.respond(q, res, 'compras', period, r, {
      supplier: {
        columns: [
          text('Proveedor', 'name'),
          text('Ingresos', 'count'),
          num('Kg', 'kg'),
          num('Monto', 'amount'),
        ],
        rows: [...asRows(r.bySupplier), { name: 'TOTAL', ...r.totals }],
      },
      product: {
        columns: [
          text('Producto', 'name'),
          num('Kg', 'kg'),
          num('Monto', 'amount'),
          num('Costo promedio pagado', 'averageCost'),
        ],
        rows: [...asRows(r.byProduct), { name: 'TOTAL', kg: r.totals.kg, amount: r.totals.amount }],
      },
    });
  }

  /** JSON por defecto; con format=csv, descarga la tabla pedida (la primera si no se indica). */
  private respond<T>(
    q: ReportQueryDto,
    res: Response,
    name: string,
    period: Period | null,
    report: T,
    tables: Record<string, Table>,
  ): T | string {
    if (q.format !== 'csv') return report;
    const key = q.section ?? Object.keys(tables)[0];
    const table = tables[key];
    if (!table) {
      throw new BadRequestException(
        `Tabla inválida para exportar. Opciones: ${Object.keys(tables).join(', ')}`,
      );
    }
    const range = period ? `_${periodView(period).from}_${periodView(period).to}` : '';
    const filename = `${name}-${key}${range}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return toCsv(table.columns, table.rows);
  }
}
