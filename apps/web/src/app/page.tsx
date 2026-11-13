import { Suspense } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

async function ApiStatus() {
  let ok = false;
  try {
    const res = await fetch(`${API_URL}/health`, { cache: 'no-store' });
    ok = res.ok;
  } catch {
    ok = false;
  }
  return (
    <p className={ok ? 'text-green-700' : 'text-red-700'}>
      API y base de datos: {ok ? 'conectadas' : 'sin conexión'}
    </p>
  );
}

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-2xl font-semibold">Control de facturas de faena</h1>
      <Suspense fallback={<p className="text-neutral-500">Verificando conexión…</p>}>
        <ApiStatus />
      </Suspense>
    </main>
  );
}
