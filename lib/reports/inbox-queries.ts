import 'server-only';

import { and, eq, gte, lte, sql } from 'drizzle-orm';

import { dbAs, type AnyPgTx } from '@/lib/db/client';
import { inboxMessages, inboxThreads } from '@/lib/db/schema';

import {
  computeRange,
  makeDelta,
  type DeltaShape,
  type ReportPeriod,
} from './period';

/**
 * Inbox section query for /reports (Phase 8 / Commit 30).
 *
 * Reads only existing Phase-4 columns — `inbox_messages.sent_at +
 * direction + author_type` and `inbox_threads.platform + status +
 * created_at + closed_at`. Phase-8 charter rule respected; no
 * extension of Phase-4 schema or indexes.
 *
 * The 4 KPIs:
 *
 *   - **response time p50** — per-thread first-out − last-in (ms).
 *     Computed via subquery just like the Overview tab does for
 *     the AVG version (Commit 27). The p50 percentile lives
 *     server-side via `PERCENTILE_CONT`.
 *   - **threads opened** — `inbox_threads.createdAt` in window.
 *   - **threads closed** — `inbox_threads.closedAt` in window.
 *   - **AI-assisted reply ratio** — outbound messages with
 *     `author_type='ai'` / all outbound messages in window.
 *
 * **Brand filter** — inbox tables don't carry `brand_id` today,
 * so the brand selector is a no-op for this tab. Documented to
 * the user via a tooltip; the underlying query just skips the
 * brand condition.
 */

export interface InboxReportPayload {
  readonly responseTimeP50Ms: DeltaShape;
  readonly threadsOpened: DeltaShape;
  readonly threadsClosed: DeltaShape;
  readonly aiAssistedReplyRatio: DeltaShape;
}

export interface LoadInboxReportOpts {
  readonly orgId: string;
  readonly userId: string;
  readonly period: ReportPeriod;
  /** Inbox tables have no brand_id today — accepted but ignored. */
  readonly brandId: string | null;
  readonly now: Date;
}

export async function loadInboxReport(
  opts: LoadInboxReportOpts,
): Promise<InboxReportPayload> {
  return dbAs({ orgId: opts.orgId, userId: opts.userId }, (tx) =>
    loadInboxReportWithTx(tx, opts),
  );
}

interface PeriodAggregates {
  responseTimeP50Ms: number | null;
  threadsOpened: number;
  threadsClosed: number;
  aiOutbound: number;
  totalOutbound: number;
}

async function fetchPeriod(
  tx: AnyPgTx,
  orgId: string,
  start: Date,
  end: Date,
): Promise<PeriodAggregates> {
  const startIso = start.toISOString();
  const endIso = end.toISOString();

  type P50Row = { p50: string | number | null };
  const p50Rows: P50Row[] = await tx
    .select({
      p50: sql<string | number | null>`
        percentile_cont(0.5) within group (
          order by (extract(epoch from (out_msgs.first_out_at - in_msgs.last_in_at)) * 1000)
        )
      `,
    })
    .from(
      sql`(
        select thread_id, max(sent_at) as last_in_at
        from inbox_messages
        where organization_id = ${orgId}
          and direction = 'inbound'
          and sent_at >= ${startIso}::timestamptz
          and sent_at <= ${endIso}::timestamptz
        group by thread_id
      ) as in_msgs
      inner join (
        select thread_id, min(sent_at) as first_out_at
        from inbox_messages
        where organization_id = ${orgId}
          and direction = 'outbound'
          and sent_at >= ${startIso}::timestamptz
          and sent_at <= ${endIso}::timestamptz
        group by thread_id
      ) as out_msgs on in_msgs.thread_id = out_msgs.thread_id`,
    );

  type CountRow = { n: string | number };
  const openedRows: CountRow[] = await tx
    .select({ n: sql<string | number>`count(${inboxThreads.id})::int` })
    .from(inboxThreads)
    .where(
      and(
        eq(inboxThreads.organizationId, orgId),
        gte(inboxThreads.createdAt, start),
        lte(inboxThreads.createdAt, end),
      ),
    );

  const closedRows: CountRow[] = await tx
    .select({ n: sql<string | number>`count(${inboxThreads.id})::int` })
    .from(inboxThreads)
    .where(
      and(
        eq(inboxThreads.organizationId, orgId),
        sql`${inboxThreads.closedAt} IS NOT NULL`,
        gte(inboxThreads.closedAt, start),
        lte(inboxThreads.closedAt, end),
      ),
    );

  type ReplyRow = { ai: string | number; total: string | number };
  const replyRows: ReplyRow[] = await tx
    .select({
      ai: sql<string | number>`coalesce(sum(case when ${inboxMessages.authorType} = 'ai' then 1 else 0 end), 0)::int`,
      total: sql<string | number>`count(${inboxMessages.id})::int`,
    })
    .from(inboxMessages)
    .where(
      and(
        eq(inboxMessages.organizationId, orgId),
        eq(inboxMessages.direction, 'outbound'),
        gte(inboxMessages.sentAt, start),
        lte(inboxMessages.sentAt, end),
      ),
    );

  const p50Raw = p50Rows[0]?.p50;
  return {
    responseTimeP50Ms: p50Raw == null ? null : Number(p50Raw),
    threadsOpened: Number(openedRows[0]?.n ?? 0),
    threadsClosed: Number(closedRows[0]?.n ?? 0),
    aiOutbound: Number(replyRows[0]?.ai ?? 0),
    totalOutbound: Number(replyRows[0]?.total ?? 0),
  };
}

export async function loadInboxReportWithTx(
  tx: AnyPgTx,
  opts: LoadInboxReportOpts,
): Promise<InboxReportPayload> {
  const range = computeRange(opts.period, opts.now);

  const [cur, prev] = await Promise.all([
    fetchPeriod(tx, opts.orgId, range.currentStart, range.currentEnd),
    fetchPeriod(tx, opts.orgId, range.previousStart, range.previousEnd),
  ]);

  const curRatio =
    cur.totalOutbound > 0 ? (cur.aiOutbound / cur.totalOutbound) * 100 : 0;
  const prevRatio =
    prev.totalOutbound > 0 ? (prev.aiOutbound / prev.totalOutbound) * 100 : 0;

  return {
    responseTimeP50Ms: makeDelta(cur.responseTimeP50Ms, prev.responseTimeP50Ms),
    threadsOpened: makeDelta(cur.threadsOpened, prev.threadsOpened),
    threadsClosed: makeDelta(cur.threadsClosed, prev.threadsClosed),
    aiAssistedReplyRatio: makeDelta(curRatio, prevRatio),
  };
}
