'use client';

import { useSearchParams } from 'next/navigation';
import { useActionState } from 'react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

import { sendMagicLinkAction } from './actions';

type ActionState = {
  sent?: boolean;
  email?: string;
  error?: string;
} | null;

/**
 * Phase 11 / Commit 42a — magic-link sign-in form.
 *
 * Pure client component. Reads `?next=` from the URL via `useSearchParams`
 * (the Next App Router idiom — no `useEffect` + `setState` synchronisation
 * needed) and forwards it to the server action so the eventual callback
 * redirect lands the user on the page they originally tried to open.
 *
 * Success state stays on this same screen — no router push — because
 * the next step (clicking the link in the email) lives outside the app.
 */
export function MagicLinkForm(): React.ReactElement {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    async (_prev, formData) => {
      const result = await sendMagicLinkAction(formData);
      return result ?? null;
    },
    null,
  );

  const searchParams = useSearchParams();
  const nextParam = searchParams.get('next') ?? '';

  if (state?.sent) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-sm">
        <p className="font-medium text-emerald-900 dark:text-emerald-200">
          Te enviamos un correo.
        </p>
        <p className="text-emerald-800/80 dark:text-emerald-200/80">
          Abre el link desde{' '}
          <span className="font-mono text-xs">{state.email}</span> para entrar.
          El enlace expira en 1 hora.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="next" value={nextParam} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email" className="text-xs">
          Correo electrónico
        </Label>
        <input
          id="email"
          type="email"
          name="email"
          required
          autoComplete="email"
          inputMode="email"
          placeholder="tu@empresa.com"
          className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          disabled={pending}
        />
      </div>
      <Button type="submit" disabled={pending} className="mt-1">
        {pending ? 'Enviando…' : 'Enviar link de acceso'}
      </Button>
      {state?.error ? (
        <p className="text-xs text-destructive">{state.error}</p>
      ) : null}
    </form>
  );
}
