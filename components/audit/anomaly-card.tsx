'use client';

import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { dismissAnomalyAction } from '@/app/(app)/audit/actions';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type { AnomalyRow } from '@/lib/audit-advanced/queries';

interface AnomalyCardProps {
  anomaly: AnomalyRow;
}

const KIND_LABELS: Record<AnomalyRow['kind'], string> = {
  off_hours_access: 'Off-hours access',
  new_ip: 'New IP',
  mass_export: 'Mass export',
};

const STATUS_STYLES: Record<AnomalyRow['status'], string> = {
  pending:
    'border-amber-500/40 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  dismissed: 'border bg-muted text-muted-foreground',
  accepted:
    'border-emerald-500/40 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
};

export function AnomalyCard({
  anomaly,
}: AnomalyCardProps): React.ReactElement {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const isPending = anomaly.status === 'pending';

  const decide = (decision: 'dismiss' | 'accept'): void => {
    setError(null);
    if (reason.trim().length < 10) {
      setError('Reason debe tener al menos 10 caracteres.');
      return;
    }
    startTransition(async () => {
      const r = await dismissAnomalyAction(null, {
        anomalyId: anomaly.id,
        action: decision,
        reason: reason.trim(),
      });
      if (!r.ok) {
        setError(r.error.message);
        return;
      }
      router.refresh();
    });
  };

  return (
    <Card
      className="flex flex-col gap-2 p-3"
      data-testid={`anomaly-${anomaly.id}`}
    >
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold">
            {KIND_LABELS[anomaly.kind]}
          </span>
          <span className="text-xs text-muted-foreground">
            {anomaly.userEmail ?? '—'} · {anomaly.createdAt.toLocaleString()}
          </span>
        </div>
        <span
          className={`rounded-md border px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[anomaly.status]}`}
        >
          {anomaly.status}
        </span>
      </div>
      <pre className="overflow-auto rounded bg-muted/40 p-2 text-[11px]">
        {JSON.stringify(anomaly.evidence, null, 2)}
      </pre>
      {anomaly.decidedReason ? (
        <div className="rounded border bg-muted/30 p-2 text-xs">
          <span className="uppercase tracking-wide text-[10px] text-muted-foreground">
            Reason ({anomaly.status}):
          </span>{' '}
          {anomaly.decidedReason}
        </div>
      ) : null}
      {isPending ? (
        <div className="flex flex-col gap-2">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="¿Por qué? (≥10 caracteres, requerido por compliance)"
            rows={2}
            className="rounded-md border bg-background px-3 py-2 text-sm"
            data-testid={`anomaly-${anomaly.id}-reason`}
          />
          {error ? (
            <span className="text-xs text-destructive">{error}</span>
          ) : null}
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => decide('dismiss')}
              data-testid={`anomaly-${anomaly.id}-dismiss`}
            >
              {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              Descartar
            </Button>
            <Button
              size="sm"
              variant="default"
              disabled={pending}
              onClick={() => decide('accept')}
              data-testid={`anomaly-${anomaly.id}-accept`}
            >
              Aceptar como incidente
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
