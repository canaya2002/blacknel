import { and, eq, lte } from 'drizzle-orm';

import { type AnyPgTx, dbAdmin } from '@/lib/db/client';
import { organizations, scheduledReports } from '@/lib/db/schema';
import { log } from '@/lib/log';
import {
  generateAndDeliverReport,
  type ReportPillar,
} from '@/lib/reports/pdf/generate-report';
import { nextRunAfter } from '@/lib/scheduled-reports/schedule';

import { type BlacknelEvents, inngest, tryEmit } from '../client';

/**
 * Cron: dispatch due scheduled reports as white-label PDFs (C52). Scans
 * `scheduled_reports` (active, due), emits `report.generate` per report (or runs
 * it inline when Inngest is off), and advances `next_run_at`. This is the C44/
 * Inngest production scheduler for PDF reports; the legacy dev cron-loop HTML
 * tick (NODE_ENV=development + env-gated) is the dev path and they're
 * environment-disjoint — see the C52 report for the deprecation note.
 *
 * Default pillars = all four; period derives from the schedule kind (monthly→30d,
 * else 7d). Recipients come from the report row. Per-report failures are logged
 * and skipped; one bad report never aborts the sweep.
 */

const PILLARS: ReportPillar[] = ['publishing', 'reviews', 'ads', 'inbox'];

/**
 * Data window for the report. Derived from the schedule's actual shape, not just
 * `kind`: a 'custom' report with a monthly-shaped expr ("<dom> HH:MM") gets 30d,
 * not the 7d default — so the PDF window matches the cadence.
 */
function periodDaysFor(kind: 'weekly' | 'monthly' | 'custom', scheduleExpr: string): number {
  if (kind === 'monthly') return 30;
  if (kind === 'weekly') return 7;
  const firstToken = scheduleExpr.trim().split(/\s+/)[0] ?? '';
  return /^\d+$/.test(firstToken) ? 30 : 7; // numeric first token → day-of-month → monthly
}

interface DueRow {
  id: string;
  organizationId: string;
  scheduleExpr: string;
  recipients: string[];
  kind: 'weekly' | 'monthly' | 'custom';
  timezone: string;
  nextRunAt: Date;
}

export interface DispatchScheduledReportsDeps {
  asAdmin: <T>(fn: (tx: AnyPgTx) => Promise<T>) => Promise<T>;
  emit: (name: 'report.generate', data: BlacknelEvents['report.generate']['data']) => Promise<boolean>;
  generate: (input: {
    orgId: string;
    periodDays: number;
    pillars: ReportPillar[];
    recipients: string[];
  }) => Promise<unknown>;
  nextRun: (expr: string, timeZone: string, from: Date) => Date | null;
  now: () => Date;
}

function defaultDeps(): DispatchScheduledReportsDeps {
  return {
    asAdmin: (fn) => dbAdmin(fn),
    emit: (name, data) => tryEmit(name, data),
    generate: (input) => generateAndDeliverReport(input),
    nextRun: (expr, tz, from) => nextRunAfter(expr, tz, from),
    now: () => new Date(),
  };
}

export interface DispatchScheduledReportsReport {
  due: number;
  dispatched: number;
  failed: number;
}

export async function runDispatchScheduledReports(
  deps: DispatchScheduledReportsDeps = defaultDeps(),
): Promise<DispatchScheduledReportsReport> {
  const now = deps.now();
  const rows = await deps.asAdmin<DueRow[]>((tx) =>
    tx
      .select({
        id: scheduledReports.id,
        organizationId: scheduledReports.organizationId,
        scheduleExpr: scheduledReports.scheduleExpr,
        recipients: scheduledReports.recipients,
        kind: scheduledReports.kind,
        timezone: organizations.timezone,
        nextRunAt: scheduledReports.nextRunAt,
      })
      .from(scheduledReports)
      .innerJoin(organizations, eq(organizations.id, scheduledReports.organizationId))
      .where(and(eq(scheduledReports.status, 'active'), lte(scheduledReports.nextRunAt, now)))
      .limit(50),
  );

  let dispatched = 0;
  let failed = 0;
  for (const r of rows) {
    try {
      const periodDays = periodDaysFor(r.kind, r.scheduleExpr);
      const payload = {
        orgId: r.organizationId,
        periodDays,
        pillars: PILLARS,
        recipients: r.recipients,
      };
      const emitted = await deps.emit('report.generate', payload);
      if (!emitted) await deps.generate(payload);

      const next = deps.nextRun(r.scheduleExpr, r.timezone, now);
      await deps.asAdmin((tx) =>
        tx
          .update(scheduledReports)
          .set({ lastRunAt: now, nextRunAt: next ?? r.nextRunAt, updatedAt: now })
          .where(eq(scheduledReports.id, r.id)),
      );
      dispatched += 1;
    } catch (err) {
      failed += 1;
      log.warn({ scheduledReportId: r.id, err: (err as Error).message }, 'dispatch_scheduled_reports.failed');
    }
  }

  const report: DispatchScheduledReportsReport = { due: rows.length, dispatched, failed };
  log.info(report, 'dispatch_scheduled_reports');
  return report;
}

export const dispatchScheduledReports = inngest.createFunction(
  { id: 'dispatch-scheduled-reports', triggers: [{ cron: '*/15 * * * *' }] }, // every 15 min
  async ({ step }) => step.run('dispatch', () => runDispatchScheduledReports()),
);
