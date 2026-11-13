'use client';

import { useEffect } from 'react';

export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <h1 className="text-lg font-semibold">Algo salió mal</h1>
      <p className="max-w-md text-sm text-stone-600">
        Ocurrió un error inesperado al mostrar esta pantalla. Probá de nuevo; si sigue pasando,
        recargá la página.
      </p>
      <button
        type="button"
        onClick={() => retry()}
        className="rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800"
      >
        Reintentar
      </button>
    </main>
  );
}
