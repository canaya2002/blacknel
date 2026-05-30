import 'server-only';

import { and, eq, sql } from 'drizzle-orm';

import {
  generateCompetitorMetricForDay,
  type CompetitorMockMetric,
} from '@/lib/connectors/competitors/mock';
import { type AnyPgTx, dbAdmin, dbAsOrg } from '@/lib/db/client';
import {
  competitorMetricsDaily,
  competitors,
  connectedAccounts,
  postTargets,
} from '@/lib/db/schema';
import { log } from '@/lib/log';

/**
 * Competitor metrics poll-sync (C53). competitor_metrics_daily was EMPTY at
 * runtime (only seeded) — this cron fills it. For each active competitor × its
 * platforms it upserts ONE row for the current UTC day under the org's RLS,
 * idempotent on (competitor, platform, day).
 *
 * HONEST LIMIT: there is no free platform API for a competitor's posts/
 * engagement — that needs an external provider (Brand24 / SimilarWeb). So the
 * metric is produced by the deterministic generator (the Phase-9 mock), with the
 * EXCEPTION of share-of-voice's own-brand denominator, which IS real: we count
 * the org's own published posts for the same platform/day. Swapping in a real
 * provider only replaces `deps.generate`.
 */

export interface CompetitorsSyncDeps {
  asAdmin: <T>(fn: (tx: AnyPgTx) => Promise<T>) => Promise<T>;
  orgTx: <T>(orgId: string, fn: (tx: AnyPgTx) => Promise<T>) => Promise<T>;
  generate: (input: {
    orgId: string;
    competitorId: string;
    day: string;
    platform: string;
    ownPostsCount: number;
  }) => CompetitorMockMetric;
  ownPostsCount: (tx: AnyPgTx, orgId: string, platform: string, day: string) => Promise<number>;
  now: () => Date;
}

async function defaultOwnPostsCount(
  tx: AnyPgTx,
  orgId: string,
  platform: string,
  day: string,
): Promise<number> {
  const rows = (await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(postTargets)
    .innerJoin(connectedAccounts, eq(connectedAccounts.id, postTargets.connectedAccountId))
    .where(
      and(
        eq(postTargets.organizationId, orgId),
        eq(postTargets.status, 'published'),
        eq(connectedAccounts.platform, platform),
        sql`${postTargets.publishedAt}::date = ${day}::date`,
      ),
    )) as Array<{ n: number | string | null }>;
  return Number(rows[0]?.n ?? 0);
}

function defaultDeps(): CompetitorsSyncDeps {
  return {
    asAdmin: (fn) => dbAdmin(fn),
    orgTx: (orgId, fn) => dbAsOrg(orgId, fn),
    generate: (input) => generateCompetitorMetricForDay(input),
    ownPostsCount: defaultOwnPostsCount,
    now: () => new Date(),
  };
}

export interface CompetitorsSyncReport {
  competitors: number;
  metrics: number;
  failed: number;
}

export async function runCompetitorsSync(
  deps: CompetitorsSyncDeps = defaultDeps(),
): Promise<CompetitorsSyncReport> {
  const day = deps.now().toISOString().slice(0, 10);

  const rows = await deps.asAdmin<
    Array<{ id: string; organizationId: string; platforms: string[] }>
  >((tx) =>
    tx
      .select({
        id: competitors.id,
        organizationId: competitors.organizationId,
        platforms: competitors.platforms,
      })
      .from(competitors)
      .where(eq(competitors.status, 'active')),
  );

  let metrics = 0;
  let failed = 0;
  for (const c of rows) {
    try {
      await deps.orgTx(c.organizationId, async (tx) => {
        for (const platform of c.platforms) {
          const ownPostsCount = await deps.ownPostsCount(tx, c.organizationId, platform, day);
          const m = deps.generate({
            orgId: c.organizationId,
            competitorId: c.id,
            day,
            platform,
            ownPostsCount,
          });
          await tx
            .insert(competitorMetricsDaily)
            .values({
              organizationId: c.organizationId,
              competitorId: c.id,
              platform,
              day,
              postsCount: m.postsCount,
              engagementTotal: m.engagementTotal,
              sentimentScore: m.sentimentScore.toFixed(2),
              shareOfVoice: m.shareOfVoice.toFixed(3),
            })
            .onConflictDoUpdate({
              target: [
                competitorMetricsDaily.competitorId,
                competitorMetricsDaily.platform,
                competitorMetricsDaily.day,
              ],
              set: {
                postsCount: sql`excluded.posts_count`,
                engagementTotal: sql`excluded.engagement_total`,
                sentimentScore: sql`excluded.sentiment_score`,
                shareOfVoice: sql`excluded.share_of_voice`,
                updatedAt: sql`now()`,
              },
            });
          metrics += 1;
        }
      });
    } catch (err) {
      failed += 1;
      log.warn({ competitorId: c.id, err: (err as Error).message }, 'competitors_sync.failed');
    }
  }

  const report: CompetitorsSyncReport = { competitors: rows.length, metrics, failed };
  log.info(report, 'competitors_sync');
  return report;
}
