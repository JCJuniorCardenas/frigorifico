'use client';

import { type FormEvent, useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { ConfirmDialog } from '@/components/invoices/invoice-dialogs';
import { Modal } from '@/components/ui/modal';
import { type Supplier, type SupplierInput, catalogApi, formatCuit } from '@/lib/catalog';
import {
  Errors,
  Field,
  ListToolbar,
  StatusBadge,
  errorMessages,
  inputClass,
  matches,
  primaryButton,
  rowButton,
  secondaryButton,
  useList,
} from './catalog-ui';

type Dialog =
  { kind: 'form'; supplier: Supplier | null } | { kind: 'delete'; supplier: Supplier } | null;

export function SuppliersPanel({ onNotice }: { onNotice: (message: string) => void }) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const { items, error, reload } = useList(() => catalogApi.suppliers());
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const digits = search.replace(/\D/g, '');
  const visible = (items ?? []).filter(
    (s) =>
      (showInactive || s.active) &&
      (matches(s.name, search) || (digits !== '' && s.cuit !== null && s.cuit.includes(digits))),
  );

  async function toggleActive(supplier: Supplier) {
    setBusyId(supplier.id);
    setRowError(null);
    try {
      await catalogApi.updateSupplier(supplier.id, { active: !supplier.active });
      onNotice(`${supplier.name} ${supplier.active ? 'desactivado' : 'activado'}`);
      reload();
    } catch (e) {
      setRowError(errorMessages(e).join('. '));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-3">
      <ListToolbar
        search={search}
        onSearch={setSearch}
        placeholder="Buscar por nombre o CUIT"
        showInactive={showInactive}
        onShowInactive={setShowInactive}
        newLabel="Nuevo proveedor"
        onNew={() => setDialog({ kind: 'form', supplier: null })}
      />
      {(error ?? rowError) && <Errors messages={[(error ?? rowError) as string]} />}

      <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-stone-200 bg-stone-50 text-stone-600">
            <tr>
              <th className="px-4 py-2 font-medium">Proveedor</th>
              <th className="px-4 py-2 font-medium">CUIT</th>
              <th className="px-4 py-2 font-medium">Teléfono</th>
              <th className="px-4 py-2 font-medium">Estado</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {items === null && !error && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-stone-500">
                  Cargando…
                </td>
              </tr>
            )}
            {items !== null && visible.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-stone-500">
                  {items.length === 0
                    ? 'Todavía no hay proveedores. Cargalos con “Nuevo proveedor”.'
                    : search.trim() === ''
                      ? 'No hay proveedores activos. Marcá “Mostrar inactivos” para ver los demás.'
                      : 'Ningún proveedor coincide con la búsqueda.'}
                </td>
              </tr>
            )}
            {visible.map((s) => (
              <tr
                key={s.id}
                className={`border-b border-stone-100 last:border-0 ${s.active ? '' : 'text-stone-500'}`}
              >
                <td className="px-4 py-2 font-medium">{s.name}</td>
                <td className="px-4 py-2 tabular-nums">{s.cuit ? formatCuit(s.cuit) : '—'}</td>
                <td className="px-4 py-2">{s.phone ?? '—'}</td>
                <td className="px-4 py-2">
                  <StatusBadge active={s.active} />
                </td>
                <td className="px-4 py-2">
                  <div className="flex justify-end gap-1.5">
                    <button
                      type="button"
                      className={rowButton}
                      onClick={() => setDialog({ kind: 'form', supplier: s })}
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      className={rowButton}
                      disabled={busyId === s.id}
                      onClick={() => void toggleActive(s)}
                    >
                      {s.active ? 'Desactivar' : 'Activar'}
                    </button>
                    {isAdmin && (
                      <button
                        type="button"
                        className={`${rowButton} text-red-700`}
                        onClick={() => setDialog({ kind: 'delete', supplier: s })}
                      >
                        Borrar
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {dialog?.kind === 'form' && (
        <SupplierDialog
          supplier={dialog.supplier}
          onClose={() => setDialog(null)}
          onSaved={(message) => {
            setDialog(null);
            onNotice(message);
            reload();
          }}
        />
      )}
      {dialog?.kind === 'delete' && (
        <ConfirmDialog
          title="Borrar proveedor"
          confirmLabel="Borrar"
          destructive
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await catalogApi.deleteSupplier(dialog.supplier.id);
            setDialog(null);
            onNotice(`${dialog.supplier.name} borrado`);
            reload();
          }}
        >
          <p>
            ¿Borrar <strong>{dialog.supplier.name}</strong>? Esta acción no se puede deshacer.
          </p>
          <p className="mt-2 text-stone-500">
            Si el proveedor ya tiene ingresos de mercadería no se puede borrar: desactivalo.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}

function SupplierDialog({
  supplier,
  onClose,
  onSaved,
}: {
  supplier: Supplier | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const text = (key: string) => String(form.get(key) ?? '').trim();
    const data: SupplierInput = {
      name: text('name'),
      cuit: text('cuit') || null,
      phone: text('phone') || null,
    };
    setSaving(true);
    setErrors([]);
    try {
      if (supplier) {
        await catalogApi.updateSupplier(supplier.id, data);
        onSaved(`${data.name} actualizado`);
      } else {
        await catalogApi.createSupplier(data);
        onSaved(`${data.name} creado`);
      }
    } catch (err) {
      setErrors(errorMessages(err));
      setSaving(false);
    }
  }

  return (
    <Modal title={supplier ? 'Editar proveedor' : 'Nuevo proveedor'} onClose={onClose}>
      <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
        <Field label="Nombre o razón social">
          <input
            name="name"
            required
            minLength={2}
            maxLength={150}
            defaultValue={supplier?.name}
            className={inputClass}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="CUIT (opcional)" hint="Con o sin guiones.">
            <input
              name="cuit"
              inputMode="numeric"
              defaultValue={supplier?.cuit ? formatCuit(supplier.cuit) : ''}
              placeholder="30-12345678-9"
              className={inputClass}
            />
          </Field>
          <Field label="Teléfono (opcional)">
            <input
              name="phone"
              type="tel"
              defaultValue={supplier?.phone ?? ''}
              className={inputClass}
            />
          </Field>
        </div>
        <Errors messages={errors} />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving} className={secondaryButton}>
            Cancelar
          </button>
          <button type="submit" disabled={saving} className={primaryButton}>
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
