/**
 * LIVE reviews-list — runs against the real Postgres at `DATABASE_URL`.
 *
 * Phase 11 / C41. RLS scope smoke against Supabase. Reads `reviews`
 * through `dbAs` and asserts:
 *
 *   1. As the demo owner (org = SEED_IDS.org.demo) we see the seeded
 *      reviews (`seedReviews` ran during `pnpm db:seed`).
 *
 *   2. As a phantom org (a valid UUID that has no rows anywhere) we
 *      see zero reviews — RLS isolates them.
 *
 * Read-only — no rows inserted, no cleanup. The phantom org UUID is in
 * the `9e9e` sentinel range so it is still recognisable as a test
 * artifact even though no row carries it.
 *
 * MANUAL ONLY. Skipped by default; runs only when both of:
 *
 *   BLACKNEL_LIVE_TEST=true
 *   DATABASE_URL=postgres://...
 *
 * are set. CI does not set the flag, so this file silently skips there.
 *
 * Invocation: see `doc/runbooks/staging-environment.md`.
 */
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { closeProdDb, dbAs } from '../../lib/db/client';
import { reviews } from '../../lib/db/schema';
import { SEED_IDS } from '../../lib/db/seed';
import { isLiveEnabled } from '../helpers/live-test-gate';

const describeLive = isLiveEnabled() ? describe : describe.skip;

// Phantom org — valid UUID, no row exists with it. Used to assert that
// `dbAs` under this context sees zero reviews. Sentinel range `9e9e`
// keeps it grep-able for audits.
const phantomOrgId = '9e9e9e9e-0001-4000-8000-000000000099';
const phantomUserId = '9e9e9e9e-0002-4000-8000-000000000099';

describeLive('reviews-list LIVE (against DATABASE_URL)', () => {
  afterAll(async () => {
    await closeProdDb();
  });

  it('demo owner sees seeded reviews; phantom org sees zero (RLS scope)', async () => {
    const demoReviews = await dbAs<
      Array<{ id: string; organizationId: string }>
    >(
      { orgId: SEED_IDS.org.demo, userId: SEED_IDS.user.owner },
      async (tx) =>
        tx
          .select({
            id: reviews.id,
            organizationId: reviews.organizationId,
          })
          .from(reviews)
          .where(eq(reviews.organizationId, SEED_IDS.org.demo))
          .limit(10),
    );

    expect(demoReviews.length).toBeGreaterThan(0);
    for (const row of demoReviews) {
      expect(row.organizationId).toBe(SEED_IDS.org.demo);
    }

    // RLS scope: same query under a phantom context returns zero. The
    // WHERE clause uses the demo org id explicitly — RLS still filters
    // it out because `current_setting('app.current_org_id')` is the
    // phantom id and the policy compares the row's org against THAT,
    // not against the WHERE clause.
    const phantomReviews = await dbAs<Array<{ id: string }>>(
      { orgId: phantomOrgId, userId: phantomUserId },
      async (tx) =>
        tx
          .select({ id: reviews.id })
          .from(reviews)
          .where(eq(reviews.organizationId, SEED_IDS.org.demo))
          .limit(10),
    );

    expect(phantomReviews).toHaveLength(0);
  });
});
