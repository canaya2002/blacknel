'use client';

import { Plus, X } from 'lucide-react';
import { useActionState, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { type Role } from '@/lib/permissions/roles';

import { inviteTeamAction } from '../../app/(app)/team/actions';

const ROLE_OPTIONS: ReadonlyArray<{ value: Exclude<Role, 'owner'>; label: string }> = [
  { value: 'admin', label: 'Admin' },
  { value: 'manager', label: 'Manager' },
  { value: 'agent', label: 'Agent' },
  { value: 'viewer', label: 'Viewer' },
];

export function InviteDialog(): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Array<{ id: number; email: string; role: Role }>>([
    { id: 1, email: '', role: 'agent' },
  ]);

  const [state, formAction, pending] = useActionState<
    { ok: true; count: number } | { ok: false; error: string } | null,
    FormData
  >(async (_prev, formData) => {
    const result = await inviteTeamAction(_prev, formData);
    if (result.ok) {
      setRows([{ id: 1, email: '', role: 'agent' }]);
      setOpen(false);
      return { ok: true, count: result.data.count };
    }
    return { ok: false, error: result.error.message };
  }, null);

  function addRow(): void {
    setRows((rs) => [...rs, { id: Date.now(), email: '', role: 'agent' }]);
  }

  function removeRow(id: number): void {
    setRows((rs) => (rs.length === 1 ? rs : rs.filter((r) => r.id !== id)));
  }

  function updateRow(id: number, patch: Partial<{ email: string; role: Role }>): void {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Invitar a alguien</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invitar al equipo</DialogTitle>
          <DialogDescription>
            Manda hasta 20 invitaciones de una vez. Cada persona recibirá un enlace de
            aceptación (visible también en la lista de invitaciones pendientes —
            Resend se cablea en la Fase 11).
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-3">
          {rows.map((row, idx) => (
            <div key={row.id} className="grid grid-cols-[1fr_140px_auto] gap-2">
              <div className="flex flex-col gap-1">
                {idx === 0 ? (
                  <Label htmlFor={`email-${row.id}`} className="text-xs">
                    Correo
                  </Label>
                ) : null}
                <Input
                  id={`email-${row.id}`}
                  name="emails"
                  type="email"
                  required
                  value={row.email}
                  onChange={(e) => updateRow(row.id, { email: e.target.value })}
                  placeholder="alguien@empresa.com"
                />
              </div>
              <div className="flex flex-col gap-1">
                {idx === 0 ? <Label className="text-xs">Rol</Label> : null}
                <input type="hidden" name="roles" value={row.role} />
                <Select
                  value={row.role}
                  onValueChange={(value) => updateRow(row.id, { role: value as Role })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLE_OPTIONS.map((opt) => (
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
                  onClick={() => removeRow(row.id)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
          <Button type="button" variant="ghost" size="sm" onClick={addRow} className="self-start">
            <Plus className="h-4 w-4" />
            Agregar otro
          </Button>
          {state && !state.ok ? (
            <p className="text-xs text-destructive">{state.error}</p>
          ) : null}
          <DialogFooter className="mt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Enviando…' : 'Enviar invitaciones'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
