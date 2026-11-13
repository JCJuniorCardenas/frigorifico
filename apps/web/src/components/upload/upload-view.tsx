'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ErrorCode, type FileRejection, useDropzone } from 'react-dropzone';
import { ApiError } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { type DuplicateInfo, type Invoice, parseInvoicePdf } from '@/lib/invoices';
import { InvoiceReviewForm } from './invoice-review-form';
import {
  duplicateMessage,
  type QueueItem,
  runWithLimit,
  STATUS_LABELS,
  STATUS_STYLES,
} from './upload-queue';

const MAX_BYTES = 5 * 1024 * 1024;
/** PDFs que se procesan al mismo tiempo. */
const PARSE_CONCURRENCY = 2;

function rejectionMessage(rejection: FileRejection): string {
  const code = rejection.errors[0]?.code;
  if (code === ErrorCode.FileTooLarge) return 'El archivo supera el máximo de 5 MB.';
  if (code === ErrorCode.FileInvalidType) return 'Solo se aceptan archivos PDF.';
  return rejection.errors[0]?.message ?? 'Archivo no válido.';
}

let nextId = 0;
const newId = () => `f${Date.now()}-${nextId++}`;

export function UploadView() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // URLs locales de los PDFs: se liberan al quitar un archivo o al salir de la pantalla.
  const previewUrls = useRef(new Set<string>());
  useEffect(() => {
    const urls = previewUrls.current;
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
    };
  }, []);

  const update = useCallback((id: string, patch: Partial<QueueItem>) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

  const processItem = useCallback(
    async (item: QueueItem) => {
      update(item.id, { status: 'parsing' });
      try {
        const parse = await parseInvoicePdf(item.file);
        update(item.id, { status: 'ready', parse });
        // Si no hay ninguna en revisión, se abre la primera que queda lista.
        setSelectedId((current) => current ?? item.id);
      } catch (error) {
        if (error instanceof ApiError && error.status === 409 && error.body.duplicate) {
          update(item.id, {
            status: 'duplicate',
            duplicate: error.body.duplicate as DuplicateInfo,
          });
        } else {
          update(item.id, {
            status: 'error',
            error: error instanceof Error ? error.message : 'No se pudo procesar el PDF.',
          });
        }
      }
    },
    [update],
  );

  const onDrop = useCallback(
    (accepted: File[], rejected: FileRejection[]) => {
      const newItems: QueueItem[] = accepted.map((file) => {
        const previewUrl = URL.createObjectURL(file);
        previewUrls.current.add(previewUrl);
        return { id: newId(), file, previewUrl, status: 'queued' };
      });
      const rejectedItems: QueueItem[] = rejected.map((r) => ({
        id: newId(),
        file: r.file,
        previewUrl: null,
        status: 'error',
        error: rejectionMessage(r),
      }));
      setItems((prev) => [...prev, ...newItems, ...rejectedItems]);
      void runWithLimit(newItems, PARSE_CONCURRENCY, processItem);
    },
    [processItem],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'] },
    maxSize: MAX_BYTES,
    multiple: true,
  });

  function removeItem(id: string) {
    const item = items.find((i) => i.id === id);
    if (item?.previewUrl) {
      URL.revokeObjectURL(item.previewUrl);
      previewUrls.current.delete(item.previewUrl);
    }
    setItems((prev) => prev.filter((i) => i.id !== id));
    if (selectedId === id) setSelectedId(null);
  }

  function nextReadyId(afterId: string): string | null {
    return items.find((i) => i.id !== afterId && i.status === 'ready')?.id ?? null;
  }

  function handleSaved(id: string, invoice: Invoice) {
    update(id, { status: 'saved', saved: invoice });
    setSelectedId(nextReadyId(id));
  }

  function handleDuplicate(id: string, duplicate: DuplicateInfo) {
    update(id, { status: 'duplicate', duplicate });
    setSelectedId(nextReadyId(id));
  }

  const selected = items.find((i) => i.id === selectedId && i.status === 'ready');
  const pending = items.filter((i) => i.status === 'ready').length;
  const finished = items.filter((i) => ['saved', 'duplicate', 'error'].includes(i.status));

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Cargar facturas</h1>
          <p className="text-sm text-stone-600">
            Arrastrá uno o varios PDF. Revisá los datos de cada factura antes de guardarla.
          </p>
        </div>
        {finished.length > 0 && (
          <button
            type="button"
            onClick={() => finished.forEach((i) => removeItem(i.id))}
            className="text-sm text-stone-600 underline hover:text-stone-900"
          >
            Limpiar terminadas ({finished.length})
          </button>
        )}
      </div>

      <div
        {...getRootProps()}
        className={`cursor-pointer rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
          isDragActive
            ? 'border-stone-900 bg-stone-100'
            : 'border-stone-300 bg-white hover:border-stone-500'
        }`}
      >
        <input {...getInputProps()} aria-label="Elegir archivos PDF" />
        <p className="font-medium">
          {isDragActive ? 'Soltá los PDF acá' : 'Arrastrá los PDF de facturas acá'}
        </p>
        <p className="mt-1 text-sm text-stone-500">
          o hacé clic para elegirlos · máximo 5 MB cada uno
        </p>
      </div>

      {items.length > 0 && (
        <ul className="divide-y divide-stone-100 rounded-lg border border-stone-200 bg-white">
          {items.map((item) => (
            <QueueRow
              key={item.id}
              item={item}
              selected={item.id === selectedId}
              onReview={() => setSelectedId(item.id)}
              onRemove={() => removeItem(item.id)}
            />
          ))}
        </ul>
      )}

      {selected?.parse && selected.previewUrl ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <object
            data={selected.previewUrl}
            type="application/pdf"
            title={`PDF ${selected.file.name}`}
            className="h-[75vh] w-full rounded-lg border border-stone-200 bg-white"
          >
            <p className="p-4 text-sm text-stone-600">
              El navegador no puede mostrar el PDF. Los datos extraídos están a la derecha.
            </p>
          </object>
          <InvoiceReviewForm
            key={selected.id}
            file={selected.file}
            parse={selected.parse}
            onSaving={() => update(selected.id, { status: 'saving' })}
            onFailed={() => update(selected.id, { status: 'ready' })}
            onSaved={(invoice) => handleSaved(selected.id, invoice)}
            onDuplicate={(duplicate) => handleDuplicate(selected.id, duplicate)}
            onSkip={() => setSelectedId(nextReadyId(selected.id))}
          />
        </div>
      ) : (
        pending > 0 && (
          <p className="text-sm text-stone-600">
            Hay {pending} factura(s) listas para revisar. Elegí una de la lista.
          </p>
        )
      )}
    </section>
  );
}

function QueueRow({
  item,
  selected,
  onReview,
  onRemove,
}: {
  item: QueueItem;
  selected: boolean;
  onReview: () => void;
  onRemove: () => void;
}) {
  const busy = item.status === 'parsing' || item.status === 'saving';
  let detail: string | null = null;
  if (item.status === 'error') detail = item.error ?? null;
  if (item.status === 'duplicate' && item.duplicate) detail = duplicateMessage(item.duplicate);
  if (item.status === 'saved' && item.saved) {
    detail = `${item.saved.clientName} · tropa ${item.saved.herdNumber} · ${formatMoney(item.saved.totalAmount)}`;
  }
  if (item.status === 'ready' && item.parse?.needsReview) {
    detail = `${item.parse.warnings.length} advertencia(s) para revisar`;
  }

  return (
    <li
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm ${
        selected ? 'bg-amber-50' : ''
      }`}
    >
      <span className="min-w-0 flex-1 truncate font-medium" title={item.file.name}>
        {item.file.name}
      </span>
      <span className={`rounded px-2 py-0.5 text-xs ${STATUS_STYLES[item.status]}`}>
        {STATUS_LABELS[item.status]}
      </span>
      {item.status === 'ready' && !selected && (
        <button
          type="button"
          onClick={onReview}
          className="rounded-md bg-stone-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-stone-800"
        >
          Revisar
        </button>
      )}
      {!busy && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Quitar ${item.file.name}`}
          className="rounded-md px-2 py-1 text-xs text-stone-500 hover:bg-stone-100 hover:text-stone-900"
        >
          Quitar
        </button>
      )}
      {detail && <p className="basis-full text-xs text-stone-600">{detail}</p>}
    </li>
  );
}
