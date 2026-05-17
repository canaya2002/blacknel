'use client';

import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { createScheduledReportAction } from '@/app/(app)/reports/scheduled-actions';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

type Kind = 'weekly' | 'monthly' | 'custom';

export function ScheduledReportForm(): React.ReactElement {
  const router = useRouter();
  const [name, setName] = useState('Reporte semanal de brand');
  const [kind, setKind] = useState<Kind>('weekly');
  const [scheduleExpr, setScheduleExpr] = useState('mon 09:00');
  const [recipients, setRecipients] = useState('reporting@blacknel.demo');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const submit = (): void => {
    const list = recipients
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (list.length === 0) {
      setError('Agregá al menos un destinatario.');
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await createScheduledReportAction(null, {
        name: name.trim(),
        kind,
        scheduleExpr: scheduleExpr.trim(),
        recipients: list,
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      router.push('/reports?section=scheduled');
    });
  };

  return (
    <Card className="flex flex-col gap-5 p-6">
      <div className="flex flex-col gap-1.5">
        <label className="text-xs uppercase tracking-wide text-muted-foreground">
          Nombre
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          className="rounded-md border bg-background px-3 py-2 text-sm"
          data-testid="scheduled-report-name"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs uppercase tracking-wide text-muted-foreground">
            Cadencia
          </label>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as Kind)}
            className="rounded-md border bg-background px-3 py-2 text-sm"
            data-testid="scheduled-report-kind"
          >
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="custom">Custom</option>
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs uppercase tracking-wide text-muted-foreground">
            Schedule
          </label>
          <input
            value={scheduleExpr}
            onChange={(e) => setScheduleExpr(e.target.value)}
            placeholder={
              kind === 'weekly'
                ? 'mon 09:00'
                : kind === 'monthly'
                  ? '1 09:00'
                  : 'mon 09:00 / 1 09:00'
            }
            className="rounded-md border bg-background px-3 py-2 text-sm font-mono"
            data-testid="scheduled-report-schedule"
          />
          <span className="text-[10px] text-muted-foreground">
            {kind === 'weekly'
              ? 'Formato: "<dow> HH:MM" (ej "mon 09:00").'
              : kind === 'monthly'
                ? 'Formato: "<1-28> HH:MM" (ej "1 09:00").'
                : 'Weekly o monthly por ahora; cron-5 en Fase 11.'}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-xs uppercase tracking-wide text-muted-foreground">
          Destinatarios (separá con coma)
        </label>
        <textarea
          value={recipients}
          onChange={(e) => setRecipients(e.target.value)}
          rows={2}
          className="rounded-md border bg-background px-3 py-2 text-sm"
          data-testid="scheduled-report-recipients"
        />
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <Button
          onClick={submit}
          disabled={pending}
          data-testid="scheduled-report-submit"
        >
          {pending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Creando…
            </>
          ) : (
            'Programar'
          )}
        </Button>
        <Button variant="ghost" onClick={() => router.back()}>
          Cancelar
        </Button>
      </div>
    </Card>
  );
}
