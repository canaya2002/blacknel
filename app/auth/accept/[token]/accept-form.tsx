'use client';

import { useActionState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { acceptInvitationAction } from './actions';

export function AcceptForm({
  token,
  email,
}: {
  token: string;
  email: string;
}): React.ReactElement {
  const [state, action, pending] = useActionState<
    { ok?: boolean; error?: string } | null,
    FormData
  >(async (_prev, formData) => {
    const result = await acceptInvitationAction(_prev, formData);
    if (result.ok) return { ok: true };
    return { error: result.error.message };
  }, null);

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email-display" className="text-xs">
          Cuenta invitada
        </Label>
        <Input
          id="email-display"
          value={email}
          readOnly
          className="text-muted-foreground"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name" className="text-xs">
          ¿Cómo te llamas?
        </Label>
        <Input
          id="name"
          name="name"
          placeholder="Nombre completo"
          autoFocus
        />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? 'Aceptando…' : 'Aceptar invitación'}
      </Button>
      {state?.error ? (
        <p className="text-xs text-destructive">{state.error}</p>
      ) : null}
      <p className="text-[11px] text-muted-foreground">
        Aceptar te llevará al dashboard de la organización. En Fase 11 sumaremos
        Supabase Auth + magic link — hasta entonces tu sesión local se firma con
        un JWT corto.
      </p>
    </form>
  );
}
