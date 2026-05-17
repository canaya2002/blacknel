import 'server-only';

import { and, desc, eq, gte, sql } from 'drizzle-orm';

import { dbAs, type AnyPgTx } from '@/lib/db/client';
import {
  brands,
  competitorMetricsDaily,
  competitors,
  type Competitor,
  type CompetitorStatus,
} from '@/lib/db/schema';

/**
 * Competitor read layer (Phase 9 / Commit 34).
 */

export interface CompetitorRow {
  readonly id: string;
  readonly brandId: string | null;
  readonly brandName: string | null;
  readonly name: string;
  readonly platforms: ReadonlyArray<string>;
  readonly handles: Record<string, string>;
  readonly status: CompetitorStatus;
  readonly createdAt: Date;
  /** Aggregate over last 30 days from `competitor_metrics_daily`. */
  readonly postsLast30d: number;
  readonly avgSharOfVoiceLast30d: number;
}

export async function listCompetitorsWithTx(
  tx: AnyPgTx,
  orgId: string,
): Promise<CompetitorRow[]> {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const rows: Array<{
    competitor: Competitor;
    brandName: string | null;
    postsLast30d: number;
    avgSov: number;
  }> = await tx
    .select({
      competitor: competitors,
      brandName: brands.name,
      postsLast30d: sql<number>`COALESCE((
        SELECT SUM(posts_count)::int FROM ${competitorMetricsDaily}
        WHERE ${competitorMetricsDaily}.competitor_id = ${competitors}.id
          AND ${competitorMetricsDaily}.day >= ${since.toISOString().slice(0, 10)}
      ), 0)`,
      avgSov: sql<number>`COALESCE((
        SELECT AVG(share_of_voice)::float FROM ${competitorMetricsDaily}
        WHERE ${competitorMetricsDaily}.competitor_id = ${competitors}.id
          AND ${competitorMetricsDaily}.day >= ${since.toISOString().slice(0, 10)}
      ), 0)`,
    })
    .from(competitors)
    .leftJoin(brands, eq(brands.id, competitors.brandId))
    .where(eq(competitors.organizationId, orgId))
    .orderBy(desc(competitors.createdAt));

  return rows.map((r) => ({
    id: r.competitor.id,
    brandId: r.competitor.brandId,
    brandName: r.brandName,
    name: r.competitor.name,
    platforms: r.competitor.platforms,
    handles: (r.competitor.handles as Record<string, string>) ?? {},
    status: r.competitor.status,
    createdAt: r.competitor.createdAt,
    postsLast30d: r.postsLast30d,
    avgSharOfVoiceLast30d: Math.round((r.avgSov ?? 0) * 1000) / 1000,
  }));
}

export async function listCompetitors(ctx: {
  orgId: string;
  userId: string;
}): Promise<CompetitorRow[]> {
  return dbAs({ orgId: ctx.orgId, userId: ctx.userId }, (tx) =>
    listCompetitorsWithTx(tx, ctx.orgId),
  );
}

/** Aggregate the last N days of metrics across all active competitors. */
export interface CompetitorsAggregate {
  readonly totalPosts: number;
  readonly avgShareOfVoice: number;
  readonly competitorCount: number;
}

export async function getCompetitorsAggregateWithTx(
  tx: AnyPgTx,
  orgId: string,
  sinceDays = 30,
): Promise<CompetitorsAggregate> {
  const since = new Date(Date.now() - sinceDays * 86_400_000);
  const rows: Array<{
    totalPosts: number;
    avgSov: number;
    competitorCount: number;
  }> = await tx
    .select({
      totalPosts: sql<number>`COALESCE(SUM(${competitorMetricsDaily.postsCount}), 0)::int`,
      avgSov: sql<number>`COALESCE(AVG(${competitorMetricsDaily.shareOfVoice}), 0)::float`,
      competitorCount: sql<number>`COUNT(DISTINCT ${competitorMetricsDaily.competitorId})::int`,
    })
    .from(competitorMetricsDaily)
    .where(
      and(
        eq(competitorMetricsDaily.organizationId, orgId),
        gte(competitorMetricsDaily.day, since.toISOString().slice(0, 10)),
      ),
    );
  const r = rows[0] ?? { totalPosts: 0, avgSov: 0, competitorCount: 0 };
  return {
    totalPosts: r.totalPosts,
    avgShareOfVoice: Math.round((r.avgSov ?? 0) * 1000) / 1000,
    competitorCount: r.competitorCount,
  };
}

export async function getCompetitorsAggregate(ctx: {
  orgId: string;
  userId: string;
  sinceDays?: number;
}): Promise<CompetitorsAggregate> {
  return dbAs({ orgId: ctx.orgId, userId: ctx.userId }, (tx) =>
    getCompetitorsAggregateWithTx(tx, ctx.orgId, ctx.sinceDays ?? 30),
  );
}
