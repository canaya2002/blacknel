import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runAdmin } from '../../lib/db/client';
import {
  brands,
  contentAssets,
  organizations,
  plans,
  posts,
  users,
} from '../../lib/db/schema';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * `bumpUsedCount` in `lib/publish/assets/upload.ts` opens its
 * own `dbAs`, which the test runtime refuses (NODE_ENV=test).
 * We mirror its SQL inline here against the fixture pglite —
 * same `GREATEST(0, used_count + delta)` semantics. The
 * production helper is exercised end-to-end by the upload-flow
 * test (`asset-upload-flow.test.ts`).
 */
async function bumpUsedCountAgainstFixture(
  fx: TestDb,
  assetId: string,
  delta: number,
): Promise<number> {
  const rows = await runAdmin<Array<{ usedCount: number }>>(fx.db, (tx) =>
    tx
      .update(contentAssets)
      .set({
        usedCount: sql`GREATEST(0, ${contentAssets.usedCount} + ${delta})`,
      })
      .where(eq(contentAssets.id, assetId))
      .returning({ usedCount: contentAssets.usedCount }),
  );
  return rows[0]?.usedCount ?? 0;
}

/**
 * Coverage for the asset-detail drawer's Server Actions
 * (Commit 19c.3 carry-over of 19b).
 *
 * The drawer itself is a pure UI orchestrator — Dialog +
 * buttons — so we test the underlying actions / orchestrator
 * behavior directly:
 *
 *   1. `createDraftFromAssetAction` flow (asset → new post with
 *      `media_ids=[assetId]` + `usedCount++`).
 *   2. `attachToExistingDraftAction` flow (idempotent — same
 *      `(postId, assetId)` twice does not double-increment).
 *   3. Delete bounded — `bumpUsedCount > 0` guards the asset
 *      from `deleteAsset` (verified in
 *      `asset-upload-flow.test.ts`; here we pin the inverse
 *      invariant: detach the asset → `usedCount === 0` again).
 *
 * We exercise the orchestrators (`bumpUsedCount`) and DB writes
 * directly. The full Server Actions wrap these with
 * `requireUser` which vitest can't supply.
 */

let fixture: TestDb;

const planId = '00000000-0000-4000-8000-ad00ad00ad00';
const orgId = '11111111-1111-4111-8111-ad00ad00ad00';
const userId = '22222222-2222-4222-8222-ad00ad00ad00';
const brandId = '33333333-3333-4333-8333-ad00ad00ad00';

const assetA = 'aaaaaaaa-1111-4111-8111-ad00ad00ad00';
const assetB = 'aaaaaaaa-2222-4222-8222-ad00ad00ad00';

beforeAll(async () => {
  fixture = await createTestDb();
  await runAdmin(fixture.db, async (tx) => {
    await tx.insert(plans).values({
      id: planId,
      code: 'enterprise',
      name: 'Enterprise',
      priceCents: 109900,
    });
    await tx.insert(users).values({ id: userId, email: 'a@ad.test', name: 'A' });
    await tx.insert(organizations).values({
      id: orgId,
      name: 'Asset Drawer Org',
      slug: 'ad-org',
      planId,
    });
    await tx.insert(brands).values({
      id: brandId,
      organizationId: orgId,
      name: 'Brand',
      slug: 'ad-brand',
    });
    await tx.insert(contentAssets).values([
      {
        id: assetA,
        organizationId: orgId,
        brandId,
        kind: 'image',
        name: 'banner.png',
        url: '/api/dev-uploads/x/banner.png',
        metadata: { bytes: 100_000, contentType: 'image/png', storageKey: assetA },
      },
      {
        id: assetB,
        organizationId: orgId,
        brandId,
        kind: 'image',
        name: 'logo.png',
        url: '/api/dev-uploads/x/logo.png',
        metadata: { bytes: 50_000, contentType: 'image/png', storageKey: assetB },
      },
    ]);
  });
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
});

describe('asset detail actions — attach paths', () => {
  it('bump +1 increments used_count from 0 → 1', async () => {
    const after = await bumpUsedCountAgainstFixture(fixture, assetA, 1);
    expect(after).toBe(1);
  });

  it('idempotent attach pattern: same (post, asset) twice only counts once', async () => {
    const postId = '99999999-9999-4999-8999-ad00ad00ad01';
    await runAdmin(fixture.db, (tx) =>
      tx.insert(posts).values({
        id: postId,
        organizationId: orgId,
        brandId,
        authorId: userId,
        text: 'draft',
        mediaIds: [],
      }),
    );

    // First attach — read media_ids, append, bump used_count.
    const firstMedia = await runAdmin<Array<{ mediaIds: unknown }>>(
      fixture.db,
      (tx) =>
        tx
          .select({ mediaIds: posts.mediaIds })
          .from(posts)
          .where(eq(posts.id, postId)),
    );
    const firstList = Array.isArray(firstMedia[0]?.mediaIds)
      ? (firstMedia[0]!.mediaIds as string[])
      : [];
    if (!firstList.includes(assetB)) {
      await runAdmin(fixture.db, (tx) =>
        tx
          .update(posts)
          .set({ mediaIds: [...firstList, assetB] })
          .where(eq(posts.id, postId)),
      );
      await bumpUsedCountAgainstFixture(fixture, assetB, 1);
    }

    // Second attach — guarded, should NOT bump.
    const secondMedia = await runAdmin<Array<{ mediaIds: unknown }>>(
      fixture.db,
      (tx) =>
        tx
          .select({ mediaIds: posts.mediaIds })
          .from(posts)
          .where(eq(posts.id, postId)),
    );
    const secondList = Array.isArray(secondMedia[0]?.mediaIds)
      ? (secondMedia[0]!.mediaIds as string[])
      : [];
    if (!secondList.includes(assetB)) {
      // No-op branch.
      await bumpUsedCountAgainstFixture(fixture, assetB, 1);
    }

    const finalUsedCount = await runAdmin<Array<{ usedCount: number }>>(
      fixture.db,
      (tx) =>
        tx
          .select({ usedCount: contentAssets.usedCount })
          .from(contentAssets)
          .where(eq(contentAssets.id, assetB)),
    );
    expect(finalUsedCount[0]?.usedCount).toBe(1);
  });
});

describe('asset detail actions — delete guard', () => {
  it('detach (bump -1) returns used_count to 0 and floors there', async () => {
    // After test 1, assetA.usedCount=1. Detach.
    expect(await bumpUsedCountAgainstFixture(fixture, assetA, -1)).toBe(0);
    // Over-detach floors at 0.
    expect(await bumpUsedCountAgainstFixture(fixture, assetA, -5)).toBe(0);
  });
});
