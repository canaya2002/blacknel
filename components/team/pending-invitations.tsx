'use client';

import { Copy, X } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils/cn';
import type { Role } from '@/lib/permissions/roles';

import { cancelInvitationFormAction } from '../../app/(app)/team/actions';

interface PendingInvite {
  id: string;
  email: string;
  role: Role;
  link: string;
  expiresAt: string;
}

interface PendingInvitationsProps {
  invitations: ReadonlyArray<PendingInvite>;
}

export function PendingInvitations({
  invitations,
}: PendingInvitationsProps): React.ReactElement | null {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  if (invitations.length === 0) return null;

  async function copy(id: string, link: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(link);
      setCopiedId(id);
      setTimeout(() => setCopiedId((curr) => (curr === id ? null : curr)), 1500);
    } catch {
      // No-op; some browsers in iframes block clipboard.
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Invitaciones pendientes</CardTitle>
        <CardDescription>
          Hasta que Resend se cablee en la Fase 11, copia el link y compártelo
          manualmente con la persona invitada — la página de aceptación funciona
          de inmediato.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {invitations.map((invite) => (
          <div
            key={invite.id}
            className="flex flex-wrap items-center gap-2 rounded-md border bg-card/40 p-3"
          >
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{invite.email}</span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {invite.role}
                </span>
              </div>
              <span className="mt-0.5 truncate text-xs text-muted-foreground">
                Caduca {new Date(invite.expiresAt).toLocaleString()}
              </span>
            </div>
            <Input
              readOnly
              value={invite.link}
              className="h-8 max-w-md flex-1 font-mono text-xs"
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => copy(invite.id, invite.link)}
            >
              <Copy className="h-3.5 w-3.5" />
              <span className={cn(copiedId === invite.id && 'text-emerald-600')}>
                {copiedId === invite.id ? '¡Copiado!' : 'Copiar'}
              </span>
            </Button>
            <form action={cancelInvitationFormAction}>
              <input type="hidden" name="invitationId" value={invite.id} />
              <Button
                type="submit"
                variant="ghost"
                size="icon"
                aria-label="Cancelar invitación"
              >
                <X className="h-4 w-4" />
              </Button>
            </form>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
