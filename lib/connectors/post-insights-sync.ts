import 'server-only';

import { and, eq, gte, isNotNull, sql } from 'drizzle-orm';

import { type AnyPgTx, dbAdmin, dbAsOrg } from '@/lib/db/client';
import { connectedAccounts, postInsights, postTargets } from '@/lib/db/schema';
import { log } from '@/lib/log';

import type { NormalizedPostInsights } from './base/normalized';
import type { ConnectorAccount, PlatformCode } from './base/types';
import { fetchPostInsightsForTarget } from './post-insights-dispatch';

/**
 * Post-insights poll-sync (C52). Platforms don't push engagement, so a cron
 * polls recently-published post_targets and upserts their engagement into
 * post_insights UNDER each connection's org RLS (dbAsOrg). Real Meta when gated,
 * mock otherwise. Idempotent on (org, post_target_id): re-sync refreshes the
 * snapshot in place. A per-target fetch failure is logged + skipped — never
 * aborts the sweep. The decrypted token never leaves the dispatcher.
 */

const WINDOW_DAYS = 30; // refresh insights for posts published in the last 30d

export interface PostInsightsSyncDeps {
  asAdmin: <T>(fn: (tx: AnyPgTx) => Promise<T>) => Promise<T>;
  orgTx: <T>(orgId: string, fn: (tx: AnyPgTx) => Promise<T>) => Promise<T>;
  fetchInsights: (
    account: ConnectorAccount,
    externalPostId: string,
  ) => Promise<NormalizedPostInsights | null>;
  now: () => Date;
}

function defaultDeps(): PostInsightsSyncDeps {
  return {
    asAdmin: (fn) => dbAdmin(fn),
    orgTx: (orgId, fn) => dbAsOrg(orgId, fn),
    fetchInsights: fetchPostInsightsForTarget,
    now: () => new Date(),
  };
}

export interface PostInsightsSyncReport {
  targets: number;
  synced: number;
  skipped: number;
  failed: number;
}

export async function runPostInsightsSync(
  deps: PostInsightsSyncDeps = defaultDeps(),
): Promise<PostInsightsSyncReport> {
  const windowStart = new Date(deps.now().getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const rows = await deps.asAdmin<
    Array<{
      targetId: string;
      organizationId: string;
      connectedAccountId: string | null;
      externalPostId: string | null;
      publishedAt: Date | null;
      platform: string;
      brandId: string | null;
      locationId: string | null;
      externalAccountId: string | null;
      displayName: string | null;
      handle: string | null;
      status: ConnectorAccount['status'];
      metadata: unknown;
    }>
  >((tx) =>
    tx
      .select({
        targetId: postTargets.id,
        organizationId: postTargets.organizationId,
        connectedAccountId: postTargets.connectedAccountId,
        externalPostId: postTargets.externalPostId,
        publishedAt: postTargets.publishedAt,
        platform: connectedAccounts.platform,
        brandId: connectedAccounts.brandId,
        locationId: connectedAccounts.locationId,
        externalAccountId: connectedAccounts.externalAccountId,
        displayName: connectedAccounts.displayName,
        handle: connectedAccounts.handle,
        status: connectedAccounts.status,
        metadata: connectedAccounts.metadata,
      })
      .from(postTargets)
      .innerJoin(connectedAccounts, eq(connectedAccounts.id, postTargets.connectedAccountId))
      .where(
        and(
          eq(postTargets.status, 'published'),
          isNotNull(postTargets.externalPostId),
          isNotNull(postTargets.connectedAccountId),
          gte(postTargets.publishedAt, windowStart),
        ),
      )
      .limit(1000),
  );

  let targets = 0;
  let synced = 0;
  let skipped = 0;
  let failed = 0;

  for (const r of rows) {
    targets += 1;
    const account: ConnectorAccount = {
      id: r.connectedAccountId!,
      organizationId: r.organizationId,
      brandId: r.brandId,
      locationId: r.locationId,
      platform: r.platform as PlatformCode,
      externalAccountId: r.externalAccountId,
      displayName: r.displayName,
      handle: r.handle,
      status: r.status,
      metadata: (r.metadata as Record<string, unknown>) ?? {},
    };
    let insights: NormalizedPostInsights | null;
    try {
      insights = await deps.fetchInsights(account, r.externalPostId!);
    } catch (err) {
      failed += 1;
      log.warn({ targetId: r.targetId, err: (err as Error).message }, 'post_insights_sync.fetch_failed');
      continue;
    }
    if (!insights) {
      skipped += 1;
      continue;
    }
    await deps.orgTx(r.organizationId, (tx) =>
      tx
        .insert(postInsights)
        .values({
          organizationId: r.organizationId,
          postTargetId: r.targetId,
          platform: r.platform,
          externalPostId: r.externalPostId!,
          reach: insights!.reach,
          impressions: insights!.impressions,
          likes: insights!.likes,
          comments: insights!.comments,
          shares: insights!.shares,
          engagement: insights!.engagement,
          postedAt: r.publishedAt,
          fetchedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [postInsights.organizationId, postInsights.postTargetId],
          set: {
            reach: sql`excluded.reach`,
            impressions: sql`excluded.impressions`,
            likes: sql`excluded.likes`,
            comments: sql`excluded.comments`,
            shares: sql`excluded.shares`,
            engagement: sql`excluded.engagement`,
            postedAt: sql`excluded.posted_at`,
            fetchedAt: sql`excluded.fetched_at`,
            updatedAt: sql`now()`,
          },
        }),
    );
    synced += 1;
  }

  const report: PostInsightsSyncReport = { targets, synced, skipped, failed };
  log.info(report, 'post_insights_sync');
  return report;
}
