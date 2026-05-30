import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { type AnyPgTx, runAdmin, runAsOrg } from '../../lib/db/client';
import { connectedAccounts, organizations, plans, reviews } from '../../lib/db/schema';
import type { ConnectorAccount } from '../../lib/connectors/base';
import type { NormalizedReview } from '../../lib/connectors/base/normalized';
import { runReviewsSync, type ReviewsSyncDeps } from '../../lib/connectors/reviews-sync';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * C49 reviews poll-sync — fetch (injected) → upsert into the existing reviews
 * table under each connection's org RLS. Idempotent on
 * (org, platform, external_review_id): re-sync updates edited reviews, never
 * duplicates; per-org isolation. pglite + RLS, zero network.
 */

let fixture: TestDb;

const planId = '00000000-0000-4000-8000-d49000000001';
const orgA = '49044444-4444-4444-8490-a00000000001';
const orgB = '49044444-4444-4444-8490-b00000000002';
const accountA = '49066666-6666-4666-8490-a00000000001';
const accountB = '49066666-6666-4666-8490-b00000000002';

function gbpReview(externalId: string, rating: number, body: string): NormalizedReview {
  return {
    platform: 'gbp',
    externalId,
    author: { platform: 'gbp', externalId: 'ana', displayName: 'Ana P.' },
    rating,
    body,
    postedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

function makeDeps(fetch: (a: ConnectorAccount) => Promise<NormalizedReview[]>): ReviewsSyncDeps {
  return {
    asAdmin: <T>(fn: (tx: AnyPgTx) => Promise<T>) => runAdmin(fixture.db, fn),
    orgTx: <T>(orgId: string, fn: (tx: AnyPgTx) => Promise<T>) => runAsOrg(fixture.db, orgId, fn),
    fetchReviews: fetch,
  };
}

beforeAll(async () => {
  fixture = await createTestDb();
  await runAdmin(fixture.db, async (tx) => {
    await tx.insert(plans).values({ id: planId, code: 'growth', name: 'Growth', priceCents: 19900 });
    await tx.insert(organizations).values([
      { id: orgA, name: 'Rev A', slug: 'rev-a', planId },
      { id: orgB, name: 'Rev B', slug: 'rev-b', planId },
    ]);
    await tx.insert(connectedAccounts).values([
      { id: accountA, organizationId: orgA, platform: 'gbp', externalAccountId: 'accounts/a/locations/1', status: 'connected' },
      { id: accountB, organizationId: orgB, platform: 'gbp', externalAccountId: 'accounts/b/locations/1', status: 'connected' },
    ]);
  });
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
});

beforeEach(async () => {
  await runAdmin(fixture.db, (tx) => tx.delete(reviews));
});

describe('runReviewsSync', () => {
  it('inserts, dedups on re-sync, and updates an edited review', async () => {
    let body = 'Great service!';
    const fetch = async (a: ConnectorAccount): Promise<NormalizedReview[]> =>
      a.id === accountA ? [gbpReview('gbp-r-1', 5, body)] : [];

    const r1 = await runReviewsSync(makeDeps(fetch));
    expect(r1).toMatchObject({ inserted: 1, updated: 0 });

    const rows = await runAdmin<Array<{ org: string; acc: string | null; ext: string | null; rating: number }>>(
      fixture.db,
      (tx) =>
        tx
          .select({
            org: reviews.organizationId,
            acc: reviews.connectedAccountId,
            ext: reviews.externalReviewId,
            rating: reviews.rating,
          })
          .from(reviews),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ org: orgA, acc: accountA, ext: 'gbp-r-1', rating: 5 });

    // Re-sync: same payload → no duplicate, no update.
    const r2 = await runReviewsSync(makeDeps(fetch));
    expect(r2).toMatchObject({ inserted: 0, updated: 0 });

    // Edited review (body changed) → updated, still one row.
    body = 'Actually, amazing!';
    const r3 = await runReviewsSync(makeDeps(fetch));
    expect(r3).toMatchObject({ inserted: 0, updated: 1 });
    const after = await runAdmin<Array<{ body: string }>>(fixture.db, (tx) =>
      tx.select({ body: reviews.body }).from(reviews),
    );
    expect(after).toHaveLength(1);
    expect(after[0]?.body).toBe('Actually, amazing!');
  });

  it('isolates reviews per org (each connection writes under its own RLS)', async () => {
    const fetch = async (a: ConnectorAccount): Promise<NormalizedReview[]> => [
      gbpReview('shared-ext-1', 4, `review for ${a.organizationId.slice(0, 6)}`),
    ];
    const res = await runReviewsSync(makeDeps(fetch));
    expect(res.inserted).toBe(2); // one per gbp account (orgA + orgB)

    const byOrg = await runAdmin<Array<{ org: string }>>(fixture.db, (tx) =>
      tx.select({ org: reviews.organizationId }).from(reviews),
    );
    expect(byOrg.map((r) => r.org).sort()).toEqual([orgA, orgB].sort());
    const seenByA = await runAsOrg(fixture.db, orgA, (tx) =>
      tx.select({ id: reviews.id }).from(reviews).where(eq(reviews.organizationId, orgB)),
    );
    expect(seenByA).toHaveLength(0); // org A's RLS view never sees org B's review
  });
});
