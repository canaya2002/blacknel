'use client';

import { Plus, X } from 'lucide-react';
import { useActionState, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Role } from '@/lib/permissions/roles';

import { submitTeamAction } from './actions';

const ROLES: ReadonlyArray<{ value: Exclude<Role, 'owner'>; label: string }> = [
  { value: 'admin', label: 'Admin' },
  { value: 'manager', label: 'Manager' },
  { value: 'agent', label: 'Agent' },
  { value: 'viewer', label: 'Viewer' },
];

export function StepTeam(): React.ReactElement {
  const [rows, setRows] = useState<Array<{ id: number; email: string; role: Role }>>([
    { id: 1, email: '', role: 'agent' },
  ]);

  const [state, action, pending] = useActionState<
    { ok?: boolean; error?: string } | null,
    FormData
  >(async (_prev, formData) => {
    const result = await submitTeamAction(_prev, formData);
    return result.ok ? { ok: true } : { error: result.error.message };
  }, null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invita al equipo (opcional)</CardTitle>
        <CardDescription>
          Manda invitaciones a quien vaya a operar contigo. Si prefieres hacerlo
          después, salta este paso — las invitaciones también viven en /team.
          Resend se cablea en la Fase 11; por ahora los enlaces aparecen en /team.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="flex flex-col gap-3">
          {rows.map((row, idx) => (
            <div key={row.id} className="grid grid-cols-[1fr_140px_auto] gap-2">
              <div className="flex flex-col gap-1">
                {idx === 0 ? <Label className="text-xs">Correo</Label> : null}
                <Input
                  type="email"
                  name="emails"
                  value={row.email}
                  onChange={(e) =>
                    setRows((rs) =>
                      rs.map((r) => (r.id === row.id ? { ...r, email: e.target.value } : r)),
                    )
                  }
                  placeholder="colega@empresa.com"
                />
              </div>
              <div className="flex flex-col gap-1">
                {idx === 0 ? <Label className="text-xs">Rol</Label> : null}
                <input type="hidden" name="roles" value={row.role} />
                <Select
                  value={row.role}
                  onValueChange={(value) =>
                    setRows((rs) =>
                      rs.map((r) => (r.id === row.id ? { ...r, role: value as Role } : r)),
                    )
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={rows.length === 1}
                  aria-label="Quitar fila"
                  onClick={() =>
                    setRows((rs) => (rs.length === 1 ? rs : rs.filter((r) => r.id !== row.id)))
                  }
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() =>
              setRows((rs) => [...rs, { id: Date.now(), email: '', role: 'agent' }])
            }
            className="self-start"
          >
            <Plus className="h-4 w-4" />
            Agregar
          </Button>
          {state?.error ? <p className="text-xs text-destructive">{state.error}</p> : null}
          <div className="mt-2 flex gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? 'Enviando…' : 'Enviar invitaciones y continuar'}
            </Button>
            <Button
              type="submit"
              variant="ghost"
              disabled={pending}
              formNoValidate
              onClick={() => setRows([])}
            >
              Saltar por ahora
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
