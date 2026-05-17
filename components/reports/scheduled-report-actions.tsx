'use client';

import { Loader2, Pause, Play, Send } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import {
  pauseScheduledReportAction,
  runScheduledReportNowAction,
} from '@/app/(app)/reports/scheduled-actions';
import { Button } from '@/components/ui/button';

interface ScheduledReportActionsProps {
  scheduledReportId: string;
  status: 'active' | 'paused' | 'archived';
}

/**
 * Action cluster for `/reports/scheduled/[id]` (Phase 9 / Commit
 * 35). "Run now" is allowed only when the schedule is active.
 * Pause/Resume toggles the active↔paused pair.
 */
export function ScheduledReportActions({
  scheduledReportId,
  status,
}: ScheduledReportActionsProps): React.ReactElement {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const runNow = (): void => {
    setError(null);
    setInfo(null);
    startTransition(async () => {
      const r = await runScheduledReportNowAction(null, {
        scheduledReportId,
      });
      if (!r.ok) {
        setError(r.error.message);
        return;
      }
      setInfo(
        r.data.dispatched
          ? 'Reporte enviado. Ver el dev outbox.'
          : 'Tick disparado pero sin dispatch (¿status?).',
      );
      router.refresh();
    });
  };

  const togglePause = (): void => {
    setError(null);
    setInfo(null);
    startTransition(async () => {
      const r = await pauseScheduledReportAction(null, {
        scheduledReportId,
        paused: status === 'active',
      });
      if (!r.ok) {
        setError(r.error.message);
        return;
      }
      setInfo(
        r.data.status === 'paused'
          ? 'Schedule pausado.'
          : 'Schedule reactivado.',
      );
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="default"
          disabled={pending || status !== 'active'}
          onClick={runNow}
          data-testid="scheduled-report-run-now"
        >
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Send className="h-3.5 w-3.5" />
          )}
          Run now
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={pending || status === 'archived'}
          onClick={togglePause}
          data-testid="scheduled-report-toggle-pause"
        >
          {status === 'active' ? (
            <>
              <Pause className="h-3.5 w-3.5" /> Pausar
            </>
          ) : (
            <>
              <Play className="h-3.5 w-3.5" /> Reanudar
            </>
          )}
        </Button>
      </div>
      {error ? (
        <span className="text-xs text-destructive">{error}</span>
      ) : null}
      {info ? (
        <span className="text-xs text-muted-foreground">{info}</span>
      ) : null}
    </div>
  );
}
