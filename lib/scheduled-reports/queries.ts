import 'server-only';

import { and, desc, eq, lte, sql } from 'drizzle-orm';

import { dbAs, type AnyPgTx } from '@/lib/db/client';
import {
  brands,
  scheduledReportRuns,
  scheduledReports,
  type ScheduledReport,
  type ScheduledReportKind,
  type ScheduledReportRunStatus,
  type ScheduledReportStatus,
} from '@/lib/db/schema';

/**
 * Scheduled-reports read layer (Phase 9 / Commit 34).
 */

export interface ScheduledReportRow {
  readonly id: string;
  readonly brandId: string | null;
  readonly brandName: string | null;
  readonly name: string;
  readonly kind: ScheduledReportKind;
  readonly scheduleExpr: string;
  readonly recipients: ReadonlyArray<string>;
  readonly status: ScheduledReportStatus;
  readonly nextRunAt: Date;
  readonly lastRunAt: Date | null;
  readonly runsCount: number;
}

export async function listScheduledReportsWithTx(
  tx: AnyPgTx,
  orgId: string,
): Promise<ScheduledReportRow[]> {
  const rows: Array<{
    report: ScheduledReport;
    brandName: string | null;
    runsCount: number;
  }> = await tx
    .select({
      report: scheduledReports,
      brandName: brands.name,
      runsCount: sql<number>`COALESCE((
        SELECT COUNT(*)::int FROM ${scheduledReportRuns}
        WHERE ${scheduledReportRuns}.scheduled_report_id = ${scheduledReports}.id
      ), 0)`,
    })
    .from(scheduledReports)
    .leftJoin(brands, eq(brands.id, scheduledReports.brandId))
    .where(eq(scheduledReports.organizationId, orgId))
    .orderBy(desc(scheduledReports.createdAt));
  return rows.map((r) => ({
    id: r.report.id,
    brandId: r.report.brandId,
    brandName: r.brandName,
    name: r.report.name,
    kind: r.report.kind,
    scheduleExpr: r.report.scheduleExpr,
    recipients: r.report.recipients,
    status: r.report.status,
    nextRunAt: r.report.nextRunAt,
    lastRunAt: r.report.lastRunAt,
    runsCount: r.runsCount,
  }));
}

export async function listScheduledReports(ctx: {
  orgId: string;
  userId: string;
}): Promise<ScheduledReportRow[]> {
  return dbAs({ orgId: ctx.orgId, userId: ctx.userId }, (tx) =>
    listScheduledReportsWithTx(tx, ctx.orgId),
  );
}

export interface DueScheduledReport {
  readonly id: string;
  readonly organizationId: string;
  readonly brandId: string | null;
  readonly name: string;
  readonly kind: ScheduledReportKind;
  readonly scheduleExpr: string;
  readonly recipients: ReadonlyArray<string>;
  readonly nextRunAt: Date;
}

/**
 * Cron-side selector: active schedules whose next_run_at has
 * passed. Returns at most `limit` rows ordered oldest-first so
 * the dispatcher honors strict FIFO.
 */
export async function findDueScheduledReportsWithTx(
  tx: AnyPgTx,
  now: Date,
  limit = 100,
): Promise<DueScheduledReport[]> {
  const rows: Array<{
    id: string;
    organizationId: string;
    brandId: string | null;
    name: string;
    kind: ScheduledReportKind;
    scheduleExpr: string;
    recipients: string[];
    nextRunAt: Date;
  }> = await tx
    .select({
      id: scheduledReports.id,
      organizationId: scheduledReports.organizationId,
      brandId: scheduledReports.brandId,
      name: scheduledReports.name,
      kind: scheduledReports.kind,
      scheduleExpr: scheduledReports.scheduleExpr,
      recipients: scheduledReports.recipients,
      nextRunAt: scheduledReports.nextRunAt,
    })
    .from(scheduledReports)
    .where(
      and(
        eq(scheduledReports.status, 'active'),
        lte(scheduledReports.nextRunAt, now),
      ),
    )
    .orderBy(scheduledReports.nextRunAt)
    .limit(limit);
  return rows;
}

export interface RunRow {
  readonly id: string;
  readonly status: ScheduledReportRunStatus;
  readonly createdAt: Date;
  readonly generatedAt: Date | null;
  readonly sentAt: Date | null;
  readonly htmlSizeBytes: number | null;
  readonly recipientsCount: number;
  readonly errorCode: string | null;
}

export async function getScheduledReportByIdWithTx(
  tx: AnyPgTx,
  orgId: string,
  scheduledReportId: string,
): Promise<ScheduledReportRow | null> {
  const rows: Array<{
    report: ScheduledReport;
    brandName: string | null;
    runsCount: number;
  }> = await tx
    .select({
      report: scheduledReports,
      brandName: brands.name,
      runsCount: sql<number>`COALESCE((
        SELECT COUNT(*)::int FROM ${scheduledReportRuns}
        WHERE ${scheduledReportRuns}.scheduled_report_id = ${scheduledReports}.id
      ), 0)`,
    })
    .from(scheduledReports)
    .leftJoin(brands, eq(brands.id, scheduledReports.brandId))
    .where(
      and(
        eq(scheduledReports.organizationId, orgId),
        eq(scheduledReports.id, scheduledReportId),
      ),
    )
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.report.id,
    brandId: r.report.brandId,
    brandName: r.brandName,
    name: r.report.name,
    kind: r.report.kind,
    scheduleExpr: r.report.scheduleExpr,
    recipients: r.report.recipients,
    status: r.report.status,
    nextRunAt: r.report.nextRunAt,
    lastRunAt: r.report.lastRunAt,
    runsCount: r.runsCount,
  };
}

export async function getScheduledReportById(ctx: {
  orgId: string;
  userId: string;
  scheduledReportId: string;
}): Promise<ScheduledReportRow | null> {
  return dbAs({ orgId: ctx.orgId, userId: ctx.userId }, (tx) =>
    getScheduledReportByIdWithTx(tx, ctx.orgId, ctx.scheduledReportId),
  );
}

export async function listRunsForReport(ctx: {
  orgId: string;
  userId: string;
  scheduledReportId: string;
  limit?: number;
}): Promise<RunRow[]> {
  return dbAs({ orgId: ctx.orgId, userId: ctx.userId }, (tx) =>
    listRunsForReportWithTx(
      tx,
      ctx.orgId,
      ctx.scheduledReportId,
      ctx.limit ?? 20,
    ),
  );
}

export async function listRunsForReportWithTx(
  tx: AnyPgTx,
  orgId: string,
  scheduledReportId: string,
  limit = 20,
): Promise<RunRow[]> {
  const rows: RunRow[] = await tx
    .select({
      id: scheduledReportRuns.id,
      status: scheduledReportRuns.status,
      createdAt: scheduledReportRuns.createdAt,
      generatedAt: scheduledReportRuns.generatedAt,
      sentAt: scheduledReportRuns.sentAt,
      htmlSizeBytes: scheduledReportRuns.htmlSizeBytes,
      recipientsCount: scheduledReportRuns.recipientsCount,
      errorCode: scheduledReportRuns.errorCode,
    })
    .from(scheduledReportRuns)
    .where(
      and(
        eq(scheduledReportRuns.organizationId, orgId),
        eq(scheduledReportRuns.scheduledReportId, scheduledReportId),
      ),
    )
    .orderBy(desc(scheduledReportRuns.createdAt))
    .limit(limit);
  return rows;
}
