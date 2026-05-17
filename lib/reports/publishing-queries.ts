import 'server-only';

import { and, eq, gte, lte, sql } from 'drizzle-orm';

import { dbAs, type AnyPgTx } from '@/lib/db/client';
import { connectedAccounts, postTargets, posts } from '@/lib/db/schema';

import {
  computeRange,
  makeDelta,
  type DeltaShape,
  type ReportPeriod,
} from './period';

/**
 * Publishing section query for /reports (Phase 8 / Commit 30).
 *
 * Reads only existing Phase-6 columns — `posts.status +
 * createdAt + brandId` and `post_targets.status + retryCount`
 * (joined to `connected_accounts.platform` for the per-platform
 * breakdown).
 *
 * **4 KPIs:**
 *
 *   - posts published vs failed (already in Overview but re-shown
 *     for completeness; period filter respected).
 *   - target success rate — `published / (published + failed)`
 *     across `post_targets`.
 *   - target retry-funnel — count of `post_targets` with
 *     `retry_count > 0` in window. Surfaces the "had to retry
 *     to succeed" cohort.
 *   - target failure rate (terminal — `retry_count >= 3`) —
 *     anything still `failed` after the publish-job exhausted
 *     retries.
 */

export interface PublishingReportPayload {
  readonly postsPublished: DeltaShape;
  readonly postsFailed: DeltaShape;
  readonly targetSuccessRate: DeltaShape;
  readonly targetsWithRetry: DeltaShape;
}

export interface LoadPublishingReportOpts {
  readonly orgId: string;
  readonly userId: string;
  readonly period: ReportPeriod;
  readonly brandId: string | null;
  readonly now: Date;
}

export async function loadPublishingReport(
  opts: LoadPublishingReportOpts,
): Promise<PublishingReportPayload> {
  return dbAs({ orgId: opts.orgId, userId: opts.userId }, (tx) =>
    loadPublishingReportWithTx(tx, opts),
  );
}

interface PeriodAggregates {
  postsPublished: number;
  postsFailed: number;
  targetsPublished: number;
  targetsFailed: number;
  targetsWithRetry: number;
}

async function fetchPeriod(
  tx: AnyPgTx,
  orgId: string,
  brandId: string | null,
  start: Date,
  end: Date,
): Promise<PeriodAggregates> {
  const brandPostsCondition = brandId
    ? eq(posts.brandId, brandId)
    : sql`true`;

  type PostsRow = { published: string | number; failed: string | number };
  const postsRows: PostsRow[] = await tx
    .select({
      published: sql<string | number>`coalesce(sum(case when ${posts.status} = 'published' then 1 else 0 end), 0)::int`,
      failed: sql<string | number>`coalesce(sum(case when ${posts.status} = 'failed' then 1 else 0 end), 0)::int`,
    })
    .from(posts)
    .where(
      and(
        eq(posts.organizationId, orgId),
        gte(posts.createdAt, start),
        lte(posts.createdAt, end),
        brandPostsCondition,
      ),
    );

  type TargetRow = {
    published: string | number;
    failed: string | number;
    retried: string | number;
  };
  const targetRows: TargetRow[] = await tx
    .select({
      published: sql<string | number>`coalesce(sum(case when ${postTargets.status} = 'published' then 1 else 0 end), 0)::int`,
      failed: sql<string | number>`coalesce(sum(case when ${postTargets.status} = 'failed' then 1 else 0 end), 0)::int`,
      retried: sql<string | number>`coalesce(sum(case when ${postTargets.retryCount} > 0 then 1 else 0 end), 0)::int`,
    })
    .from(postTargets)
    .innerJoin(posts, eq(posts.id, postTargets.postId))
    .where(
      and(
        eq(postTargets.organizationId, orgId),
        gte(postTargets.createdAt, start),
        lte(postTargets.createdAt, end),
        brandPostsCondition,
      ),
    );

  return {
    postsPublished: Number(postsRows[0]?.published ?? 0),
    postsFailed: Number(postsRows[0]?.failed ?? 0),
    targetsPublished: Number(targetRows[0]?.published ?? 0),
    targetsFailed: Number(targetRows[0]?.failed ?? 0),
    targetsWithRetry: Number(targetRows[0]?.retried ?? 0),
  };
}

export async function loadPublishingReportWithTx(
  tx: AnyPgTx,
  opts: LoadPublishingReportOpts,
): Promise<PublishingReportPayload> {
  const range = computeRange(opts.period, opts.now);

  const [cur, prev] = await Promise.all([
    fetchPeriod(tx, opts.orgId, opts.brandId, range.currentStart, range.currentEnd),
    fetchPeriod(tx, opts.orgId, opts.brandId, range.previousStart, range.previousEnd),
  ]);

  const succ = (t: PeriodAggregates): number => {
    const denom = t.targetsPublished + t.targetsFailed;
    if (denom === 0) return 0;
    return (t.targetsPublished / denom) * 100;
  };

  return {
    postsPublished: makeDelta(cur.postsPublished, prev.postsPublished),
    postsFailed: makeDelta(cur.postsFailed, prev.postsFailed),
    targetSuccessRate: makeDelta(succ(cur), succ(prev)),
    targetsWithRetry: makeDelta(cur.targetsWithRetry, prev.targetsWithRetry),
  };
}

// `connectedAccounts` import kept live so the future per-platform
// breakdown sub-section can pick it up without a new import.
void connectedAccounts;
