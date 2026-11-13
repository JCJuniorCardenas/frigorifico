'use client';

import { useState } from 'react';
import { ProductsPanel } from './products-panel';
import { SuppliersPanel } from './suppliers-panel';

type Tab = 'products' | 'suppliers';

const TABS: { id: Tab; label: string }[] = [
  { id: 'products', label: 'Productos' },
  { id: 'suppliers', label: 'Proveedores' },
];

/** Catálogo del módulo de stock: productos (cortes) y proveedores. */
export function CatalogView() {
  const [tab, setTab] = useState<Tab>('products');
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold">Catálogo</h1>
      <div role="tablist" className="flex gap-1 border-b border-stone-200">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => {
              setTab(t.id);
              setNotice(null);
            }}
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
      {notice && (
        <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
          {notice}
        </p>
      )}
      {tab === 'products' ? (
        <ProductsPanel onNotice={setNotice} />
      ) : (
        <SuppliersPanel onNotice={setNotice} />
      )}
    </section>
  );
}
