'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Errors } from '@/components/catalog/catalog-ui';
import { formatIsoDate, formatKg, formatMoney } from '@/lib/format';
import {
  type Dashboard,
  type PeriodQuery,
  type ProfitReport,
  type PurchasesReport,
  type ReportName,
  type SalesReport,
  type WasteReport,
  formatPct,
  presetPeriod,
  reportsApi,
} from '@/lib/reports';
import { PAYMENT_LABELS } from '@/lib/sales';
import type { StockResponse } from '@/lib/stock';
import { ReportTable, StatCard } from './report-ui';
import { SalesByDayChart } from './sales-chart';

const TABS: { id: ReportName; label: string }[] = [
  { id: 'sales', label: 'Ventas' },
  { id: 'profit', label: 'Ganancia' },
  { id: 'waste', label: 'Mermas' },
  { id: 'purchases', label: 'Compras' },
  { id: 'stock', label: 'Stock valorizado' },
];

type Preset = 'today' | 'week' | 'month' | 'lastMonth' | 'custom';
const PRESETS: { id: Exclude<Preset, 'custom'>; label: string }[] = [
  { id: 'today', label: 'Hoy' },
  { id: 'week', label: 'Últimos 7 días' },
  { id: 'month', label: 'Este mes' },
  { id: 'lastMonth', label: 'Mes anterior' },
];

type ReportData =
  | { tab: 'sales'; data: SalesReport }
  | { tab: 'profit'; data: ProfitReport }
  | { tab: 'waste'; data: WasteReport }
  | { tab: 'purchases'; data: PurchasesReport }
  | { tab: 'stock'; data: StockResponse };

const input =
  'rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-stone-900';

function load(tab: ReportName, period: PeriodQuery): Promise<ReportData> {
  switch (tab) {
    case 'sales':
      return reportsApi.sales(period).then((data) => ({ tab, data }));
    case 'profit':
      return reportsApi.profit(period).then((data) => ({ tab, data }));
    case 'waste':
      return reportsApi.waste(period).then((data) => ({ tab, data }));
    case 'purchases':
      return reportsApi.purchases(period).then((data) => ({ tab, data }));
    case 'stock':
      return reportsApi.stock().then((data) => ({ tab, data }));
  }
}

/** Resumen general (dashboard) y reportes del período, con exportación a CSV. */
export function ReportsView() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [tab, setTab] = useState<ReportName>('sales');
  const [preset, setPreset] = useState<Preset>('month');
  // Vacío = mes actual (la API resuelve "hoy" en Argentina).
  const [period, setPeriod] = useState<PeriodQuery>({});
  const [report, setReport] = useState<ReportData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    reportsApi
      .dashboard()
      .then(setDashboard)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'No se pudo cargar'));
  }, []);

  useEffect(() => {
    let cancelled = false;
    load(tab, period)
      .then((r) => {
        if (cancelled) return;
        setReport(r);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'No se pudo cargar el reporte');
      });
    return () => {
      cancelled = true;
    };
  }, [tab, period]);

  // Fechas que se muestran: las que devolvió la API (o las elegidas a mano).
  const shownPeriod =
    report && report.tab !== 'stock' ? report.data.period : { from: period.from, to: period.to };
  const current = report?.tab === tab ? report : null;

  return (
    <section className="space-y-5">
      <h1 className="text-xl font-semibold">Reportes</h1>
      {dashboard && <DashboardCards d={dashboard} />}

      <div role="tablist" className="flex flex-wrap gap-1 border-b border-stone-200">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
              tab === t.id
                ? 'border-stone-900 text-stone-900'
                : 'border-transparent text-stone-500 hover:text-stone-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab !== 'stock' && (
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-stone-200 bg-white p-3">
          <div className="flex flex-wrap gap-1" role="group" aria-label="Período">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                aria-pressed={preset === p.id}
                disabled={!dashboard}
                onClick={() => {
                  if (!dashboard) return;
                  setPreset(p.id);
                  setPeriod(presetPeriod(p.id, dashboard.today));
                }}
                className={`rounded-md px-3 py-1.5 text-sm ${
                  preset === p.id
                    ? 'bg-stone-900 text-white'
                    : 'border border-stone-300 hover:bg-stone-100'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <label className="flex flex-col gap-1 text-xs text-stone-600">
            Desde
            <input
              type="date"
              value={shownPeriod.from ?? ''}
              onChange={(e) => {
                setPreset('custom');
                setPeriod({ from: e.target.value, to: shownPeriod.to });
              }}
              className={input}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-stone-600">
            Hasta
            <input
              type="date"
              value={shownPeriod.to ?? ''}
              onChange={(e) => {
                setPreset('custom');
                setPeriod({ from: shownPeriod.from, to: e.target.value });
              }}
              className={input}
            />
          </label>
        </div>
      )}

      {error && <Errors messages={[error]} />}
      {!current && !error && <p className="text-sm text-stone-500">Cargando…</p>}
      {current?.tab === 'sales' && <SalesSection r={current.data} period={period} />}
      {current?.tab === 'profit' && <ProfitSection r={current.data} period={period} />}
      {current?.tab === 'waste' && <WasteSection r={current.data} period={period} />}
      {current?.tab === 'purchases' && <PurchasesSection r={current.data} period={period} />}
      {current?.tab === 'stock' && <StockSection r={current.data} />}
    </section>
  );
}

function DashboardCards({ d }: { d: Dashboard }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <StatCard
        label="Ventas de hoy"
        value={formatMoney(d.salesToday.amount)}
        detail={`${d.salesToday.count} venta(s)`}
      />
      <StatCard
        label="Ventas del mes"
        value={formatMoney(d.salesMonth.amount)}
        detail={`${d.salesMonth.count} venta(s)`}
      />
      <StatCard
        label="Ganancia bruta del mes"
        value={formatMoney(d.profitMonth.profit)}
        detail={`Margen ${formatPct(d.profitMonth.marginPct)}`}
        tone={d.profitMonth.profit.startsWith('-') ? 'bad' : undefined}
      />
      <StatCard
        label="Valor del stock"
        value={formatMoney(d.stockValue)}
        detail={
          d.lowStockProducts > 0 ? (
            <Link href="/stock" className="underline">
              {d.lowStockProducts} producto(s) con stock bajo
            </Link>
          ) : (
            'Sin alertas de stock'
          )
        }
        tone={d.lowStockProducts > 0 ? 'warn' : undefined}
      />
      <StatCard
        label="Facturas de faena pendientes"
        value={formatMoney(d.invoices.pending.amount)}
        detail={
          <Link href="/" className="underline">
            {d.invoices.pending.count} factura(s)
            {d.invoices.overdue.count > 0 &&
              ` · ${d.invoices.overdue.count} vencida(s) (${formatMoney(d.invoices.overdue.amount)})`}
          </Link>
        }
        tone={d.invoices.overdue.count > 0 ? 'bad' : undefined}
      />
    </div>
  );
}

function SalesSection({ r, period }: { r: SalesReport; period: PeriodQuery }) {
  const csv = (section: string) => ({ report: 'sales' as const, section, period });
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard label="Total vendido" value={formatMoney(r.totals.amount)} />
        <StatCard label="Kg vendidos" value={formatKg(r.totals.kg, 3)} />
        <StatCard label="Ventas" value={String(r.totals.count)} />
        <StatCard
          label="Ticket promedio"
          value={r.totals.averageTicket ? formatMoney(r.totals.averageTicket) : '—'}
        />
      </div>
      <div className="rounded-lg border border-stone-200 bg-white p-4">
        <SalesByDayChart days={r.byDay} />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <ReportTable
          title="Por producto"
          rows={r.byProduct}
          rowKey={(x) => x.productId}
          csv={csv('product')}
          columns={[
            { header: 'Producto', cell: (x) => x.name, total: 'Total' },
            {
              header: 'Kg',
              cell: (x) => formatKg(x.kg, 3),
              total: formatKg(r.totals.kg, 3),
              align: 'right',
            },
            {
              header: 'Importe',
              cell: (x) => formatMoney(x.amount),
              total: formatMoney(r.totals.amount),
              align: 'right',
            },
          ]}
        />
        <ReportTable
          title="Por forma de pago"
          rows={r.byPaymentMethod}
          rowKey={(x) => x.method}
          csv={csv('payment')}
          columns={[
            { header: 'Forma de pago', cell: (x) => PAYMENT_LABELS[x.method], total: 'Total' },
            { header: 'Ventas', cell: (x) => x.count, total: r.totals.count, align: 'right' },
            {
              header: 'Importe',
              cell: (x) => formatMoney(x.amount),
              total: formatMoney(r.totals.amount),
              align: 'right',
            },
          ]}
        />
      </div>
      <ReportTable
        title="Ventas por día"
        rows={r.byDay.filter((x) => x.count > 0)}
        rowKey={(x) => x.date}
        csv={csv('day')}
        columns={[
          { header: 'Fecha', cell: (x) => formatIsoDate(x.date), total: 'Total' },
          { header: 'Ventas', cell: (x) => x.count, total: r.totals.count, align: 'right' },
          {
            header: 'Kg',
            cell: (x) => formatKg(x.kg, 3),
            total: formatKg(r.totals.kg, 3),
            align: 'right',
          },
          {
            header: 'Importe',
            cell: (x) => formatMoney(x.amount),
            total: formatMoney(r.totals.amount),
            align: 'right',
          },
        ]}
      />
    </div>
  );
}

function ProfitSection({ r, period }: { r: ProfitReport; period: PeriodQuery }) {
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard label="Ventas" value={formatMoney(r.totals.revenue)} />
        <StatCard label="Costo de lo vendido" value={formatMoney(r.totals.cost)} />
        <StatCard
          label="Ganancia bruta"
          value={formatMoney(r.totals.profit)}
          tone={r.totals.profit.startsWith('-') ? 'bad' : undefined}
        />
        <StatCard label="Margen sobre ventas" value={formatPct(r.totals.marginPct)} />
      </div>
      <ReportTable
        title="Por producto"
        rows={r.byProduct}
        rowKey={(x) => x.productId}
        csv={{ report: 'profit', section: 'product', period }}
        columns={[
          { header: 'Producto', cell: (x) => x.name, total: 'Total' },
          {
            header: 'Kg vendidos',
            cell: (x) => formatKg(x.kg, 3),
            total: formatKg(r.totals.kg, 3),
            align: 'right',
          },
          {
            header: 'Ventas',
            cell: (x) => formatMoney(x.revenue),
            total: formatMoney(r.totals.revenue),
            align: 'right',
          },
          {
            header: 'Costo',
            cell: (x) => formatMoney(x.cost),
            total: formatMoney(r.totals.cost),
            align: 'right',
          },
          {
            header: 'Ganancia',
            cell: (x) => (
              <span className={x.profit.startsWith('-') ? 'text-red-700' : ''}>
                {formatMoney(x.profit)}
              </span>
            ),
            total: formatMoney(r.totals.profit),
            align: 'right',
          },
          {
            header: 'Margen',
            cell: (x) => formatPct(x.marginPct),
            total: formatPct(r.totals.marginPct),
            align: 'right',
          },
        ]}
      />
      <p className="text-xs text-stone-500">
        Ganancia bruta = ventas − costo de lo vendido (kg × costo promedio al momento de cada
        venta). No incluye mermas ni gastos. Las ventas anuladas no cuentan.
      </p>
    </div>
  );
}

function WasteSection({ r, period }: { r: WasteReport; period: PeriodQuery }) {
  const csv = (section: string) => ({ report: 'waste' as const, section, period });
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Kg perdidos" value={formatKg(r.totals.kg, 3)} />
        <StatCard label="Valor perdido" value={formatMoney(r.totals.value)} />
        <StatCard
          label="Sobre lo comprado"
          value={formatPct(r.totals.pctOfPurchased)}
          detail={`${formatKg(r.totals.purchasedKg, 3)} comprados en el período`}
        />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <ReportTable
          title="Por motivo"
          rows={r.byReason}
          rowKey={(x) => x.reason}
          csv={csv('reason')}
          columns={[
            { header: 'Motivo', cell: (x) => x.reason, total: 'Total' },
            { header: 'Registros', cell: (x) => x.count, align: 'right' },
            {
              header: 'Kg',
              cell: (x) => formatKg(x.kg, 3),
              total: formatKg(r.totals.kg, 3),
              align: 'right',
            },
            {
              header: 'Valor',
              cell: (x) => formatMoney(x.value),
              total: formatMoney(r.totals.value),
              align: 'right',
            },
          ]}
        />
        <ReportTable
          title="Por producto"
          rows={r.byProduct}
          rowKey={(x) => x.productId}
          csv={csv('product')}
          columns={[
            { header: 'Producto', cell: (x) => x.name, total: 'Total' },
            {
              header: 'Kg',
              cell: (x) => formatKg(x.kg, 3),
              total: formatKg(r.totals.kg, 3),
              align: 'right',
            },
            {
              header: 'Valor',
              cell: (x) => formatMoney(x.value),
              total: formatMoney(r.totals.value),
              align: 'right',
            },
            {
              header: '% comprado',
              cell: (x) => formatPct(x.pctOfPurchased),
              total: formatPct(r.totals.pctOfPurchased),
              align: 'right',
            },
          ]}
        />
      </div>
      <p className="text-xs text-stone-500">
        Solo mermas (los ajustes por conteo no se cuentan). Valor al costo promedio del momento en
        que se registró cada merma.
      </p>
    </div>
  );
}

function PurchasesSection({ r, period }: { r: PurchasesReport; period: PeriodQuery }) {
  const csv = (section: string) => ({ report: 'purchases' as const, section, period });
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Monto comprado" value={formatMoney(r.totals.amount)} />
        <StatCard label="Kg comprados" value={formatKg(r.totals.kg, 3)} />
        <StatCard label="Ingresos" value={String(r.totals.count)} />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <ReportTable
          title="Por proveedor"
          rows={r.bySupplier}
          rowKey={(x) => x.supplierId}
          csv={csv('supplier')}
          columns={[
            { header: 'Proveedor', cell: (x) => x.name, total: 'Total' },
            { header: 'Ingresos', cell: (x) => x.count, total: r.totals.count, align: 'right' },
            {
              header: 'Kg',
              cell: (x) => formatKg(x.kg, 3),
              total: formatKg(r.totals.kg, 3),
              align: 'right',
            },
            {
              header: 'Monto',
              cell: (x) => formatMoney(x.amount),
              total: formatMoney(r.totals.amount),
              align: 'right',
            },
          ]}
        />
        <ReportTable
          title="Por producto"
          rows={r.byProduct}
          rowKey={(x) => x.productId}
          csv={csv('product')}
          columns={[
            { header: 'Producto', cell: (x) => x.name, total: 'Total' },
            {
              header: 'Kg',
              cell: (x) => formatKg(x.kg, 3),
              total: formatKg(r.totals.kg, 3),
              align: 'right',
            },
            {
              header: 'Monto',
              cell: (x) => formatMoney(x.amount),
              total: formatMoney(r.totals.amount),
              align: 'right',
            },
            {
              header: 'Costo prom./kg',
              cell: (x) => formatMoney(x.averageCost),
              align: 'right',
            },
          ]}
        />
      </div>
    </div>
  );
}

function StockSection({ r }: { r: StockResponse }) {
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Valor del stock" value={formatMoney(r.totals.value)} />
        <StatCard label="Productos" value={String(r.totals.products)} />
        <StatCard
          label="Con stock bajo"
          value={String(r.totals.lowStock)}
          tone={r.totals.lowStock > 0 ? 'warn' : undefined}
        />
      </div>
      <ReportTable
        title="Stock valorizado (al día de hoy)"
        rows={r.items}
        rowKey={(x) => x.productId}
        csv={{ report: 'stock', section: 'product', period: {} }}
        columns={[
          { header: 'Producto', cell: (x) => x.name, total: 'Total' },
          { header: 'Categoría', cell: (x) => x.category ?? '—' },
          { header: 'Kg', cell: (x) => formatKg(x.kg, 3), align: 'right' },
          { header: 'Costo promedio', cell: (x) => formatMoney(x.avgCost), align: 'right' },
          {
            header: 'Valor',
            cell: (x) => formatMoney(x.value),
            total: formatMoney(r.totals.value),
            align: 'right',
          },
        ]}
      />
    </div>
  );
}
