'use client';

import { useActionState, useState } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';
import type { Role } from '@/lib/permissions/roles';

import { devLoginAction } from './actions';

interface Account {
  userId: string;
  orgId: string;
  orgName: string;
  email: string;
  name: string;
  role: Role;
}

interface LoginFormProps {
  accounts: ReadonlyArray<Account>;
}

const ROLE_TONE: Record<Role, string> = {
  owner: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  admin: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
  manager: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  agent: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  viewer: 'bg-slate-500/15 text-slate-700 dark:text-slate-300',
};

export function LoginForm({ accounts }: LoginFormProps): React.ReactElement {
  const [state, formAction, pending] = useActionState<
    { error?: string } | null,
    FormData
  >(async (prev, formData) => {
    const result = await devLoginAction(prev, formData);
    return result ?? null;
  }, null);

  const [selected, setSelected] = useState<string | null>(null);
  const [selectedUserId, selectedOrgId] = selected ? selected.split(':') : ['', ''];

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="userId" value={selectedUserId ?? ''} />
      <input type="hidden" name="orgId" value={selectedOrgId ?? ''} />
      {accounts.map((account) => {
        const value = `${account.userId}:${account.orgId}`;
        const checked = selected === value;
        return (
          <label
            key={value}
            className={cn(
              'group flex cursor-pointer items-center justify-between gap-3 rounded-md border px-3 py-2 transition-colors',
              checked
                ? 'border-primary bg-accent'
                : 'border-transparent hover:border-border hover:bg-accent/50',
            )}
          >
            <div className="flex items-center gap-3">
              <input
                type="radio"
                name="selection"
                value={value}
                checked={checked}
                onChange={() => setSelected(value)}
                className="h-4 w-4 accent-primary"
                required
              />
              <div className="flex flex-col">
                <span className="text-sm font-medium leading-tight">{account.name}</span>
                <span className="text-xs text-muted-foreground">{account.email}</span>
                <span className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {account.orgName}
                </span>
              </div>
            </div>
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                ROLE_TONE[account.role],
              )}
            >
              {account.role}
            </span>
          </label>
        );
      })}
      <Button type="submit" disabled={pending || !selected} className="mt-3">
        {pending ? 'Entrando…' : 'Continuar'}
      </Button>
      {state?.error ? (
        <p className="text-xs text-destructive">{state.error}</p>
      ) : null}
    </form>
  );
}
