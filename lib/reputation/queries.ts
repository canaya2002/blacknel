import 'server-only';

import { and, count, eq, gte, lt, sql, type SQL } from 'drizzle-orm';

import type { PlatformCode } from '../connectors/base';
import { type AnyPgTx, dbAs } from '../db/client';
import { reviewResponses, reviews } from '../db/schema';

import { CRISIS_WINDOW_HOURS, evaluateCrisis, type CrisisResult } from './crisis-rule';
import { computeDelta, type DeltaResult } from './deltas';
import { type ReputationFilters, previousWindow } from './filters';

/**
 * /reputation aggregation primitives.
 *
 * Every read goes through `dbAs` so RLS evaluates exactly like
 * production. The redundant `eq(reviews.organizationId, orgId)`
 * predicate that shows up everywhere is defense in depth and helps
 * the planner pick the `reviews_org_*` indexes.
 *
 * # Single-pass loader (Ajuste extra)
 *
 * `loadReputationDashboardData` is the ONLY function the page calls.
 * It fans out into all the per-card queries via Promise.all so the
 * dashboard renders in one round of parallel reads, not N round-trips.
 * Each underlying query is also exported with `*WithTx` so the
 * integration tests can verify the loader calls each one exactly
 * once — the load-time guarantee the master prompt rule 9 demands.
 *
 * # The query catalogue
 *
 *   - getOverviewMetricsWithTx       → KPI numerator: avg rating,
 *                                      review count, response count,
 *                                      response rate.
 *   - getStarDistributionWithTx      → 1★..5★ counts.
 *   - getSentimentDistributionWithTx → positive/neutral/negative/unknown
 *                                      counts.
 *   - getRatingTrendWithTx           → weekly avg rating across the window.
 *   - getTopTagsWithTx               → unnest jsonb tags → group by →
 *                                      tag stats (count, sentiment dominant).
 *   - getResponseTimeStatsWithTx     → avg / p50 / p90 lag in hours.
 *   - getCrisisCountsWithTx          → recent + previous 72h negative counts
 *                                      that feed `evaluateCrisis`.
 *
 * Each `*WithTx` accepts an `AnyPgTx` so a higher-level wrapper can
 * reuse one transaction (the loader). The non-Tx variants exist for
 * tests / callers that want a one-shot read.
 */

// ---------------------------------------------------------------------------
// Shared filter predicate
// ---------------------------------------------------------------------------

function applyScope(
  orgId: string,
  filters: ReputationFilters,
  extra: SQL[] = [],
): SQL[] {
  const conditions: SQL[] = [eq(reviews.organizationId, orgId), ...extra];
  if (filters.brandId) conditions.push(eq(reviews.brandId, filters.brandId));
  if (filters.locationId) conditions.push(eq(reviews.locationId, filters.locationId));
  if (filters.platform)
    conditions.push(eq(reviews.platform, filters.platform as string));
  return conditions;
}

function withinWindow(from: Date, to: Date): SQL[] {
  return [gte(reviews.postedAt, from), lt(reviews.postedAt, to)];
}

// ---------------------------------------------------------------------------
// Overview KPIs (current + previous windows)
// ---------------------------------------------------------------------------

export interface OverviewMetrics {
  readonly reviewCount: number;
  readonly ratingAvg: number | null;
  readonly responseCount: number;
  /** 0..100, NULL when there are zero reviews. */
  readonly responseRate: number | null;
}

export async function getOverviewMetricsWithTx(
  tx: AnyPgTx,
  orgId: string,
  filters: ReputationFilters,
  range: { from: Date; to: Date },
): Promise<OverviewMetrics> {
  const conditions = applyScope(orgId, filters, withinWindow(range.from, range.to));

  type AggRow = {
    rc: string | number;
    avg: string | null;
    resp: string | number;
  };

  // LEFT JOIN against a deduplicated review_responses subquery so the
  // response count is "reviews with at least one published response",
  // one per review. `COUNT(*) FILTER (WHERE EXISTS (...))` reads more
  // concisely but the correlated EXISTS doesn't bind reliably across
  // both pglite and postgres-js; the JOIN form compiles to a clean
  // hash join under both adapters and stays portable.
  const aggRows: AggRow[] = await tx
    .select({
      rc: count(reviews.id),
      avg: sql<string | null>`AVG(${reviews.rating})`.as('avg'),
      resp: sql<string | number>`COUNT(DISTINCT rr.review_id)`.as('resp'),
    })
    .from(reviews)
    .leftJoin(
      sql`(
        SELECT review_id
        FROM ${reviewResponses}
        WHERE status = 'published'
        GROUP BY review_id
      ) AS rr`,
      sql`rr.review_id = ${reviews.id}`,
    )
    .where(and(...conditions));

  const row = aggRows[0];
  if (!row) {
    return { reviewCount: 0, ratingAvg: null, responseCount: 0, responseRate: null };
  }
  const reviewCount = toNum(row.rc) ?? 0;
  const responseCount = toNum(row.resp) ?? 0;
  return {
    reviewCount,
    ratingAvg: toNum(row.avg),
    responseCount,
    responseRate:
      reviewCount === 0 ? null : (responseCount / reviewCount) * 100,
  };
}

// ---------------------------------------------------------------------------
// Star distribution
// ---------------------------------------------------------------------------

export interface StarDistribution {
  readonly counts: Readonly<Record<1 | 2 | 3 | 4 | 5, number>>;
  readonly total: number;
}

export async function getStarDistributionWithTx(
  tx: AnyPgTx,
  orgId: string,
  filters: ReputationFilters,
  range: { from: Date; to: Date },
): Promise<StarDistribution> {
  const conditions = applyScope(orgId, filters, withinWindow(range.from, range.to));
  const rows: Array<{ rating: number; n: string | number }> = await tx
    .select({ rating: reviews.rating, n: count(reviews.id) })
    .from(reviews)
    .where(and(...conditions))
    .groupBy(reviews.rating);
  const counts: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let total = 0;
  for (const r of rows) {
    const rating = r.rating as 1 | 2 | 3 | 4 | 5;
    if (rating >= 1 && rating <= 5) {
      const n = toNum(r.n) ?? 0;
      counts[rating] = n;
      total += n;
    }
  }
  return { counts, total };
}

// ---------------------------------------------------------------------------
// Sentiment distribution
// ---------------------------------------------------------------------------

export type Sentiment = 'positive' | 'neutral' | 'negative' | 'unknown';

export interface SentimentDistribution {
  readonly counts: Readonly<Record<Sentiment, number>>;
  readonly total: number;
}

export async function getSentimentDistributionWithTx(
  tx: AnyPgTx,
  orgId: string,
  filters: ReputationFilters,
  range: { from: Date; to: Date },
): Promise<SentimentDistribution> {
  const conditions = applyScope(orgId, filters, withinWindow(range.from, range.to));
  const rows: Array<{ sentiment: Sentiment; n: string | number }> = await tx
    .select({ sentiment: reviews.sentiment, n: count(reviews.id) })
    .from(reviews)
    .where(and(...conditions))
    .groupBy(reviews.sentiment);
  const counts: Record<Sentiment, number> = {
    positive: 0,
    neutral: 0,
    negative: 0,
    unknown: 0,
  };
  let total = 0;
  for (const r of rows) {
    const n = toNum(r.n) ?? 0;
    if (counts[r.sentiment] !== undefined) {
      counts[r.sentiment] = n;
      total += n;
    }
  }
  return { counts, total };
}

// ---------------------------------------------------------------------------
// Rating trend (weekly buckets across the window)
// ---------------------------------------------------------------------------

export interface RatingTrendPoint {
  /** ISO date of the bucket start (Monday-anchored week, in UTC). */
  readonly week: string;
  /** Average rating in the bucket; null if the bucket had zero reviews. */
  readonly avg: number | null;
  readonly reviewCount: number;
}

export async function getRatingTrendWithTx(
  tx: AnyPgTx,
  orgId: string,
  filters: ReputationFilters,
): Promise<ReadonlyArray<RatingTrendPoint>> {
  const conditions = applyScope(
    orgId,
    filters,
    withinWindow(filters.dateFrom, filters.dateTo),
  );
  type Row = { week: Date; avg: string | null; rc: string | number };
  const rows: Row[] = await tx
    .select({
      week: sql<Date>`date_trunc('week', ${reviews.postedAt})`.as('week'),
      avg: sql<string | null>`AVG(${reviews.rating})`.as('avg'),
      rc: count(reviews.id),
    })
    .from(reviews)
    .where(and(...conditions))
    .groupBy(sql`date_trunc('week', ${reviews.postedAt})`)
    .orderBy(sql`date_trunc('week', ${reviews.postedAt}) asc`);

  return rows.map((r) => ({
    week: isoDate(r.week),
    avg: toNum(r.avg),
    reviewCount: toNum(r.rc) ?? 0,
  }));
}

// ---------------------------------------------------------------------------
// Top tags (Ajuste 4): count >= 3, top 10, sentiment dominant + percent.
// ---------------------------------------------------------------------------

export interface TagStat {
  readonly tag: string;
  readonly count: number;
  /** 0..100 — proportion of in-window reviews that carry this tag. */
  readonly percentOfReviews: number;
  readonly dominantSentiment: Sentiment;
  readonly sentimentBreakdown: Readonly<Record<Sentiment, number>>;
}

const TOP_TAGS_MIN_COUNT = 3;
const TOP_TAGS_LIMIT = 10;

export async function getTopTagsWithTx(
  tx: AnyPgTx,
  orgId: string,
  filters: ReputationFilters,
  range: { from: Date; to: Date },
  totalReviewCount: number,
): Promise<ReadonlyArray<TagStat>> {
  // Phase-5 approach: read `(sentiment, tags)` columns for the
  // in-scope reviews and aggregate in JS. For Phase-5 volumes
  // (~200 reviews / org) the JS pass is faster than the SQL one
  // (jsonb_array_elements_text + GROUP BY costs more than the
  // round-trip of the raw rows). Phase 11 swaps to a SQL path when
  // we have 100K+ reviews and the in-memory walk stops being free —
  // tracked at TODO.md#reputation-tags-sql-path.
  type RawTagRow = { sentiment: Sentiment; tags: unknown };
  const rawRows: RawTagRow[] = await tx
    .select({ sentiment: reviews.sentiment, tags: reviews.tags })
    .from(reviews)
    .where(and(...applyScope(orgId, filters, withinWindow(range.from, range.to))));

  const buckets = new Map<
    string,
    { count: number; sentiment: Record<Sentiment, number> }
  >();
  for (const r of rawRows) {
    const tags = Array.isArray(r.tags) ? (r.tags as string[]) : [];
    for (const tag of tags) {
      const bucket =
        buckets.get(tag) ??
        ({
          count: 0,
          sentiment: { positive: 0, neutral: 0, negative: 0, unknown: 0 },
        } as { count: number; sentiment: Record<Sentiment, number> });
      bucket.count += 1;
      bucket.sentiment[r.sentiment] = (bucket.sentiment[r.sentiment] ?? 0) + 1;
      buckets.set(tag, bucket);
    }
  }

  const filtered = [...buckets.entries()]
    .filter(([, v]) => v.count >= TOP_TAGS_MIN_COUNT)
    .map(([tag, v]) => {
      const dominant = pickDominantSentiment(v.sentiment);
      return {
        tag,
        count: v.count,
        percentOfReviews:
          totalReviewCount === 0
            ? 0
            : Math.round((v.count / totalReviewCount) * 100),
        dominantSentiment: dominant,
        sentimentBreakdown: v.sentiment,
      } satisfies TagStat;
    });

  filtered.sort((a, b) => b.count - a.count);
  return filtered.slice(0, TOP_TAGS_LIMIT);
}

function pickDominantSentiment(b: Record<Sentiment, number>): Sentiment {
  let best: Sentiment = 'unknown';
  let bestN = -1;
  for (const s of ['positive', 'neutral', 'negative', 'unknown'] as Sentiment[]) {
    if ((b[s] ?? 0) > bestN) {
      best = s;
      bestN = b[s] ?? 0;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Response time stats
// ---------------------------------------------------------------------------

export interface ResponseTimeStats {
  /** Hours from review.posted_at → first published response. */
  readonly avgHours: number | null;
  readonly p50Hours: number | null;
  readonly p90Hours: number | null;
  /** How many reviews had at least one published response inside the window. */
  readonly responseSampleSize: number;
}

export async function getResponseTimeStatsWithTx(
  tx: AnyPgTx,
  orgId: string,
  filters: ReputationFilters,
  range: { from: Date; to: Date },
): Promise<ResponseTimeStats> {
  const conditions = applyScope(orgId, filters, withinWindow(range.from, range.to));
  type Row = {
    avgHours: string | null;
    p50: string | null;
    p90: string | null;
    n: string | number;
  };
  const rows: Row[] = await tx
    .select({
      avgHours: sql<string | null>`
        AVG(EXTRACT(EPOCH FROM (rr.published_at - ${reviews.postedAt})) / 3600.0)
      `.as('avg_hours'),
      p50: sql<string | null>`
        PERCENTILE_CONT(0.5) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM (rr.published_at - ${reviews.postedAt})) / 3600.0
        )
      `.as('p50'),
      p90: sql<string | null>`
        PERCENTILE_CONT(0.9) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM (rr.published_at - ${reviews.postedAt})) / 3600.0
        )
      `.as('p90'),
      n: sql<string | number>`COUNT(*)`.as('n'),
    })
    .from(reviews)
    .innerJoin(
      sql`(
        SELECT review_id, MIN(published_at) AS published_at
        FROM ${reviewResponses}
        WHERE status = 'published' AND published_at IS NOT NULL
        GROUP BY review_id
      ) AS rr`,
      sql`rr.review_id = ${reviews.id}`,
    )
    .where(and(...conditions));

  const row = rows[0];
  if (!row || toNum(row.n) === 0) {
    return { avgHours: null, p50Hours: null, p90Hours: null, responseSampleSize: 0 };
  }
  return {
    avgHours: toNum(row.avgHours),
    p50Hours: toNum(row.p50),
    p90Hours: toNum(row.p90),
    responseSampleSize: toNum(row.n) ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Crisis indicator
// ---------------------------------------------------------------------------

export interface CrisisIndicator extends CrisisResult {
  /** Locations responsible for the spike (top 3 by negative count). */
  readonly locationsAffected: ReadonlyArray<{
    locationId: string | null;
    negativeCount: number;
  }>;
  /** Up to 3 review ids the UI can deep-link to from the banner. */
  readonly sampleReviewIds: ReadonlyArray<string>;
}

export async function getCrisisCountsWithTx(
  tx: AnyPgTx,
  orgId: string,
  filters: ReputationFilters,
  now: Date,
): Promise<{
  recentCount: number;
  previousCount: number;
  locationsAffected: ReadonlyArray<{ locationId: string | null; negativeCount: number }>;
  sampleReviewIds: ReadonlyArray<string>;
}> {
  const recentFrom = new Date(now.getTime() - CRISIS_WINDOW_HOURS * 60 * 60 * 1000);
  const previousFrom = new Date(
    now.getTime() - 2 * CRISIS_WINDOW_HOURS * 60 * 60 * 1000,
  );

  const conditions = applyScope(orgId, filters);
  const negativeFilter = sql`${reviews.rating} <= 2`;

  type CountRow = { recent: string | number; previous: string | number };
  const countRows: CountRow[] = await tx
    .select({
      recent: sql<string | number>`COUNT(*) FILTER (
        WHERE ${reviews.postedAt} >= ${recentFrom} AND ${reviews.postedAt} <= ${now}
      )`.as('recent'),
      previous: sql<string | number>`COUNT(*) FILTER (
        WHERE ${reviews.postedAt} >= ${previousFrom} AND ${reviews.postedAt} < ${recentFrom}
      )`.as('previous'),
    })
    .from(reviews)
    .where(and(...conditions, negativeFilter));

  const recentCount = toNum(countRows[0]?.recent) ?? 0;
  const previousCount = toNum(countRows[0]?.previous) ?? 0;

  // Top-3 locations + 3 sample review ids — only resolved when we
  // actually have a spike, to keep the common no-crisis path cheap.
  let locationsAffected: ReadonlyArray<{
    locationId: string | null;
    negativeCount: number;
  }> = [];
  let sampleReviewIds: ReadonlyArray<string> = [];
  if (recentCount > 0) {
    type LocRow = { locationId: string | null; n: string | number };
    const locRows: LocRow[] = await tx
      .select({
        locationId: reviews.locationId,
        n: sql<string | number>`COUNT(*)`.as('n'),
      })
      .from(reviews)
      .where(
        and(
          ...conditions,
          negativeFilter,
          gte(reviews.postedAt, recentFrom),
          lt(reviews.postedAt, new Date(now.getTime() + 1000)),
        ),
      )
      .groupBy(reviews.locationId)
      .orderBy(sql`COUNT(*) desc`)
      .limit(3);
    locationsAffected = locRows.map((r) => ({
      locationId: r.locationId,
      negativeCount: toNum(r.n) ?? 0,
    }));

    const sampleRows: Array<{ id: string }> = await tx
      .select({ id: reviews.id })
      .from(reviews)
      .where(
        and(
          ...conditions,
          negativeFilter,
          gte(reviews.postedAt, recentFrom),
          lt(reviews.postedAt, new Date(now.getTime() + 1000)),
        ),
      )
      .orderBy(sql`${reviews.postedAt} desc`)
      .limit(3);
    sampleReviewIds = sampleRows.map((r) => r.id);
  }

  return { recentCount, previousCount, locationsAffected, sampleReviewIds };
}

// ---------------------------------------------------------------------------
// Single-pass loader (Ajuste extra)
// ---------------------------------------------------------------------------

export interface ReputationDashboardData {
  readonly filters: ReputationFilters;
  readonly current: OverviewMetrics;
  readonly previous: OverviewMetrics;
  readonly deltas: {
    readonly ratingAvg: DeltaResult;
    readonly reviewCount: DeltaResult;
    readonly responseRate: DeltaResult;
  };
  readonly stars: StarDistribution;
  readonly sentiment: SentimentDistribution;
  readonly trend: ReadonlyArray<RatingTrendPoint>;
  readonly topTags: ReadonlyArray<TagStat>;
  readonly responseTime: ResponseTimeStats;
  readonly crisis: CrisisIndicator;
}

/**
 * Dependency bag for the loader. Production code uses the default
 * (each binding maps to the real `*WithTx` query). Tests pass spied
 * versions and assert each was called exactly once. Mirrors the DI
 * pattern in `lib/inbox/send-reply.ts` (Commit 9).
 */
export interface DashboardQueryDeps {
  overview: typeof getOverviewMetricsWithTx;
  stars: typeof getStarDistributionWithTx;
  sentiment: typeof getSentimentDistributionWithTx;
  trend: typeof getRatingTrendWithTx;
  topTags: typeof getTopTagsWithTx;
  responseTime: typeof getResponseTimeStatsWithTx;
  crisisCounts: typeof getCrisisCountsWithTx;
}

export const defaultDashboardQueryDeps: DashboardQueryDeps = {
  overview: getOverviewMetricsWithTx,
  stars: getStarDistributionWithTx,
  sentiment: getSentimentDistributionWithTx,
  trend: getRatingTrendWithTx,
  topTags: getTopTagsWithTx,
  responseTime: getResponseTimeStatsWithTx,
  crisisCounts: getCrisisCountsWithTx,
};

export interface LoadOpts {
  readonly orgId: string;
  readonly userId: string;
  readonly filters: ReputationFilters;
  /** Now-clock injection so tests can pin the wall clock. */
  readonly now?: Date;
  /** DI override used by tests to spy on per-query invocations. */
  readonly deps?: DashboardQueryDeps;
}

/**
 * Single funnel for the /reputation dashboard. Runs every per-card
 * query in parallel under ONE `dbAs` transaction so RLS is set up
 * once and the DB sees one round-trip's worth of contention.
 *
 * Tests verify each query is called exactly once by spying on the
 * `deps` bag — that's the load-time guarantee Ajuste Extra demands.
 *
 * `loadReputationDashboardData` is the ONLY function the /reputation
 * page should call. Don't call individual `*WithTx` helpers from the
 * page; if you need a new metric, add it to the loader.
 */
export async function loadReputationDashboardData(
  opts: LoadOpts,
): Promise<ReputationDashboardData> {
  const now = opts.now ?? new Date();
  const { prevFrom, prevTo } = previousWindow(opts.filters);
  const currentRange = { from: opts.filters.dateFrom, to: opts.filters.dateTo };
  const previousRange = { from: prevFrom, to: prevTo };
  const deps = opts.deps ?? defaultDashboardQueryDeps;

  return dbAs(
    { orgId: opts.orgId, userId: opts.userId },
    async (tx): Promise<ReputationDashboardData> => {
      // current and previous overviews share the same query function
      // but with different ranges. They count as two calls of
      // `deps.overview`; the spy assertion in the test asserts
      // `toHaveBeenCalledTimes(2)` for `overview` and 1 for the rest.
      const [
        current,
        previous,
        stars,
        sentiment,
        trend,
        responseTime,
        crisisCounts,
      ] = await Promise.all([
        deps.overview(tx, opts.orgId, opts.filters, currentRange),
        deps.overview(tx, opts.orgId, opts.filters, previousRange),
        deps.stars(tx, opts.orgId, opts.filters, currentRange),
        deps.sentiment(tx, opts.orgId, opts.filters, currentRange),
        deps.trend(tx, opts.orgId, opts.filters),
        deps.responseTime(tx, opts.orgId, opts.filters, currentRange),
        deps.crisisCounts(tx, opts.orgId, opts.filters, now),
      ]);

      // Top tags depends on `current.reviewCount` for the percent
      // calculation. Run after current resolves; the single extra
      // await is cheap relative to the parallel batch.
      const topTags = await deps.topTags(
        tx,
        opts.orgId,
        opts.filters,
        currentRange,
        current.reviewCount,
      );

      const crisis: CrisisIndicator = {
        ...evaluateCrisis({
          recentCount: crisisCounts.recentCount,
          previousCount: crisisCounts.previousCount,
        }),
        locationsAffected: crisisCounts.locationsAffected,
        sampleReviewIds: crisisCounts.sampleReviewIds,
      };

      return {
        filters: opts.filters,
        current,
        previous,
        deltas: {
          ratingAvg: computeDelta({
            current: current.ratingAvg ?? 0,
            previous: previous.ratingAvg ?? 0,
            previousSampleSize: previous.reviewCount,
          }),
          reviewCount: computeDelta({
            current: current.reviewCount,
            previous: previous.reviewCount,
            previousSampleSize: previous.reviewCount,
          }),
          responseRate: computeDelta({
            current: current.responseRate ?? 0,
            previous: previous.responseRate ?? 0,
            previousSampleSize: previous.reviewCount,
          }),
        },
        stars,
        sentiment,
        trend,
        topTags,
        responseTime,
        crisis,
      };
    },
  );
}

/**
 * Test variant of the loader that accepts an existing transaction
 * (`AnyPgTx`) instead of opening a new `dbAs` one. Used by integration
 * tests that already drive the test pglite under `runAs`. Behavior
 * is otherwise identical to `loadReputationDashboardData`.
 */
export async function loadReputationDashboardDataWithTx(
  tx: AnyPgTx,
  opts: Omit<LoadOpts, 'userId'>,
): Promise<ReputationDashboardData> {
  const now = opts.now ?? new Date();
  const { prevFrom, prevTo } = previousWindow(opts.filters);
  const currentRange = { from: opts.filters.dateFrom, to: opts.filters.dateTo };
  const previousRange = { from: prevFrom, to: prevTo };
  const deps = opts.deps ?? defaultDashboardQueryDeps;

  const [current, previous, stars, sentiment, trend, responseTime, crisisCounts] =
    await Promise.all([
      deps.overview(tx, opts.orgId, opts.filters, currentRange),
      deps.overview(tx, opts.orgId, opts.filters, previousRange),
      deps.stars(tx, opts.orgId, opts.filters, currentRange),
      deps.sentiment(tx, opts.orgId, opts.filters, currentRange),
      deps.trend(tx, opts.orgId, opts.filters),
      deps.responseTime(tx, opts.orgId, opts.filters, currentRange),
      deps.crisisCounts(tx, opts.orgId, opts.filters, now),
    ]);

  const topTags = await deps.topTags(
    tx,
    opts.orgId,
    opts.filters,
    currentRange,
    current.reviewCount,
  );

  const crisis: CrisisIndicator = {
    ...evaluateCrisis({
      recentCount: crisisCounts.recentCount,
      previousCount: crisisCounts.previousCount,
    }),
    locationsAffected: crisisCounts.locationsAffected,
    sampleReviewIds: crisisCounts.sampleReviewIds,
  };

  return {
    filters: opts.filters,
    current,
    previous,
    deltas: {
      ratingAvg: computeDelta({
        current: current.ratingAvg ?? 0,
        previous: previous.ratingAvg ?? 0,
        previousSampleSize: previous.reviewCount,
      }),
      reviewCount: computeDelta({
        current: current.reviewCount,
        previous: previous.reviewCount,
        previousSampleSize: previous.reviewCount,
      }),
      responseRate: computeDelta({
        current: current.responseRate ?? 0,
        previous: previous.responseRate ?? 0,
        previousSampleSize: previous.reviewCount,
      }),
    },
    stars,
    sentiment,
    trend,
    topTags,
    responseTime,
    crisis,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Drizzle aggregations land as `string` in Postgres-js, `number` in pglite. */
function toNum(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isoDate(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Touch unused types so a future PR that drops them surfaces here too.
void (null as unknown as PlatformCode);
