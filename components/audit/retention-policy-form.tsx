'use client';

import { Loader2, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import {
  createRetentionPolicyAction,
  removeRetentionPolicyAction,
} from '@/app/(app)/audit/actions';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

interface PolicyRow {
  readonly id: string;
  readonly appliesTo: string;
  readonly retentionDays: number;
}

interface RetentionPolicyFormProps {
  policies: ReadonlyArray<PolicyRow>;
}

export function RetentionPolicyForm({
  policies,
}: RetentionPolicyFormProps): React.ReactElement {
  const router = useRouter();
  const [appliesTo, setAppliesTo] = useState('all');
  const [days, setDays] = useState(90);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const add = (): void => {
    setError(null);
    startTransition(async () => {
      const r = await createRetentionPolicyAction(null, {
        appliesTo,
        retentionDays: days,
      });
      if (!r.ok) {
        setError(r.error.message);
        return;
      }
      router.refresh();
      setAppliesTo('all');
      setDays(90);
    });
  };

  const remove = (id: string): void => {
    setError(null);
    startTransition(async () => {
      const r = await removeRetentionPolicyAction(null, { policyId: id });
      if (!r.ok) {
        setError(r.error.message);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3 p-4">
        <h2 className="text-sm font-semibold">Nueva política</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs uppercase tracking-wide text-muted-foreground">
              Applies to (action pattern)
            </label>
            <input
              value={appliesTo}
              onChange={(e) => setAppliesTo(e.target.value)}
              placeholder="all | billing.* | custom_role.created"
              className="rounded-md border bg-background px-3 py-2 text-sm font-mono"
              data-testid="retention-applies-to"
            />
            <span className="text-[10px] text-muted-foreground">
              Precedence: exact &gt; prefix &gt; all. Empate → mayor
              retention gana.
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs uppercase tracking-wide text-muted-foreground">
              Retention days
            </label>
            <input
              type="number"
              min={1}
              max={3650}
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="rounded-md border bg-background px-3 py-2 text-sm"
              data-testid="retention-days"
            />
          </div>
        </div>
        {error ? (
          <span className="text-xs text-destructive">{error}</span>
        ) : null}
        <Button
          onClick={add}
          disabled={pending}
          size="sm"
          data-testid="retention-add"
        >
          {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          Agregar política
        </Button>
      </Card>

      <Card className="divide-y">
        {policies.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">
            Sin políticas configuradas. Sin políticas, el cron de
            purga NUNCA elimina audit events.
          </div>
        ) : (
          policies.map((p) => (
            <div
              key={p.id}
              className="flex items-center justify-between p-3 text-sm"
              data-testid={`retention-policy-${p.id}`}
            >
              <div className="flex flex-col">
                <code className="font-mono">{p.appliesTo}</code>
                <span className="text-xs text-muted-foreground">
                  {p.retentionDays} días
                </span>
              </div>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => remove(p.id)}
                data-testid={`retention-remove-${p.id}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))
        )}
      </Card>
    </div>
  );
}
