import 'server-only';

import { and, eq, inArray } from 'drizzle-orm';

import { type AnyPgTx, dbAdmin, dbAsOrg } from '@/lib/db/client';
import { connectedAccounts, reviews } from '@/lib/db/schema';
import { log } from '@/lib/log';

import type { ConnectorAccount, PlatformCode } from './base/types';
import type { NormalizedReview } from './base/normalized';
import { fetchReviewsForAccount } from './reviews-dispatch';

/**
 * Reviews poll-sync (C49). GBP gives no webhooks for reviews, so a cron polls
 * connected review-capable accounts and upserts into the existing reviews table
 * UNDER each connection's org RLS (dbAsOrg). Idempotent on
 * (org, platform, external_review_id): re-sync updates an edited review's
 * body/rating, never duplicates. Org is resolved from the connection.
 *
 * Scoped to GBP for now; extensible by adding a platform here + its real fetch in
 * reviews-dispatch (everything else — sync loop, upsert, dedup — is generic).
 */

const REVIEW_SYNC_PLATFORMS = ['gbp'] as const;

export interface ReviewsSyncDeps {
  asAdmin: <T>(fn: (tx: AnyPgTx) => Promise<T>) => Promise<T>;
  orgTx: <T>(orgId: string, fn: (tx: AnyPgTx) => Promise<T>) => Promise<T>;
  fetchReviews: (account: ConnectorAccount) => Promise<NormalizedReview[]>;
}

function defaultDeps(): ReviewsSyncDeps {
  return {
    asAdmin: (fn) => dbAdmin(fn),
    orgTx: (orgId, fn) => dbAsOrg(orgId, fn),
    fetchReviews: fetchReviewsForAccount,
  };
}

export async function runReviewsSync(
  deps: ReviewsSyncDeps = defaultDeps(),
): Promise<{ accounts: number; inserted: number; updated: number; failed: number }> {
  const rows = await deps.asAdmin<
    Array<{
      id: string;
      organizationId: string;
      platform: string;
      externalAccountId: string | null;
      brandId: string | null;
      locationId: string | null;
      displayName: string | null;
      handle: string | null;
      status: ConnectorAccount['status'];
      metadata: unknown;
    }>
  >((tx) =>
    tx
      .select({
        id: connectedAccounts.id,
        organizationId: connectedAccounts.organizationId,
        platform: connectedAccounts.platform,
        externalAccountId: connectedAccounts.externalAccountId,
        brandId: connectedAccounts.brandId,
        locationId: connectedAccounts.locationId,
        displayName: connectedAccounts.displayName,
        handle: connectedAccounts.handle,
        status: connectedAccounts.status,
        metadata: connectedAccounts.metadata,
      })
      .from(connectedAccounts)
      .where(
        and(
          inArray(connectedAccounts.platform, [...REVIEW_SYNC_PLATFORMS]),
          eq(connectedAccounts.status, 'connected'),
        ),
      ),
  );

  let accounts = 0;
  let inserted = 0;
  let updated = 0;
  let failed = 0;
  for (const r of rows) {
    accounts += 1;
    const account: ConnectorAccount = {
      id: r.id,
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
    let fetched: NormalizedReview[];
    try {
      fetched = await deps.fetchReviews(account);
    } catch (err) {
      failed += 1;
      log.warn({ accountId: r.id, err: (err as Error).message }, 'reviews_sync.fetch_failed');
      continue;
    }
    await deps.orgTx(r.organizationId, async (tx) => {
      for (const review of fetched) {
        const outcome = await upsertReview(tx, account, review);
        if (outcome === 'inserted') inserted += 1;
        else if (outcome === 'updated') updated += 1;
      }
    });
  }
  log.info({ accounts, inserted, updated, failed }, 'reviews_sync');
  return { accounts, inserted, updated, failed };
}

async function upsertReview(
  tx: AnyPgTx,
  account: ConnectorAccount,
  r: NormalizedReview,
): Promise<'inserted' | 'updated' | 'skip'> {
  if (!r.externalId || r.rating < 1 || r.rating > 5) return 'skip';
  const existing = (await tx
    .select({ id: reviews.id, body: reviews.body, rating: reviews.rating })
    .from(reviews)
    .where(
      and(
        eq(reviews.organizationId, account.organizationId),
        eq(reviews.platform, account.platform),
        eq(reviews.externalReviewId, r.externalId),
      ),
    )
    .limit(1)) as Array<{ id: string; body: string; rating: number }>;
  if (existing[0]) {
    // Reflect an edited review (body/rating changed); leave status/sentiment/
    // assignment untouched.
    if (existing[0].body !== r.body || existing[0].rating !== r.rating) {
      await tx
        .update(reviews)
        .set({ body: r.body, rating: r.rating, updatedAt: new Date() })
        .where(eq(reviews.id, existing[0].id));
      return 'updated';
    }
    return 'skip';
  }
  await tx.insert(reviews).values({
    organizationId: account.organizationId,
    platform: account.platform,
    externalReviewId: r.externalId,
    connectedAccountId: account.id,
    ...(account.brandId ? { brandId: account.brandId } : {}),
    ...(account.locationId ? { locationId: account.locationId } : {}),
    authorName: r.author.displayName,
    ...(r.author.avatarUrl ? { authorAvatar: r.author.avatarUrl } : {}),
    rating: r.rating,
    body: r.body,
    ...(r.language ? { language: r.language } : {}),
    postedAt: r.postedAt,
  });
  return 'inserted';
}
