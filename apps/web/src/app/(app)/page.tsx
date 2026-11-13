import Link from 'next/link';

export default function InvoicesPage() {
  return (
    <section className="rounded-lg border border-dashed border-stone-300 bg-white p-8 text-center">
      <h1 className="text-lg font-semibold">Facturas</h1>
      <p className="mt-2 text-sm text-stone-600">
        La tabla de control con pagos y vencimientos llega en la fase 5.
      </p>
      <Link
        href="/cargar"
        className="mt-4 inline-block rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800"
      >
        Cargar facturas
      </Link>
    </section>
  );
}
