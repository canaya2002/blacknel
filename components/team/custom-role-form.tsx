'use client';

import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import {
  createCustomRoleAction,
  updateCustomRoleAction,
} from '@/app/(app)/team/roles/actions';
import { PermissionPicker } from '@/components/team/permission-picker';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type { CustomRoleTemplate } from '@/lib/custom-roles/templates';
import type { Permission, Role } from '@/lib/permissions/roles';

type BaseRole = Exclude<Role, 'owner'>;
const BASE_ROLES: ReadonlyArray<BaseRole> = ['admin', 'manager', 'agent', 'viewer'];

interface CustomRoleFormProps {
  mode: 'create' | 'edit';
  /** Pre-fill when launched from a template or edit page. */
  initial?: {
    id?: string;
    name: string;
    description: string | null;
    baseRole: BaseRole;
    grants: ReadonlyArray<Permission>;
    revokes: ReadonlyArray<Permission>;
  };
  /** Optional template snapshot displayed above the form. */
  template?: CustomRoleTemplate | null;
}

export function CustomRoleForm({
  mode,
  initial,
  template,
}: CustomRoleFormProps): React.ReactElement {
  const router = useRouter();
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(
    initial?.description ?? '',
  );
  const [baseRole, setBaseRole] = useState<BaseRole>(
    initial?.baseRole ?? 'manager',
  );
  const [grants, setGrants] = useState<Permission[]>([
    ...(initial?.grants ?? []),
  ]);
  const [revokes, setRevokes] = useState<Permission[]>([
    ...(initial?.revokes ?? []),
  ]);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const submit = (): void => {
    if (name.trim().length === 0) {
      setError('Dale un nombre al custom role.');
      return;
    }
    setError(null);
    startTransition(async () => {
      const payload = {
        ...(initial?.id ? { id: initial.id } : {}),
        name: name.trim(),
        description: description.trim() || null,
        baseRole,
        grants,
        revokes,
      };
      const result =
        mode === 'create'
          ? await createCustomRoleAction(null, payload)
          : await updateCustomRoleAction(null, payload);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      router.push('/team/roles');
    });
  };

  return (
    <Card className="flex flex-col gap-5 p-6">
      {template ? (
        <div className="rounded-md border border-violet-500/40 bg-violet-50 p-3 text-xs text-violet-800 dark:bg-violet-950/40 dark:text-violet-300">
          <strong>Plantilla:</strong> {template.label}. {template.description}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs uppercase tracking-wide text-muted-foreground">
            Nombre
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            className="rounded-md border bg-background px-3 py-2 text-sm"
            data-testid="custom-role-name"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs uppercase tracking-wide text-muted-foreground">
            Base role
          </label>
          <select
            value={baseRole}
            onChange={(e) => setBaseRole(e.target.value as BaseRole)}
            className="rounded-md border bg-background px-3 py-2 text-sm"
            data-testid="custom-role-base"
          >
            {BASE_ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-xs uppercase tracking-wide text-muted-foreground">
          Descripción (opcional)
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          maxLength={500}
          className="rounded-md border bg-background px-3 py-2 text-sm"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-xs uppercase tracking-wide text-muted-foreground">
          Permisos
        </label>
        <PermissionPicker
          baseRole={baseRole}
          grants={grants}
          revokes={revokes}
          onChange={(g, r) => {
            setGrants(g);
            setRevokes(r);
          }}
        />
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <Button onClick={submit} disabled={pending} data-testid="custom-role-submit">
          {pending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Guardando…
            </>
          ) : mode === 'create' ? (
            'Crear custom role'
          ) : (
            'Guardar cambios'
          )}
        </Button>
        <Button variant="ghost" onClick={() => router.back()}>
          Cancelar
        </Button>
      </div>
    </Card>
  );
}
