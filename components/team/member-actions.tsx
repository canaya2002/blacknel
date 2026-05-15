'use client';

import { MoreVertical } from 'lucide-react';
import { useActionState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Role } from '@/lib/permissions/roles';
import { useState } from 'react';

import {
  changeRoleAction,
  removeMemberAction,
} from '../../app/(app)/team/actions';

interface MemberActionsProps {
  member: {
    userId: string;
    name: string;
    email: string;
    role: Role;
  };
  /** Roles the current user is allowed to assign. */
  assignableRoles: ReadonlyArray<Role>;
  /** Whether the current user is allowed to remove members. */
  canRemove: boolean;
  /** True when removing this member would leave the org without an owner. */
  isLastOwner: boolean;
}

export function MemberActions({
  member,
  assignableRoles,
  canRemove,
  isLastOwner,
}: MemberActionsProps): React.ReactElement {
  const [showChangeRole, setShowChangeRole] = useState(false);
  const [showRemove, setShowRemove] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`Acciones para ${member.name}`}>
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            disabled={assignableRoles.length === 0}
            onSelect={(e) => {
              e.preventDefault();
              setShowChangeRole(true);
            }}
          >
            Cambiar rol
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={!canRemove || isLastOwner}
            onSelect={(e) => {
              e.preventDefault();
              setShowRemove(true);
            }}
            className="text-destructive focus:text-destructive"
          >
            Remover del equipo
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ChangeRoleDialog
        open={showChangeRole}
        onOpenChange={setShowChangeRole}
        member={member}
        assignableRoles={assignableRoles}
      />
      <RemoveMemberDialog
        open={showRemove}
        onOpenChange={setShowRemove}
        member={member}
      />
    </>
  );
}

function ChangeRoleDialog({
  open,
  onOpenChange,
  member,
  assignableRoles,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  member: MemberActionsProps['member'];
  assignableRoles: ReadonlyArray<Role>;
}): React.ReactElement {
  const [role, setRole] = useState<Role>(member.role);
  const [state, action, pending] = useActionState<
    { ok: boolean; error?: string } | null,
    FormData
  >(async (_prev, formData) => {
    const result = await changeRoleAction(_prev, formData);
    if (result.ok) {
      onOpenChange(false);
      return { ok: true };
    }
    return { ok: false, error: result.error.message };
  }, null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cambiar rol</DialogTitle>
          <DialogDescription>
            Define el nuevo rol de {member.name}.
          </DialogDescription>
        </DialogHeader>
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="userId" value={member.userId} />
          <input type="hidden" name="role" value={role} />
          <Select value={role} onValueChange={(v) => setRole(v as Role)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {assignableRoles.map((r) => (
                <SelectItem key={r} value={r}>
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {state && state.error ? (
            <p className="text-xs text-destructive">{state.error}</p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending || role === member.role}>
              Guardar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RemoveMemberDialog({
  open,
  onOpenChange,
  member,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  member: MemberActionsProps['member'];
}): React.ReactElement {
  const [state, action, pending] = useActionState<
    { ok: boolean; error?: string } | null,
    FormData
  >(async (_prev, formData) => {
    const result = await removeMemberAction(_prev, formData);
    if (result.ok) {
      onOpenChange(false);
      return { ok: true };
    }
    return { ok: false, error: result.error.message };
  }, null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remover a {member.name}</DialogTitle>
          <DialogDescription>
            Esta persona perderá acceso a esta organización. No se borra del sistema y
            puede ser re-invitada después.
          </DialogDescription>
        </DialogHeader>
        <form action={action} className="flex flex-col gap-3">
          <input type="hidden" name="userId" value={member.userId} />
          {state && state.error ? (
            <p className="text-xs text-destructive">{state.error}</p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending ? 'Removiendo…' : 'Remover'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

