'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { requireUser } from '@/lib/auth/server';
import { dbAdmin, dbAs } from '@/lib/db/client';
import {
  auditEvents,
  organizations,
  scheduledReports,
} from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { runScheduledReportsTick } from '@/lib/jobs/scheduled-reports-tick';
import { authorize } from '@/lib/permissions/can';
import { requirePlanFeature } from '@/lib/plans/gates';
import { getOrgPlanCode } from '@/lib/queries/plan';
import { nextRunAfter } from '@/lib/scheduled-reports/schedule';
import {
  createScheduledReportSchema,
  pauseScheduledReportSchema,
  runScheduledReportNowSchema,
} from '@/lib/scheduled-reports/validate';
import { err, ok, type Result } from '@/lib/types/result';

/**
 * Scheduled-reports Server Actions (Phase 9 / Commit 34).
 *
 *   - `createScheduledReportAction` — admin/manager+ creates a
 *     scheduled report; `next_run_at` computed via the org timezone
 *     (R-34-1).
 *   - `pauseScheduledReportAction`  — toggle active/paused.
 *   - `runScheduledReportNowAction` — manual "fire now" — bumps
 *     `next_run_at` to `now` and triggers the dispatcher tick
 *     scoped to this report.
 */

export async function createScheduledReportAction(
  _prev: unknown,
  input: unknown,
): Promise<Result<{ scheduledReportId: string; nextRunAt: string }>> {
  const session = await requireUser();
  authorize(session.role, 'scheduled_reports:manage');

  const plan = await getOrgPlanCode(session);
  try {
    requirePlanFeature(plan, 'scheduled_report_emails');
  } catch (e) {
    if (e instanceof AppError) return err(e);
    throw e;
  }

  const parsed = createScheduledReportSchema.safeParse(input);
  if (!parsed.success) {
    return err('VALIDATION_ERROR', 'Datos del schedule inválidos.', {
      meta: { issues: parsed.error.flatten() },
    });
  }
  const data = parsed.data;

  // R-34-1: compute next_run_at using the org's timezone.
  const orgRows: Array<{ timezone: string | null }> = await dbAs(
    { orgId: session.orgId, userId: session.userId },
    (tx) =>
      tx
        .select({ timezone: organizations.timezone })
        .from(organizations)
        .where(eq(organizations.id, session.orgId))
        .limit(1),
  );
  const tz = orgRows[0]?.timezone ?? 'UTC';
  const nextRunAt = nextRunAfter(data.scheduleExpr, tz);
  if (!nextRunAt) {
    return err(
      'VALIDATION_ERROR',
      `No se pudo computar next_run_at para "${data.scheduleExpr}".`,
    );
  }

  const inserted = await dbAs<Array<{ id: string }>>(
    { orgId: session.orgId, userId: session.userId },
    (tx) =>
      tx
        .insert(scheduledReports)
        .values({
          organizationId: session.orgId,
          ...(data.brandId ? { brandId: data.brandId } : {}),
          name: data.name,
          kind: data.kind,
          scheduleExpr: data.scheduleExpr,
          recipients: data.recipients,
          status: 'active',
          nextRunAt,
        })
        .returning({ id: scheduledReports.id }),
  );
  const scheduledReportId = inserted[0]?.id;
  if (!scheduledReportId) {
    return err('INTERNAL_ERROR', 'No se pudo crear el schedule.');
  }

  try {
    await dbAdmin((tx) =>
      tx.insert(auditEvents).values({
        organizationId: session.orgId,
        userId: session.userId,
        actorType: 'user',
        action: 'scheduled_report.created',
        entityType: 'scheduled_report',
        entityId: scheduledReportId,
        after: {
          kind: data.kind,
          scheduleExpr: data.scheduleExpr,
          recipientsCount: data.recipients.length,
          nextRunAt: nextRunAt.toISOString(),
          timeZone: tz,
        },
        riskLevel: 'low',
      }),
    );
  } catch (cause) {
    throw new AppError(
      'INTERNAL_ERROR',
      'Failed to audit scheduled_report.created.',
      { cause, meta: { scheduledReportId } },
    );
  }

  revalidatePath('/reports');
  return ok({
    scheduledReportId,
    nextRunAt: nextRunAt.toISOString(),
  });
}

export async function pauseScheduledReportAction(
  _prev: unknown,
  input: unknown,
): Promise<
  Result<{
    scheduledReportId: string;
    status: 'active' | 'paused';
  }>
> {
  const session = await requireUser();
  authorize(session.role, 'scheduled_reports:manage');

  const plan = await getOrgPlanCode(session);
  try {
    requirePlanFeature(plan, 'scheduled_report_emails');
  } catch (e) {
    if (e instanceof AppError) return err(e);
    throw e;
  }

  const parsed = pauseScheduledReportSchema.safeParse(input);
  if (!parsed.success) {
    return err('VALIDATION_ERROR', 'Input inválido.');
  }
  const status: 'active' | 'paused' = parsed.data.paused
    ? 'paused'
    : 'active';

  const now = new Date();
  const updated = await dbAs<Array<{ id: string }>>(
    { orgId: session.orgId, userId: session.userId },
    (tx) =>
      tx
        .update(scheduledReports)
        .set({ status, updatedAt: now })
        .where(
          and(
            eq(scheduledReports.organizationId, session.orgId),
            eq(scheduledReports.id, parsed.data.scheduledReportId),
          ),
        )
        .returning({ id: scheduledReports.id }),
  );
  if (updated.length === 0) {
    return err('NOT_FOUND', 'Schedule no encontrado.');
  }

  try {
    await dbAdmin((tx) =>
      tx.insert(auditEvents).values({
        organizationId: session.orgId,
        userId: session.userId,
        actorType: 'user',
        action: 'scheduled_report.status_changed',
        entityType: 'scheduled_report',
        entityId: parsed.data.scheduledReportId,
        after: { status },
        riskLevel: 'low',
      }),
    );
  } catch (cause) {
    throw new AppError(
      'INTERNAL_ERROR',
      'Failed to audit scheduled_report.status_changed.',
      { cause },
    );
  }

  revalidatePath('/reports');
  return ok({
    scheduledReportId: parsed.data.scheduledReportId,
    status,
  });
}

export async function runScheduledReportNowAction(
  _prev: unknown,
  input: unknown,
): Promise<Result<{ scheduledReportId: string; dispatched: boolean }>> {
  const session = await requireUser();
  authorize(session.role, 'scheduled_reports:manage');

  const plan = await getOrgPlanCode(session);
  try {
    requirePlanFeature(plan, 'scheduled_report_emails');
  } catch (e) {
    if (e instanceof AppError) return err(e);
    throw e;
  }

  const parsed = runScheduledReportNowSchema.safeParse(input);
  if (!parsed.success) {
    return err('VALIDATION_ERROR', 'Input inválido.');
  }

  // Bump next_run_at to now so the dispatcher picks it up
  // immediately on the next tick fire. We then invoke the tick
  // synchronously inside the request so the user sees the result.
  const now = new Date();
  const updated = await dbAs<Array<{ id: string }>>(
    { orgId: session.orgId, userId: session.userId },
    (tx) =>
      tx
        .update(scheduledReports)
        .set({ nextRunAt: now, updatedAt: now })
        .where(
          and(
            eq(scheduledReports.organizationId, session.orgId),
            eq(scheduledReports.id, parsed.data.scheduledReportId),
            eq(scheduledReports.status, 'active'),
          ),
        )
        .returning({ id: scheduledReports.id }),
  );
  if (updated.length === 0) {
    return err(
      'NOT_FOUND',
      'Schedule no encontrado (verificá que esté en status active).',
    );
  }

  const result = await runScheduledReportsTick({ now });
  if (!result.ok) {
    return err(
      'INTERNAL_ERROR',
      `Dispatcher tick falló: ${result.error.message}`,
    );
  }

  revalidatePath('/reports');
  return ok({
    scheduledReportId: parsed.data.scheduledReportId,
    dispatched: result.data.dispatched > 0,
  });
}
