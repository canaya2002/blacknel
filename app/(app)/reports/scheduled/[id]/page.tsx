import Link from 'next/link';
import { notFound } from 'next/navigation';

import { PageHeader } from '@/components/common/page-header';
import { ScheduledReportActions } from '@/components/reports/scheduled-report-actions';
import { Card } from '@/components/ui/card';
import { requireUser } from '@/lib/auth/server';
import { authorize, can } from '@/lib/permissions/can';
import { planAllowsNamedFeature } from '@/lib/plans/gates';
import { getOrgPlanCode } from '@/lib/queries/plan';
import {
  getScheduledReportById,
  listRunsForReport,
} from '@/lib/scheduled-reports/queries';

export const dynamic = 'force-dynamic';

interface ScheduledReportDetailPageProps {
  params: Promise<{ id: string }>;
}

const STATUS_STYLES: Record<string, string> = {
  active:
    'border-emerald-500/40 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
  paused:
    'border-amber-500/40 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  archived: 'border-muted bg-muted text-muted-foreground',
};

const RUN_STATUS_STYLES: Record<string, string> = {
  queued:
    'border-zinc-300/60 bg-zinc-50 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300',
  running:
    'border-blue-500/40 bg-blue-50 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300',
  sent:
    'border-emerald-500/40 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
  failed:
    'border-rose-500/40 bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300',
};

/**
 * /reports/scheduled/[id] — Phase 9 / Commit 35 (Detail-page
 * template).
 *
 * 5 sections:
 *   1. PageHeader        — name + back link + status + run-now action
 *   2. KPI cards row     — runs total, last status, next run, recipients count
 *   3. Timeline          — runs history table (chronological)
 *   4. Recipients + meta
 *   5. (no destructive footer — archive is a separate action)
 */
export default async function ScheduledReportDetailPage({
  params,
}: ScheduledReportDetailPageProps): Promise<React.ReactElement> {
  const session = await requireUser();
  authorize(session.role, 'reports:create');

  const plan = await getOrgPlanCode(session);
  if (!planAllowsNamedFeature(plan, 'scheduled_report_emails')) {
    notFound();
  }

  const { id } = await params;
  const [report, runs] = await Promise.all([
    getScheduledReportById({
      orgId: session.orgId,
      userId: session.userId,
      scheduledReportId: id,
    }),
    listRunsForReport({
      orgId: session.orgId,
      userId: session.userId,
      scheduledReportId: id,
      limit: 20,
    }),
  ]);
  if (!report) {
    notFound();
  }

  const canManage = can(session.role, 'scheduled_reports:manage');
  const lastRun = runs[0];

  return (
    <div
      className="flex flex-col gap-6 px-6 py-6"
      data-testid="scheduled-report-detail"
    >
      {/* 1. PageHeader */}
      <PageHeader
        title={report.name}
        description={`${report.kind} · ${report.scheduleExpr} · ${report.brandName ?? 'Todas las brands'}`}
        eyebrow={
          <Link
            href="/reports?section=scheduled"
            className="hover:underline"
          >
            ← Volver a Scheduled reports
          </Link>
        }
        actions={
          <div className="flex items-center gap-2">
            <span
              className={`rounded-md border px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[report.status]}`}
            >
              {report.status}
            </span>
            {canManage ? (
              <ScheduledReportActions
                scheduledReportId={report.id}
                status={report.status}
              />
            ) : null}
          </div>
        }
      />

      {/* 2. KPI cards row */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <KpiTile label="Runs totales" value={String(report.runsCount)} />
        <KpiTile
          label="Último status"
          value={lastRun?.status ?? '—'}
        />
        <KpiTile
          label="Próximo envío"
          value={report.nextRunAt.toLocaleString()}
          small
        />
        <KpiTile
          label="Destinatarios"
          value={String(report.recipients.length)}
        />
      </div>

      {/* 3. Runs history */}
      <section
        className="flex flex-col gap-2"
        data-testid="scheduled-report-runs"
      >
        <h2 className="text-sm font-semibold">Historial de runs</h2>
        {runs.length === 0 ? (
          <Card className="p-4 text-sm text-muted-foreground">
            Aún no hubo ningún envío. El próximo está programado
            para {report.nextRunAt.toLocaleString()}.
          </Card>
        ) : (
          <Card className="divide-y">
            {runs.map((run) => (
              <div
                key={run.id}
                className="flex flex-col gap-1 p-3 sm:flex-row sm:items-center sm:justify-between"
                data-testid={`scheduled-report-run-${run.id}`}
              >
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm">
                    {run.createdAt.toLocaleString()}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {run.recipientsCount} destinatarios
                    {run.htmlSizeBytes
                      ? ` · ${(run.htmlSizeBytes / 1024).toFixed(1)} KB HTML`
                      : ''}
                    {run.sentAt ? ` · enviado ${run.sentAt.toLocaleTimeString()}` : ''}
                  </span>
                  {run.errorCode ? (
                    <span className="text-xs text-destructive">
                      {run.errorCode}
                    </span>
                  ) : null}
                </div>
                <span
                  className={`rounded-md border px-1.5 py-0.5 text-xs font-medium ${RUN_STATUS_STYLES[run.status] ?? ''}`}
                >
                  {run.status}
                </span>
              </div>
            ))}
          </Card>
        )}
      </section>

      {/* 4. Recipients + meta */}
      <section className="flex flex-col gap-2" data-testid="scheduled-report-meta">
        <h2 className="text-sm font-semibold">Destinatarios</h2>
        <Card className="flex flex-wrap gap-2 p-3 text-xs">
          {report.recipients.map((to) => (
            <span
              key={to}
              className="rounded-md border bg-muted/40 px-2 py-1 font-mono"
            >
              {to}
            </span>
          ))}
        </Card>
      </section>
    </div>
  );
}

function KpiTile({
  label,
  value,
  small,
}: {
  label: string;
  value: string;
  small?: boolean;
}): React.ReactElement {
  return (
    <Card className="flex flex-col gap-1 p-3">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span
        className={
          small
            ? 'text-sm font-medium tabular-nums'
            : 'text-2xl font-semibold tabular-nums'
        }
      >
        {value}
      </span>
    </Card>
  );
}
