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

// ---------------------------------------------------------------------------
// Single-competitor detail (Phase 9 / Commit 35)
// ---------------------------------------------------------------------------

export interface CompetitorDetail {
  readonly id: string;
  readonly name: string;
  readonly brandId: string | null;
  readonly brandName: string | null;
  readonly platforms: ReadonlyArray<string>;
  readonly handles: Record<string, string>;
  readonly status: CompetitorStatus;
  readonly createdAt: Date;
}

export interface CompetitorPlatformBreakdown {
  readonly platform: string;
  readonly postsLast30d: number;
  readonly engagementLast30d: number;
  readonly avgShareOfVoice: number;
  readonly avgSentiment: number;
}

export interface CompetitorTrendPoint {
  readonly day: string;
  readonly postsCount: number;
  readonly shareOfVoice: number;
}

export interface CompetitorDetailPayload {
  readonly competitor: CompetitorDetail;
  readonly breakdown: ReadonlyArray<CompetitorPlatformBreakdown>;
  readonly trendLast30d: ReadonlyArray<CompetitorTrendPoint>;
}

export async function getCompetitorDetailWithTx(
  tx: AnyPgTx,
  orgId: string,
  competitorId: string,
): Promise<CompetitorDetailPayload | null> {
  type CompRow = {
    competitor: typeof competitors.$inferSelect;
    brandName: string | null;
  };
  const compRows: CompRow[] = await tx
    .select({
      competitor: competitors,
      brandName: brands.name,
    })
    .from(competitors)
    .leftJoin(brands, eq(brands.id, competitors.brandId))
    .where(
      and(
        eq(competitors.organizationId, orgId),
        eq(competitors.id, competitorId),
      ),
    )
    .limit(1);
  if (compRows.length === 0) return null;
  const row = compRows[0]!;

  const since = new Date(Date.now() - 30 * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const breakdownRows: Array<{
    platform: string;
    postsLast30d: number;
    engagementLast30d: number;
    avgShareOfVoice: number;
    avgSentiment: number;
  }> = await tx
    .select({
      platform: competitorMetricsDaily.platform,
      postsLast30d: sql<number>`COALESCE(SUM(${competitorMetricsDaily.postsCount}), 0)::int`,
      engagementLast30d: sql<number>`COALESCE(SUM(${competitorMetricsDaily.engagementTotal}), 0)::int`,
      avgShareOfVoice: sql<number>`COALESCE(AVG(${competitorMetricsDaily.shareOfVoice}), 0)::float`,
      avgSentiment: sql<number>`COALESCE(AVG(${competitorMetricsDaily.sentimentScore}), 0)::float`,
    })
    .from(competitorMetricsDaily)
    .where(
      and(
        eq(competitorMetricsDaily.competitorId, competitorId),
        gte(competitorMetricsDaily.day, since),
      ),
    )
    .groupBy(competitorMetricsDaily.platform)
    .orderBy(competitorMetricsDaily.platform);

  const trendRows: Array<{
    day: string;
    postsCount: number;
    shareOfVoice: number;
  }> = await tx
    .select({
      day: sql<string>`${competitorMetricsDaily.day}::text`,
      postsCount: sql<number>`SUM(${competitorMetricsDaily.postsCount})::int`,
      shareOfVoice: sql<number>`AVG(${competitorMetricsDaily.shareOfVoice})::float`,
    })
    .from(competitorMetricsDaily)
    .where(
      and(
        eq(competitorMetricsDaily.competitorId, competitorId),
        gte(competitorMetricsDaily.day, since),
      ),
    )
    .groupBy(competitorMetricsDaily.day)
    .orderBy(competitorMetricsDaily.day);

  return {
    competitor: {
      id: row.competitor.id,
      name: row.competitor.name,
      brandId: row.competitor.brandId,
      brandName: row.brandName,
      platforms: row.competitor.platforms,
      handles: (row.competitor.handles as Record<string, string>) ?? {},
      status: row.competitor.status,
      createdAt: row.competitor.createdAt,
    },
    breakdown: breakdownRows.map((b) => ({
      platform: b.platform,
      postsLast30d: b.postsLast30d,
      engagementLast30d: b.engagementLast30d,
      avgShareOfVoice: Math.round(b.avgShareOfVoice * 1000) / 1000,
      avgSentiment: Math.round(b.avgSentiment * 100) / 100,
    })),
    trendLast30d: trendRows.map((t) => ({
      day: t.day,
      postsCount: t.postsCount,
      shareOfVoice: Math.round(t.shareOfVoice * 1000) / 1000,
    })),
  };
}

export async function getCompetitorDetail(ctx: {
  orgId: string;
  userId: string;
  competitorId: string;
}): Promise<CompetitorDetailPayload | null> {
  return dbAs({ orgId: ctx.orgId, userId: ctx.userId }, (tx) =>
    getCompetitorDetailWithTx(tx, ctx.orgId, ctx.competitorId),
  );
}
