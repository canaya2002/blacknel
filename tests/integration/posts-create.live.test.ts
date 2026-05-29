/**
 * LIVE posts INSERT — runs against the real Postgres at `DATABASE_URL`.
 *
 * Phase 11 / C41. Write smoke against Supabase. Asserts:
 *
 *   1. A draft `posts` row can be inserted under `dbAs` as the demo
 *      owner (RLS WITH CHECK allows it).
 *
 *   2. The row is then visible through `dbAs` from the same context.
 *
 *   3. Cleanup runs in `afterAll` and deletes ANY `9e9e9e9e-0007-*`
 *      row that may be lingering from a previous interrupted run.
 *
 * The sentinel UUID prefix `9e9e9e9e-0007-*` is reserved for this test
 * (rls.live.test.ts uses 0001..0003; we extend that pattern). The
 * runbook (`doc/runbooks/staging-environment.md`) carries a full
 * cleanup query covering all sentinel ranges.
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
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeProdDb, dbAdmin, dbAs } from '../../lib/db/client';
import { posts } from '../../lib/db/schema';
import { SEED_IDS } from '../../lib/db/seed';
import { isLiveEnabled } from '../helpers/live-test-gate';

const describeLive = isLiveEnabled() ? describe : describe.skip;

const SENTINEL_POST_ID = '9e9e9e9e-0007-4000-8000-000000000001';

async function cleanupSentinelPosts(): Promise<void> {
  await dbAdmin(async (tx) => {
    await tx.execute(
      sql`DELETE FROM posts WHERE id::text LIKE '9e9e9e9e-0007-%'`,
    );
  });
}

describeLive('posts-create LIVE (against DATABASE_URL)', () => {
  beforeAll(async () => {
    // Defensive: clean up anything left from an interrupted prior run.
    await cleanupSentinelPosts();
  });

  afterAll(async () => {
    await cleanupSentinelPosts();
    await closeProdDb();
  });

  it('inserts a draft post under dbAs and reads it back through the same context', async () => {
    const ctx = {
      orgId: SEED_IDS.org.demo,
      userId: SEED_IDS.user.owner,
    };

    const inserted = await dbAs<Array<{ id: string }>>(ctx, async (tx) => {
      return tx
        .insert(posts)
        .values({
          id: SENTINEL_POST_ID,
          organizationId: SEED_IDS.org.demo,
          brandId: SEED_IDS.brand.trattoria,
          authorId: SEED_IDS.user.owner,
          status: 'draft',
          text: 'C41 live smoke — draft post (will be deleted in afterAll)',
        })
        .returning({ id: posts.id });
    });

    expect(inserted).toHaveLength(1);
    expect(inserted[0]!.id).toBe(SENTINEL_POST_ID);

    const readBack = await dbAs<
      Array<{ id: string; organizationId: string; status: string }>
    >(ctx, async (tx) =>
      tx
        .select({
          id: posts.id,
          organizationId: posts.organizationId,
          status: posts.status,
        })
        .from(posts)
        .where(sql`${posts.id} = ${SENTINEL_POST_ID}::uuid`)
        .limit(1),
    );

    expect(readBack).toHaveLength(1);
    expect(readBack[0]!.organizationId).toBe(SEED_IDS.org.demo);
    expect(readBack[0]!.status).toBe('draft');
  });
});
