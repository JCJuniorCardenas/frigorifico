'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { formatKg, formatMoney } from '@/lib/format';
import {
  type ClientOption,
  type InvoiceListItem,
  type InvoiceListResponse,
  type InvoiceQuery,
  invoicesApi,
  type InvoiceSummary,
  type SortField,
} from '@/lib/invoices';
import { ConfirmDialog, EditDialog, PayDialog } from './invoice-dialogs';
import { type FilterValues, InvoiceFilters } from './invoice-filters';
import { InvoiceTable } from './invoice-table';
import { SummaryCards, type SummaryKey } from './summary-cards';

const DEFAULT_FILTERS: FilterValues = {
  search: '',
  status: 'pending',
  clientCuit: '',
  dateField: 'issue',
  from: '',
  to: '',
};

const PAGE_SIZES = [25, 50, 100];

type Dialog =
  | { type: 'pay'; invoices: InvoiceListItem[] }
  | { type: 'revert'; invoices: InvoiceListItem[] }
  | { type: 'edit'; invoice: InvoiceListItem }
  | { type: 'delete'; invoice: InvoiceListItem };

/** "2026-11-13" + n días, sin pasar por la zona horaria local. */
function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function InvoicesView() {
  const { user } = useAuth();
  const [filters, setFilters] = useState<FilterValues>(DEFAULT_FILTERS);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortField | undefined>();
  const [dir, setDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const [data, setData] = useState<InvoiceListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [summary, setSummary] = useState<InvoiceSummary | null>(null);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [reloadKey, setReloadKey] = useState(0);

  const [selected, setSelected] = useState<Map<string, InvoiceListItem>>(new Map());
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // La búsqueda espera a que se deje de tipear.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(filters.search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [filters.search]);

  const query: InvoiceQuery = useMemo(
    () => ({
      q: search || undefined,
      status: filters.status,
      clientCuit: filters.clientCuit || undefined,
      dateField: filters.dateField,
      from: filters.from || undefined,
      to: filters.to || undefined,
      sort,
      dir: sort ? dir : undefined,
      page,
      pageSize,
    }),
    [
      search,
      filters.status,
      filters.clientCuit,
      filters.dateField,
      filters.from,
      filters.to,
      sort,
      dir,
      page,
      pageSize,
    ],
  );

  useEffect(() => {
    let cancelled = false;
    invoicesApi
      .list(query)
      .then((res) => {
        if (cancelled) return;
        setData(res);
        setLoadError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : 'No se pudo cargar la tabla');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [query, reloadKey]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([invoicesApi.summary(), invoicesApi.clients()])
      .then(([s, c]) => {
        if (cancelled) return;
        setSummary(s);
        setClients(c);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const today = data?.today ?? summary?.today ?? '';

  function changeFilters(patch: Partial<FilterValues>) {
    setFilters((prev) => ({ ...prev, ...patch }));
    if (!('search' in patch)) setPage(1);
    setLoading(true);
    setSelected(new Map());
  }

  function selectCard(key: SummaryKey) {
    const base = { ...DEFAULT_FILTERS, search: filters.search };
    if (key === 'pending') changeFilters(base);
    if (key === 'overdue') changeFilters({ ...base, status: 'overdue' });
    if (key === 'collectedThisMonth') changeFilters({ ...base, status: 'paid' });
    if (key === 'dueThisWeek' && today) {
      changeFilters({
        ...base,
        status: 'pending',
        dateField: 'due',
        from: today,
        to: addDaysIso(today, 7),
      });
    }
  }

  const activeCard: SummaryKey | null = (() => {
    const noExtra = !filters.clientCuit;
    const noDates = !filters.from && !filters.to;
    if (!noExtra) return null;
    if (filters.status === 'pending' && noDates) return 'pending';
    if (filters.status === 'overdue' && noDates) return 'overdue';
    if (filters.status === 'paid' && noDates) return 'collectedThisMonth';
    if (
      filters.status === 'pending' &&
      filters.dateField === 'due' &&
      today &&
      filters.from === today &&
      filters.to === addDaysIso(today, 7)
    )
      return 'dueThisWeek';
    return null;
  })();

  const effectiveSort: SortField =
    sort ?? (filters.status === 'paid' ? 'paidAt' : 'paymentDueDate');
  const effectiveDir = sort ? dir : filters.status === 'paid' ? 'desc' : 'asc';

  function onSort(field: SortField) {
    if (field === effectiveSort) {
      setSort(field);
      setDir(effectiveDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSort(field);
      setDir('asc');
    }
    setPage(1);
    setLoading(true);
  }

  function toggle(id: string) {
    const item = data?.items.find((i) => i.id === id);
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(id)) next.delete(id);
      else if (item) next.set(id, item);
      return next;
    });
  }

  function toggleAll(checked: boolean) {
    setSelected((prev) => {
      const next = new Map(prev);
      for (const item of data?.items ?? []) {
        if (checked) next.set(item.id, item);
        else next.delete(item.id);
      }
      return next;
    });
  }

  function afterChange(message: string) {
    setDialog(null);
    setNotice(message);
    setSelected(new Map());
    setLoading(true);
    setReloadKey((k) => k + 1);
  }

  async function pay(invoices: InvoiceListItem[], paidAt: string) {
    if (invoices.length === 1) {
      await invoicesApi.setStatus(invoices[0].id, 'PAID', paidAt);
      afterChange('Factura marcada como pagada.');
    } else {
      const res = await invoicesApi.setStatusBulk(
        invoices.map((i) => i.id),
        'PAID',
        paidAt,
      );
      afterChange(`${res.changed} factura(s) marcadas como pagadas.`);
    }
  }

  async function revert(invoices: InvoiceListItem[]) {
    if (invoices.length === 1) {
      await invoicesApi.setStatus(invoices[0].id, 'PENDING');
      afterChange('La factura volvió a pendiente.');
    } else {
      const res = await invoicesApi.setStatusBulk(
        invoices.map((i) => i.id),
        'PENDING',
      );
      afterChange(`${res.changed} factura(s) volvieron a pendiente.`);
    }
  }

  const totals = data?.totals;
  const totalPages = totals ? Math.max(1, Math.ceil(totals.count / pageSize)) : 1;
  const selectedItems = [...selected.values()];
  const selectedPending = selectedItems.filter((i) => i.status === 'PENDING');
  const selectedPaid = selectedItems.filter((i) => i.status === 'PAID');

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Facturas</h1>
        <Link
          href="/cargar"
          className="rounded-md bg-stone-900 px-3 py-2 text-sm font-medium text-white hover:bg-stone-800"
        >
          Cargar facturas
        </Link>
      </div>

      <SummaryCards summary={summary} active={activeCard} onSelect={selectCard} />

      <InvoiceFilters
        values={filters}
        clients={clients}
        onChange={changeFilters}
        onReset={() => changeFilters(DEFAULT_FILTERS)}
      />

      {notice && (
        <p className="flex items-center justify-between rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
          {notice}
          <button type="button" onClick={() => setNotice(null)} className="text-xs underline">
            Cerrar
          </button>
        </p>
      )}
      {loadError && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{loadError}</p>
      )}

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-stone-300 bg-stone-900 px-3 py-2 text-sm text-white">
          <span>{selected.size} seleccionada(s)</span>
          {selectedPending.length > 0 && (
            <button
              type="button"
              onClick={() => setDialog({ type: 'pay', invoices: selectedPending })}
              className="rounded-md bg-white px-2.5 py-1 font-medium text-stone-900 hover:bg-stone-100"
            >
              Marcar {selectedPending.length} como pagadas
            </button>
          )}
          {selectedPaid.length > 0 && (
            <button
              type="button"
              onClick={() => setDialog({ type: 'revert', invoices: selectedPaid })}
              className="rounded-md border border-white/40 px-2.5 py-1 hover:bg-white/10"
            >
              Volver {selectedPaid.length} a pendiente
            </button>
          )}
          <button
            type="button"
            onClick={() => setSelected(new Map())}
            className="ml-auto text-xs underline"
          >
            Quitar selección
          </button>
        </div>
      )}

      <InvoiceTable
        items={data?.items ?? []}
        loading={loading}
        sort={effectiveSort}
        dir={effectiveDir}
        onSort={onSort}
        selected={new Set(selected.keys())}
        onToggle={toggle}
        onToggleAll={toggleAll}
        actions={{
          onPay: (inv) => setDialog({ type: 'pay', invoices: [inv] }),
          onRevert: (inv) => setDialog({ type: 'revert', invoices: [inv] }),
          onEdit: (inv) => setDialog({ type: 'edit', invoice: inv }),
          onDelete:
            user?.role === 'ADMIN'
              ? (inv) => setDialog({ type: 'delete', invoice: inv })
              : undefined,
        }}
      />

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <p className="text-stone-700">
          {totals ? (
            <>
              <strong>{totals.count}</strong> factura(s) · {formatKg(totals.kg)} ·{' '}
              <strong>{formatMoney(totals.amount)}</strong>
            </>
          ) : (
            '—'
          )}
        </p>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-stone-600">
            Por página
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
                setLoading(true);
              }}
              className="rounded-md border border-stone-300 bg-white px-1.5 py-1"
            >
              {PAGE_SIZES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => {
              setPage((p) => p - 1);
              setLoading(true);
            }}
            className="rounded-md border border-stone-300 px-2.5 py-1 hover:bg-stone-100 disabled:opacity-40"
          >
            Anterior
          </button>
          <span className="text-stone-600 tabular-nums">
            {page} de {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => {
              setPage((p) => p + 1);
              setLoading(true);
            }}
            className="rounded-md border border-stone-300 px-2.5 py-1 hover:bg-stone-100 disabled:opacity-40"
          >
            Siguiente
          </button>
        </div>
      </div>

      {dialog?.type === 'pay' && (
        <PayDialog
          invoices={dialog.invoices}
          today={today}
          onConfirm={(paidAt) => pay(dialog.invoices, paidAt)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.type === 'revert' && (
        <ConfirmDialog
          title={
            dialog.invoices.length === 1
              ? 'Volver a pendiente'
              : `Volver ${dialog.invoices.length} facturas a pendiente`
          }
          confirmLabel="Volver a pendiente"
          onConfirm={() => revert(dialog.invoices)}
          onClose={() => setDialog(null)}
        >
          Se borra la fecha de pago y la factura vuelve a contar como pendiente (y como vencida si
          ya pasó su vencimiento). El cambio queda registrado.
        </ConfirmDialog>
      )}
      {dialog?.type === 'edit' && (
        <EditDialog
          invoice={dialog.invoice}
          onSave={async (values) => {
            await invoicesApi.update(dialog.invoice.id, values);
            afterChange('Factura actualizada.');
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.type === 'delete' && (
        <ConfirmDialog
          title="Eliminar factura"
          confirmLabel="Eliminar"
          destructive
          onConfirm={async () => {
            await invoicesApi.remove(dialog.invoice.id);
            afterChange('Factura eliminada.');
          }}
          onClose={() => setDialog(null)}
        >
          ¿Eliminar la factura {dialog.invoice.salesPoint}-{dialog.invoice.voucherNumber} de{' '}
          {dialog.invoice.clientName} por {formatMoney(dialog.invoice.totalAmount)}? Se borran
          también su PDF y su historial. No se puede deshacer.
        </ConfirmDialog>
      )}
    </section>
  );
}
