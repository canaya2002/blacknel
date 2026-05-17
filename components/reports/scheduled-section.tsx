import { Calendar, Mail } from 'lucide-react';
import Link from 'next/link';

import { EmptyState } from '@/components/common/empty-state';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type { ScheduledReportRow } from '@/lib/scheduled-reports/queries';

interface ScheduledSectionProps {
  reports: ReadonlyArray<ScheduledReportRow>;
  canManage: boolean;
}

const STATUS_STYLES: Record<ScheduledReportRow['status'], string> = {
  active:
    'border-emerald-500/40 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
  paused:
    'border-amber-500/40 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  archived: 'border-muted bg-muted text-muted-foreground',
};

/**
 * Scheduled-reports tab body (Phase 9 / Commit 34, D-34-6 a).
 *
 * List of `scheduled_reports` rows + new-schedule CTA. Each row
 * shows next/last run + recipients + status. Pause/resume + run-now
 * controls land in a follow-up tab detail page.
 */
export function ScheduledSection({
  reports,
  canManage,
}: ScheduledSectionProps): React.ReactElement {
  if (reports.length === 0) {
    return (
      <EmptyState
        icon={Calendar}
        title="Sin reportes programados"
        description="Programá un envío automático del overview de tu brand. Soportado weekly y monthly hoy; custom cron aterriza en Fase 11."
        primary={
          canManage
            ? {
                label: 'Programar reporte',
                href: '/reports/scheduled/new',
              }
            : {
                label: 'Programar reporte',
                disabledReason:
                  'Tu rol no permite gestionar reportes programados.',
              }
        }
      />
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {reports.length} reportes programados
        </span>
        {canManage ? (
          <Button asChild size="sm">
            <Link href="/reports/scheduled/new">Programar reporte</Link>
          </Button>
        ) : null}
      </div>
      <Card className="divide-y">
        {reports.map((r) => (
          <div
            key={r.id}
            className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between"
            data-testid={`scheduled-report-${r.id}`}
          >
            <div className="flex flex-col gap-0.5">
              <Link
                href={`/reports/scheduled/${r.id}`}
                className="text-sm font-semibold hover:underline"
              >
                {r.name}
              </Link>
              <span className="text-xs text-muted-foreground">
                {r.brandName ?? 'Todas las brands'} ·{' '}
                <code className="rounded bg-muted/60 px-1 font-mono">
                  {r.kind} · {r.scheduleExpr}
                </code>
              </span>
              <span className="text-xs text-muted-foreground">
                <Mail className="inline-block h-3 w-3" aria-hidden />{' '}
                {r.recipients.length} destinatario
                {r.recipients.length === 1 ? '' : 's'} · {r.runsCount} runs
              </span>
            </div>
            <div className="flex flex-col items-end gap-1">
              <span
                className={`rounded-md border px-1.5 py-0.5 text-xs font-medium ${STATUS_STYLES[r.status]}`}
              >
                {r.status}
              </span>
              <span className="text-xs text-muted-foreground">
                Próximo: {r.nextRunAt.toLocaleString()}
              </span>
              {r.lastRunAt ? (
                <span className="text-xs text-muted-foreground">
                  Último: {r.lastRunAt.toLocaleString()}
                </span>
              ) : null}
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}
