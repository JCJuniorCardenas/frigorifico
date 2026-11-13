import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <h1 className="text-lg font-semibold">Página no encontrada</h1>
      <p className="text-sm text-stone-600">La dirección no existe o fue movida.</p>
      <Link
        href="/"
        className="rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800"
      >
        Ir a facturas
      </Link>
    </main>
  );
}
