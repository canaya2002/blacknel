import 'server-only';

import { and, eq, gte, sql } from 'drizzle-orm';

import { type AnyPgTx, dbAdmin } from '@/lib/db/client';
import {
  auditEvents,
  brands,
  inboxThreads,
  listeningMentions,
  organizations,
  posts,
  reviews,
  scheduledReportRuns,
  scheduledReports,
} from '@/lib/db/schema';
import { sendEmail } from '@/lib/emails/send';
import { log } from '@/lib/log';
import {
  findDueScheduledReportsWithTx,
  type DueScheduledReport,
} from '@/lib/scheduled-reports/queries';
import {
  renderReportHtml,
  renderReportText,
  type ReportPayload,
} from '@/lib/scheduled-reports/report-builder';
import { nextRunAfter } from '@/lib/scheduled-reports/schedule';
import { ok, type Result } from '@/lib/types/result';

/**
 * Scheduled report dispatcher (Phase 9 / Commit 34).
 *
 * Tick every 15 minutes. For each due `scheduled_reports` row:
 *
 *   1. Insert a `scheduled_report_runs` row in `'queued'` →
 *      flip to `'running'`.
 *   2. Build `ReportPayload` from existing reports queries +
 *      listening top mentions.
 *   3. Render HTML + plain text via `lib/scheduled-reports/
 *      report-builder.ts`.
 *   4. `sendEmail({ kind: 'scheduled_report', html, ... })` for
 *      each recipient (dev outbox today; Resend Phase 11).
 *   5. Mark run `'sent'`, recompute `next_run_at` respecting the
 *      org timezone (R-34-1), update `scheduled_reports`.
 *   6. Audit events (Ajuste B):
 *        - success: `scheduled_report.dispatched`
 *        - failure: `scheduled_report.failed`
 */

export interface ScheduledReportsTickDeps {
  asAdmin: <T>(fn: (tx: AnyPgTx) => Promise<T>) => Promise<T>;
}

const defaultDeps: ScheduledReportsTickDeps = {
  asAdmin: (fn) => dbAdmin(fn),
};

export interface ScheduledReportsTickResult {
  readonly considered: number;
  readonly dispatched: number;
  readonly failed: number;
}

export async function runScheduledReportsTick(input?: {
  now?: Date;
  deps?: ScheduledReportsTickDeps;
}): Promise<Result<ScheduledReportsTickResult>> {
  const now = input?.now ?? new Date();
  const deps = input?.deps ?? defaultDeps;

  const due: DueScheduledReport[] = await deps.asAdmin((tx) =>
    findDueScheduledReportsWithTx(tx, now, 50),
  );

  let dispatched = 0;
  let failed = 0;

  for (const row of due) {
    try {
      await dispatchOne(deps, row, now);
      dispatched += 1;
    } catch (cause) {
      log.error(
        {
          err: (cause as Error).message,
          scheduledReportId: row.id,
        },
        'scheduled_reports.tick.dispatch_failed',
      );
      failed += 1;
    }
  }

  log.info(
    { considered: due.length, dispatched, failed },
    'scheduled_reports.tick',
  );

  return ok({ considered: due.length, dispatched, failed });
}

async function dispatchOne(
  deps: ScheduledReportsTickDeps,
  row: DueScheduledReport,
  now: Date,
): Promise<void> {
  // 1. Insert a run row in `queued`.
  const runIds: Array<{ id: string }> = await deps.asAdmin((tx) =>
    tx
      .insert(scheduledReportRuns)
      .values({
        organizationId: row.organizationId,
        scheduledReportId: row.id,
        status: 'queued',
        recipientsCount: row.recipients.length,
      })
      .returning({ id: scheduledReportRuns.id }),
  );
  const runId = runIds[0]!.id;

  // 2. Flip to running.
  await deps.asAdmin((tx) =>
    tx
      .update(scheduledReportRuns)
      .set({ status: 'running' })
      .where(eq(scheduledReportRuns.id, runId)),
  );

  try {
    // 3. Build payload + render.
    const payload = await buildReportPayload(deps, row, now);
    const html = renderReportHtml(payload);
    const text = renderReportText(payload);
    const htmlSize = Buffer.byteLength(html, 'utf8');

    // 4. Send to each recipient. Dev outbox is per-recipient.
    for (const to of row.recipients) {
      await sendEmail({
        kind: 'scheduled_report',
        to,
        subject: `${payload.brandName} · ${payload.period.label}`,
        text,
        html,
        meta: {
          scheduledReportId: row.id,
          runId,
          brandId: row.brandId,
        },
      });
    }

    // 5. Mark sent + recompute next_run_at.
    const orgTimeZone = await loadOrgTimeZone(deps, row.organizationId);
    const nextRunAt = nextRunAfter(row.scheduleExpr, orgTimeZone, now);
    if (!nextRunAt) {
      throw new Error(`Cannot compute next run for "${row.scheduleExpr}"`);
    }

    await deps.asAdmin(async (tx) => {
      await tx
        .update(scheduledReportRuns)
        .set({
          status: 'sent',
          generatedAt: now,
          sentAt: now,
          htmlSizeBytes: htmlSize,
        })
        .where(eq(scheduledReportRuns.id, runId));
      await tx
        .update(scheduledReports)
        .set({ nextRunAt, lastRunAt: now, updatedAt: now })
        .where(eq(scheduledReports.id, row.id));
    });

    // 6a. Audit success (Ajuste B).
    await deps.asAdmin((tx) =>
      tx.insert(auditEvents).values({
        organizationId: row.organizationId,
        userId: null,
        actorType: 'system',
        action: 'scheduled_report.dispatched',
        entityType: 'scheduled_report',
        entityId: row.id,
        after: {
          scheduled_report_id: row.id,
          brand_id: row.brandId,
          kind: row.kind,
          recipients_count: row.recipients.length,
          next_run_at: nextRunAt.toISOString(),
          html_size_bytes: htmlSize,
        },
        riskLevel: 'low',
      }),
    );
  } catch (cause) {
    const msg = (cause as Error).message ?? 'unknown';
    const code =
      msg.startsWith('Cannot compute') ? 'SCHEDULE_PARSE_FAILED'
      : 'DISPATCH_INTERNAL';

    await deps.asAdmin((tx) =>
      tx
        .update(scheduledReportRuns)
        .set({
          status: 'failed',
          errorCode: code,
          errorMessage: msg.slice(0, 500),
        })
        .where(eq(scheduledReportRuns.id, runId)),
    );

    // 6b. Audit failure (Ajuste B).
    await deps.asAdmin((tx) =>
      tx.insert(auditEvents).values({
        organizationId: row.organizationId,
        userId: null,
        actorType: 'system',
        action: 'scheduled_report.failed',
        entityType: 'scheduled_report',
        entityId: row.id,
        after: {
          error_code: code,
          error_message_truncated: msg.slice(0, 200),
          retry_count: 0,
        },
        riskLevel: 'medium',
      }),
    );

    throw cause;
  }
}

async function loadOrgTimeZone(
  deps: ScheduledReportsTickDeps,
  orgId: string,
): Promise<string> {
  const rows: Array<{ timezone: string | null }> = await deps.asAdmin(
    (tx) =>
      tx
        .select({ timezone: organizations.timezone })
        .from(organizations)
        .where(eq(organizations.id, orgId))
        .limit(1),
  );
  return rows[0]?.timezone ?? 'UTC';
}

async function buildReportPayload(
  deps: ScheduledReportsTickDeps,
  row: DueScheduledReport,
  now: Date,
): Promise<ReportPayload> {
  const since = new Date(now.getTime() - 7 * 86_400_000);
  const sinceIso = since.toISOString();

  let brandName = 'Org overview';
  if (row.brandId) {
    const brandRows: Array<{ name: string }> = await deps.asAdmin((tx) =>
      tx
        .select({ name: brands.name })
        .from(brands)
        .where(eq(brands.id, row.brandId!))
        .limit(1),
    );
    if (brandRows[0]) brandName = brandRows[0].name;
  }

  // Aggregates. Keep them minimal — the cron is not the report
  // query layer, just the dispatch layer.
  const [threadCountRows, postsCountRows, reviewsAggRows]: [
    Array<{ count: number }>,
    Array<{ count: number }>,
    Array<{ count: number; avgRating: number }>,
  ] = await Promise.all([
    deps.asAdmin<Array<{ count: number }>>((tx) =>
      tx
        .select({
          count: sql<number>`COUNT(*)::int`,
        })
        .from(inboxThreads)
        .where(
          and(
            eq(inboxThreads.organizationId, row.organizationId),
            gte(inboxThreads.lastMessageAt, since),
          ),
        ),
    ),
    deps.asAdmin<Array<{ count: number }>>((tx) =>
      tx
        .select({
          count: sql<number>`COUNT(*)::int`,
        })
        .from(posts)
        .where(
          and(
            eq(posts.organizationId, row.organizationId),
            eq(posts.status, 'published'),
            gte(posts.createdAt, since),
          ),
        ),
    ),
    deps.asAdmin<Array<{ count: number; avgRating: number }>>((tx) =>
      tx
        .select({
          count: sql<number>`COUNT(*)::int`,
          avgRating: sql<number>`COALESCE(AVG(${reviews.rating}), 0)::float`,
        })
        .from(reviews)
        .where(
          and(
            eq(reviews.organizationId, row.organizationId),
            gte(reviews.createdAt, since),
          ),
        ),
    ),
  ]);

  const threadCount = threadCountRows[0]?.count ?? 0;
  const postsPublished = postsCountRows[0]?.count ?? 0;
  const reviewsCount = reviewsAggRows[0]?.count ?? 0;
  const avgRating = reviewsAggRows[0]?.avgRating ?? 0;

  // Top mentions (listening) — opt-in; non-Listening orgs see [].
  type MentionLite = {
    platform: string;
    authorHandle: string;
    body: string;
    sentiment: 'positive' | 'neutral' | 'negative' | 'unknown';
  };
  const mentionsRows: MentionLite[] = await deps.asAdmin<MentionLite[]>(
    (tx) =>
      tx
        .select({
          platform: listeningMentions.platform,
          authorHandle: listeningMentions.authorHandle,
          body: listeningMentions.body,
          sentiment: listeningMentions.sentiment,
        })
        .from(listeningMentions)
        .where(
          and(
            eq(listeningMentions.organizationId, row.organizationId),
            gte(listeningMentions.capturedAt, since),
          ),
        )
        .limit(5),
  );

  void sinceIso;

  return {
    brandName,
    period: {
      label: row.kind === 'weekly' ? 'Last 7 days' : 'Last 30 days',
      startAt: since,
      endAt: now,
    },
    kpis: {
      responseTimeMinsP50: null,
      npsScore: null,
      postsPublished,
      adsSpendUsdCents: 0,
    },
    inbox:
      threadCount === 0
        ? []
        : [
            {
              platform: 'all',
              threads: threadCount,
              responseTimeMinsP50: null,
              satisfactionPct: null,
            },
          ],
    reviews:
      reviewsCount === 0
        ? []
        : [
            {
              platform: 'all',
              count: reviewsCount,
              avgRating,
              responseRatePct: 0,
              sentiment: 'unknown',
            },
          ],
    mentions: mentionsRows.map(
      (m): {
        platform: string;
        authorHandle: string;
        bodyExcerpt: string;
        sentiment: 'positive' | 'neutral' | 'negative' | 'unknown';
      } => ({
        platform: m.platform,
        authorHandle: m.authorHandle,
        bodyExcerpt: m.body.slice(0, 140),
        sentiment: m.sentiment,
      }),
    ),
    generatedAt: now,
  };
}

/** cron-loop entry point — keeps the wrapper shape uniform. */
export async function runScheduledReportsTickEntry(): Promise<
  Result<ScheduledReportsTickResult>
> {
  return runScheduledReportsTick();
}
