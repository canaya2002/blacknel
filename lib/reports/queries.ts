import 'server-only';

import { and, eq, gte, lte, sql, type SQL } from 'drizzle-orm';

import { type AnyPgTx, dbAs } from '../db/client';
import {
  aiGenerations,
  aiRecommendations,
  inboxThreads,
  postTargets,
  posts,
  reviewResponses,
  reviews,
} from '../db/schema';

import { computeRange, makeDelta, type DeltaShape, type ReportPeriod } from './period';

/**
 * Aggregated read layer for /reports (Phase 8 / Commit 27).
 *
 * **Strict rule (Phase 8 charter):** never modify Phase 1-7
 * schema or queries. Reports compute on top of whatever the
 * existing tables already store; if a query would be more
 * efficient with a new index or a new column, this file does
 * NOT add it — Phase 11 cutover or a future mini-phase handles
 * the optimization.
 *
 * Every section function returns a shape that mirrors the UI
 * KPI cards (`{current, previous, delta, trend}`) per Ajuste 1.
 * The page loader fans out via `Promise.all` under one `dbAs`.
 *
 * # Cost
 *
 * AI cost rollup reads from `ai_generations` (Phase 7). No new
 * columns or indexes; we use the existing
 * `ai_generations_org_created_idx`.
 *
 * # Reviews / Inbox
 *
 * Aggregations stay on the simplest cuts the existing indexes
 * support: `reviews_org_created_idx`,
 * `inbox_threads_org_last_message_idx`. No FTS, no per-tag
 * breakdown — those land alongside their respective surfaces
 * already.
 */

export interface SectionPayload {
  readonly responseTimeAvgMs: DeltaShape;
  readonly inboxThreadCount: DeltaShape;
  readonly reviewsAvg: DeltaShape;
  readonly reviewsCount: DeltaShape;
  readonly reviewsResponseRate: DeltaShape;
  readonly postsPublishedCount: DeltaShape;
  readonly postsFailedCount: DeltaShape;
  readonly aiCostCents: DeltaShape;
  readonly aiGenerationsCount: DeltaShape;
  readonly crisisRecsPending: number;
  readonly crisisAcceptedRatio: number | null;
}

export interface LoadReportsOpts {
  readonly orgId: string;
  readonly userId: string;
  readonly period: ReportPeriod;
  readonly brandId: string | null;
  readonly now: Date;
}

export async function loadOverviewReport(
  opts: LoadReportsOpts,
): Promise<SectionPayload> {
  return dbAs({ orgId: opts.orgId, userId: opts.userId }, (tx) =>
    loadOverviewReportWithTx(tx, opts),
  );
}

export async function loadOverviewReportWithTx(
  tx: AnyPgTx,
  opts: LoadReportsOpts,
): Promise<SectionPayload> {
  const range = computeRange(opts.period, opts.now);

  // Brand scope is honored where the underlying table carries
  // a `brand_id` column (reviews, posts). Inbox + AI rows are
  // not brand-scoped today; the brand filter is a no-op there
  // (documented inline).
  const brandReviewsCondition = opts.brandId
    ? eq(reviews.brandId, opts.brandId)
    : sql`true`;
  const brandPostsCondition = opts.brandId
    ? eq(posts.brandId, opts.brandId)
    : sql`true`;

  // ---- Inbox: response time avg (outbound minus prior inbound) ----
  // Pulls per-thread last-inbound + first-outbound pair from
  // `inbox_messages.sent_at`. Phase-4 schema doesn't materialize
  // response time anywhere — we compute on the fly, scanning at
  // most the period's slice of messages.
  type RtRow = { avgMs: string | number | null };
  const rtCurrent = (await tx
    .select({
      avgMs: sql<string | number | null>`
        COALESCE(AVG(EXTRACT(EPOCH FROM (out_msgs.first_out_at - in_msgs.last_in_at)) * 1000), NULL)
      `,
    })
    .from(
      sql`(
        SELECT thread_id, MAX(sent_at) AS last_in_at
        FROM inbox_messages
        WHERE organization_id = ${opts.orgId}
          AND direction = 'inbound'
          AND sent_at >= ${range.currentStart.toISOString()}::timestamptz
          AND sent_at <= ${range.currentEnd.toISOString()}::timestamptz
        GROUP BY thread_id
      ) AS in_msgs
      INNER JOIN (
        SELECT thread_id, MIN(sent_at) AS first_out_at
        FROM inbox_messages
        WHERE organization_id = ${opts.orgId}
          AND direction = 'outbound'
          AND sent_at >= ${range.currentStart.toISOString()}::timestamptz
          AND sent_at <= ${range.currentEnd.toISOString()}::timestamptz
        GROUP BY thread_id
      ) AS out_msgs ON in_msgs.thread_id = out_msgs.thread_id
      `,
    )) as RtRow[];
  const rtPrevious = (await tx
    .select({
      avgMs: sql<string | number | null>`
        COALESCE(AVG(EXTRACT(EPOCH FROM (out_msgs.first_out_at - in_msgs.last_in_at)) * 1000), NULL)
      `,
    })
    .from(
      sql`(
        SELECT thread_id, MAX(sent_at) AS last_in_at
        FROM inbox_messages
        WHERE organization_id = ${opts.orgId}
          AND direction = 'inbound'
          AND sent_at >= ${range.previousStart.toISOString()}::timestamptz
          AND sent_at <= ${range.previousEnd.toISOString()}::timestamptz
        GROUP BY thread_id
      ) AS in_msgs
      INNER JOIN (
        SELECT thread_id, MIN(sent_at) AS first_out_at
        FROM inbox_messages
        WHERE organization_id = ${opts.orgId}
          AND direction = 'outbound'
          AND sent_at >= ${range.previousStart.toISOString()}::timestamptz
          AND sent_at <= ${range.previousEnd.toISOString()}::timestamptz
        GROUP BY thread_id
      ) AS out_msgs ON in_msgs.thread_id = out_msgs.thread_id
      `,
    )) as RtRow[];

  // ---- Inbox: thread count opened in period ----
  type ThreadCountRow = { n: string | number };
  const threadsCurrent = (await tx
    .select({ n: sql<string | number>`COUNT(${inboxThreads.id})::int` })
    .from(inboxThreads)
    .where(
      and(
        eq(inboxThreads.organizationId, opts.orgId),
        gte(inboxThreads.createdAt, range.currentStart),
        lte(inboxThreads.createdAt, range.currentEnd),
      ),
    )) as ThreadCountRow[];
  const threadsPrevious = (await tx
    .select({ n: sql<string | number>`COUNT(${inboxThreads.id})::int` })
    .from(inboxThreads)
    .where(
      and(
        eq(inboxThreads.organizationId, opts.orgId),
        gte(inboxThreads.createdAt, range.previousStart),
        lte(inboxThreads.createdAt, range.previousEnd),
      ),
    )) as ThreadCountRow[];

  // ---- Reviews: avg + count + response rate ----
  type ReviewAggRow = {
    avg: string | number | null;
    count: string | number;
    responded: string | number;
  };
  const reviewsCurrent = (await tx
    .select({
      avg: sql<string | number | null>`AVG(${reviews.rating})`,
      count: sql<string | number>`COUNT(${reviews.id})::int`,
      responded: sql<string | number>`COALESCE(SUM(CASE WHEN ${reviews.status} = 'responded' THEN 1 ELSE 0 END), 0)::int`,
    })
    .from(reviews)
    .where(
      and(
        eq(reviews.organizationId, opts.orgId),
        gte(reviews.createdAt, range.currentStart),
        lte(reviews.createdAt, range.currentEnd),
        brandReviewsCondition,
      ),
    )) as ReviewAggRow[];
  const reviewsPrev = (await tx
    .select({
      avg: sql<string | number | null>`AVG(${reviews.rating})`,
      count: sql<string | number>`COUNT(${reviews.id})::int`,
      responded: sql<string | number>`COALESCE(SUM(CASE WHEN ${reviews.status} = 'responded' THEN 1 ELSE 0 END), 0)::int`,
    })
    .from(reviews)
    .where(
      and(
        eq(reviews.organizationId, opts.orgId),
        gte(reviews.createdAt, range.previousStart),
        lte(reviews.createdAt, range.previousEnd),
        brandReviewsCondition,
      ),
    )) as ReviewAggRow[];

  // ---- Publishing: posts published + failed ----
  type PostCountRow = { published: string | number; failed: string | number };
  const postsCurrent = (await tx
    .select({
      published: sql<string | number>`COALESCE(SUM(CASE WHEN ${posts.status} = 'published' THEN 1 ELSE 0 END), 0)::int`,
      failed: sql<string | number>`COALESCE(SUM(CASE WHEN ${posts.status} = 'failed' THEN 1 ELSE 0 END), 0)::int`,
    })
    .from(posts)
    .where(
      and(
        eq(posts.organizationId, opts.orgId),
        gte(posts.createdAt, range.currentStart),
        lte(posts.createdAt, range.currentEnd),
        brandPostsCondition,
      ),
    )) as PostCountRow[];
  const postsPrev = (await tx
    .select({
      published: sql<string | number>`COALESCE(SUM(CASE WHEN ${posts.status} = 'published' THEN 1 ELSE 0 END), 0)::int`,
      failed: sql<string | number>`COALESCE(SUM(CASE WHEN ${posts.status} = 'failed' THEN 1 ELSE 0 END), 0)::int`,
    })
    .from(posts)
    .where(
      and(
        eq(posts.organizationId, opts.orgId),
        gte(posts.createdAt, range.previousStart),
        lte(posts.createdAt, range.previousEnd),
        brandPostsCondition,
      ),
    )) as PostCountRow[];

  // ---- AI: cost cents + generations count ----
  type AiAggRow = { cost: string | number; n: string | number };
  const aiCurrent = (await tx
    .select({
      cost: sql<string | number>`COALESCE(SUM(${aiGenerations.costCents}), 0)::int`,
      n: sql<string | number>`COUNT(${aiGenerations.id})::int`,
    })
    .from(aiGenerations)
    .where(
      and(
        eq(aiGenerations.organizationId, opts.orgId),
        gte(aiGenerations.createdAt, range.currentStart),
        lte(aiGenerations.createdAt, range.currentEnd),
      ),
    )) as AiAggRow[];
  const aiPrev = (await tx
    .select({
      cost: sql<string | number>`COALESCE(SUM(${aiGenerations.costCents}), 0)::int`,
      n: sql<string | number>`COUNT(${aiGenerations.id})::int`,
    })
    .from(aiGenerations)
    .where(
      and(
        eq(aiGenerations.organizationId, opts.orgId),
        gte(aiGenerations.createdAt, range.previousStart),
        lte(aiGenerations.createdAt, range.previousEnd),
      ),
    )) as AiAggRow[];

  // ---- Crisis: pending count + accepted ratio ----
  type CrisisRow = {
    pending: string | number;
    accepted: string | number;
    decided: string | number;
  };
  const crisisRows = (await tx
    .select({
      pending: sql<string | number>`COALESCE(SUM(CASE WHEN ${aiRecommendations.status} = 'pending' THEN 1 ELSE 0 END), 0)::int`,
      accepted: sql<string | number>`COALESCE(SUM(CASE WHEN ${aiRecommendations.status} = 'accepted' THEN 1 ELSE 0 END), 0)::int`,
      decided: sql<string | number>`COALESCE(SUM(CASE WHEN ${aiRecommendations.status} IN ('accepted', 'dismissed') THEN 1 ELSE 0 END), 0)::int`,
    })
    .from(aiRecommendations)
    .where(
      and(
        eq(aiRecommendations.organizationId, opts.orgId),
        eq(aiRecommendations.category, 'crisis'),
        gte(aiRecommendations.createdAt, range.currentStart),
      ),
    )) as CrisisRow[];

  // ---- Assemble payload ----
  const rtCur = toNum(rtCurrent[0]?.avgMs);
  const rtPrev = toNum(rtPrevious[0]?.avgMs);
  const responseRateCur =
    toNum(reviewsCurrent[0]?.count) && toNum(reviewsCurrent[0]?.count)! > 0
      ? (toNum(reviewsCurrent[0]?.responded) ?? 0) /
        (toNum(reviewsCurrent[0]?.count) ?? 1) *
        100
      : null;
  const responseRatePrev =
    toNum(reviewsPrev[0]?.count) && toNum(reviewsPrev[0]?.count)! > 0
      ? (toNum(reviewsPrev[0]?.responded) ?? 0) /
        (toNum(reviewsPrev[0]?.count) ?? 1) *
        100
      : null;

  const acceptedCnt = toNum(crisisRows[0]?.accepted) ?? 0;
  const decidedCnt = toNum(crisisRows[0]?.decided) ?? 0;
  const crisisAcceptedRatio =
    decidedCnt > 0 ? acceptedCnt / decidedCnt : null;

  return {
    responseTimeAvgMs: makeDelta(rtCur, rtPrev),
    inboxThreadCount: makeDelta(
      toNum(threadsCurrent[0]?.n) ?? 0,
      toNum(threadsPrevious[0]?.n) ?? 0,
    ),
    reviewsAvg: makeDelta(
      toNum(reviewsCurrent[0]?.avg),
      toNum(reviewsPrev[0]?.avg),
    ),
    reviewsCount: makeDelta(
      toNum(reviewsCurrent[0]?.count) ?? 0,
      toNum(reviewsPrev[0]?.count) ?? 0,
    ),
    reviewsResponseRate: makeDelta(responseRateCur, responseRatePrev),
    postsPublishedCount: makeDelta(
      toNum(postsCurrent[0]?.published) ?? 0,
      toNum(postsPrev[0]?.published) ?? 0,
    ),
    postsFailedCount: makeDelta(
      toNum(postsCurrent[0]?.failed) ?? 0,
      toNum(postsPrev[0]?.failed) ?? 0,
    ),
    aiCostCents: makeDelta(
      toNum(aiCurrent[0]?.cost) ?? 0,
      toNum(aiPrev[0]?.cost) ?? 0,
    ),
    aiGenerationsCount: makeDelta(
      toNum(aiCurrent[0]?.n) ?? 0,
      toNum(aiPrev[0]?.n) ?? 0,
    ),
    crisisRecsPending: toNum(crisisRows[0]?.pending) ?? 0,
    crisisAcceptedRatio,
  };
}

// ---------------------------------------------------------------------------
// AI cost per-skill rollup — surface for the AI section + CSV export
// ---------------------------------------------------------------------------

export interface AiSkillCostRow {
  readonly skill: string;
  readonly model: string;
  readonly costCents: number;
  readonly generations: number;
  readonly cacheHits: number;
}

export async function loadAiSkillCosts(opts: {
  orgId: string;
  userId: string;
  period: ReportPeriod;
  now: Date;
}): Promise<ReadonlyArray<AiSkillCostRow>> {
  return dbAs({ orgId: opts.orgId, userId: opts.userId }, (tx) =>
    loadAiSkillCostsWithTx(tx, opts),
  );
}

export async function loadAiSkillCostsWithTx(
  tx: AnyPgTx,
  opts: { orgId: string; period: ReportPeriod; now: Date },
): Promise<ReadonlyArray<AiSkillCostRow>> {
  const range = computeRange(opts.period, opts.now);
  type Row = {
    skill: string;
    model: string;
    cost: string | number;
    n: string | number;
    hits: string | number;
  };
  const rows = (await tx
    .select({
      skill: aiGenerations.skill,
      model: aiGenerations.model,
      cost: sql<string | number>`COALESCE(SUM(${aiGenerations.costCents}), 0)::int`,
      n: sql<string | number>`COUNT(${aiGenerations.id})::int`,
      hits: sql<string | number>`COALESCE(SUM(CASE WHEN ${aiGenerations.cacheHit} THEN 1 ELSE 0 END), 0)::int`,
    })
    .from(aiGenerations)
    .where(
      and(
        eq(aiGenerations.organizationId, opts.orgId),
        gte(aiGenerations.createdAt, range.currentStart),
        lte(aiGenerations.createdAt, range.currentEnd),
      ),
    )
    .groupBy(aiGenerations.skill, aiGenerations.model)
    .orderBy(sql`SUM(${aiGenerations.costCents}) DESC`)) as Row[];

  return rows.map((r): AiSkillCostRow => ({
    skill: r.skill,
    model: r.model,
    costCents: toNum(r.cost) ?? 0,
    generations: toNum(r.n) ?? 0,
    cacheHits: toNum(r.hits) ?? 0,
  }));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toNum(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Keep imports referenced — these schemas may be queried in
// future Phase-8 commits (Publishing per-platform breakdown,
// review response timing) without re-import gymnastics.
void postTargets;
void reviewResponses;
type _PreserveSqlBindings = SQL;
void (null as unknown as _PreserveSqlBindings | null);
