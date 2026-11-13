'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { ApiError, api } from '@/lib/api';
import type { ManagedUser, Role } from '@/lib/types';

const dateFormat = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'America/Argentina/Buenos_Aires',
});

type Editing = { mode: 'create' } | { mode: 'edit'; user: ManagedUser };

export function UsersView() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<ManagedUser[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Se incrementa para volver a pedir la lista (después de crear o editar).
  const [reloadKey, setReloadKey] = useState(0);

  const isAdmin = me?.role === 'ADMIN';

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    api
      .get<ManagedUser[]>('/users')
      .then((list) => {
        if (cancelled) return;
        setUsers(list);
        setLoadError(null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setLoadError(e instanceof Error ? e.message : 'No se pudieron cargar los usuarios');
      });
    return () => {
      cancelled = true;
    };
  }, [isAdmin, reloadKey]);

  if (!me) {
    return <p className="text-stone-500">Cargando…</p>;
  }
  if (!isAdmin) {
    return <p className="text-stone-600">No tenés permisos para ver esta sección.</p>;
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">Usuarios</h1>
        <button
          type="button"
          onClick={() => setEditing({ mode: 'create' })}
          className="rounded-md bg-stone-900 px-3 py-2 text-sm font-medium text-white hover:bg-stone-800"
        >
          Nuevo usuario
        </button>
      </div>

      {notice && (
        <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">{notice}</p>
      )}
      {loadError && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{loadError}</p>
      )}

      <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-stone-200 bg-stone-50 text-stone-600">
            <tr>
              <th className="px-4 py-2 font-medium">Nombre</th>
              <th className="px-4 py-2 font-medium">Email</th>
              <th className="px-4 py-2 font-medium">Rol</th>
              <th className="px-4 py-2 font-medium">Estado</th>
              <th className="px-4 py-2 font-medium">Alta</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {users === null && !loadError && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-stone-500">
                  Cargando…
                </td>
              </tr>
            )}
            {users?.map((u) => (
              <tr key={u.id} className="border-b border-stone-100 last:border-0">
                <td className="px-4 py-2">
                  {u.name}
                  {u.id === me.id && <span className="ml-2 text-xs text-stone-500">(vos)</span>}
                </td>
                <td className="px-4 py-2 text-stone-700">{u.email}</td>
                <td className="px-4 py-2">{u.role === 'ADMIN' ? 'Administrador' : 'Usuario'}</td>
                <td className="px-4 py-2">
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs ${
                      u.active ? 'bg-green-100 text-green-800' : 'bg-stone-200 text-stone-600'
                    }`}
                  >
                    {u.active ? 'Activo' : 'Inactivo'}
                  </span>
                </td>
                <td className="px-4 py-2 text-stone-600">
                  {dateFormat.format(new Date(u.createdAt))}
                </td>
                <td className="px-4 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => setEditing({ mode: 'edit', user: u })}
                    className="rounded-md border border-stone-300 px-2.5 py-1 text-xs hover:bg-stone-100"
                  >
                    Editar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <UserDialog
          editing={editing}
          isSelf={editing.mode === 'edit' && editing.user.id === me.id}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            setEditing(null);
            setNotice(message);
            setReloadKey((k) => k + 1);
          }}
        />
      )}
    </section>
  );
}

function UserDialog({
  editing,
  isSelf,
  onClose,
  onSaved,
}: {
  editing: Editing;
  isSelf: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const existing = editing.mode === 'edit' ? editing.user : null;
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const name = String(form.get('name') ?? '');
    const email = String(form.get('email') ?? '');
    const password = String(form.get('password') ?? '');
    const role = String(form.get('role') ?? 'USER') as Role;

    setSaving(true);
    setError(null);
    try {
      if (existing) {
        const body: Record<string, unknown> = { name, email };
        if (!isSelf) {
          body.role = role;
          body.active = form.get('active') === 'on';
        }
        if (password) body.password = password;
        await api.patch(`/users/${existing.id}`, body);
        onSaved(`Usuario ${name} actualizado`);
      } else {
        await api.post('/users', { name, email, password, role });
        onSaved(`Usuario ${name} creado`);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo guardar');
      setSaving(false);
    }
  }

  const inputClass =
    'w-full rounded-md border border-stone-300 px-3 py-2 outline-none focus:border-stone-900';

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-10 flex items-center justify-center bg-black/30 p-4"
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <form
        onSubmit={(e) => void onSubmit(e)}
        className="w-full max-w-md space-y-4 rounded-lg bg-white p-6 shadow-lg"
      >
        <h2 className="text-lg font-semibold">{existing ? 'Editar usuario' : 'Nuevo usuario'}</h2>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Nombre</span>
          <input
            name="name"
            required
            minLength={2}
            defaultValue={existing?.name}
            autoFocus
            className={inputClass}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Email</span>
          <input
            name="email"
            type="email"
            required
            defaultValue={existing?.email}
            autoComplete="off"
            className={inputClass}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">
            {existing ? 'Nueva contraseña (dejar vacío para no cambiarla)' : 'Contraseña'}
          </span>
          <input
            name="password"
            type="password"
            required={!existing}
            minLength={8}
            autoComplete="new-password"
            className={inputClass}
          />
          <span className="mt-1 block text-xs text-stone-500">Mínimo 8 caracteres.</span>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Rol</span>
          <select
            name="role"
            defaultValue={existing?.role ?? 'USER'}
            disabled={isSelf}
            className={inputClass}
          >
            <option value="USER">Usuario</option>
            <option value="ADMIN">Administrador</option>
          </select>
        </label>
        {existing && (
          <label className="flex items-center gap-2 text-sm">
            <input
              name="active"
              type="checkbox"
              defaultChecked={existing.active}
              disabled={isSelf}
            />
            Activo (puede iniciar sesión)
          </label>
        )}
        {isSelf && (
          <p className="text-xs text-stone-500">No podés cambiar tu propio rol ni desactivarte.</p>
        )}
        {existing && (
          <p className="text-xs text-stone-500">
            Cambiar la contraseña, el rol o desactivar al usuario cierra sus sesiones abiertas.
          </p>
        )}
        {error && (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-stone-300 px-3 py-2 text-sm hover:bg-stone-100"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-stone-900 px-3 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-60"
          >
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </div>
  );
}
