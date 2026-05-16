import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runAdmin, runAs } from '../../lib/db/client';
import {
  brands,
  campaigns,
  connectedAccounts,
  organizations,
  plans,
  postTargets,
  posts,
  users,
} from '../../lib/db/schema';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * Schema-level invariants for `posts` and `post_targets`
 * (Commit 17).
 *
 * What's locked in:
 *
 *   1. Tenant isolation — org A can't see / mutate org B rows.
 *   2. `post_targets_set_org_id` trigger auto-fills the column
 *      from the parent post.
 *   3. Cross-tenant insert via the trigger fails: an org-A
 *      session inserting a `post_targets` row pointing at an
 *      org-B post resolves to NULL `organization_id` (RLS hides
 *      the post) and the NOT NULL constraint rejects.
 *   4. `posts (organization_id, idempotency_key)` partial unique
 *      blocks duplicates with the same non-NULL key.
 *   5. `post_targets (post_id, connected_account_id) WHERE status
 *      != 'failed'` partial unique blocks two non-failed targets
 *      pointing at the same account.
 *   6. Cascade delete: removing a post wipes its targets.
 */

let fixture: TestDb;

const planId = '00000000-0000-4000-8000-dc000000d001';
const orgA = '11111111-1111-4111-8111-dc000000d001';
const orgB = '11111111-1111-4111-8111-dc000000d002';
const userA = '22222222-2222-4222-8222-dc000000d001';
const brandA = '33333333-3333-4333-8333-dc000000d001';
const brandB = '33333333-3333-4333-8333-dc000000d002';
const campaignA = '44444444-4444-4444-8444-dc000000d001';
const accountA1 = '55555555-5555-4555-8555-dc000000da01';
const accountB1 = '55555555-5555-4555-8555-dc000000db01';

beforeAll(async () => {
  fixture = await createTestDb();
  await runAdmin(fixture.db, async (tx) => {
    await tx.insert(plans).values({
      id: planId,
      code: 'enterprise',
      name: 'Enterprise',
      priceCents: 109900,
    });
    await tx.insert(users).values({ id: userA, email: 'a@ps.test', name: 'A' });
    await tx.insert(organizations).values([
      { id: orgA, name: 'Org A', slug: 'ps-org-a', planId },
      { id: orgB, name: 'Org B', slug: 'ps-org-b', planId },
    ]);
    await tx.insert(brands).values([
      { id: brandA, organizationId: orgA, name: 'Brand A', slug: 'brand-a' },
      { id: brandB, organizationId: orgB, name: 'Brand B', slug: 'brand-b' },
    ]);
    await tx
      .insert(campaigns)
      .values({
        id: campaignA,
        organizationId: orgA,
        brandId: brandA,
        name: 'Campaign A',
      });
    await tx.insert(connectedAccounts).values([
      {
        id: accountA1,
        organizationId: orgA,
        brandId: brandA,
        platform: 'facebook',
        externalAccountId: 'fb-a-1',
        displayName: 'Account A1',
      },
      {
        id: accountB1,
        organizationId: orgB,
        brandId: brandB,
        platform: 'facebook',
        externalAccountId: 'fb-b-1',
        displayName: 'Account B1',
      },
    ]);
  });
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
});

describe('posts — tenant isolation', () => {
  it('org A cannot see posts from org B', async () => {
    await runAdmin(fixture.db, async (tx) => {
      await tx.insert(posts).values([
        {
          id: '99999999-9999-4999-8999-dc000000da01',
          organizationId: orgA,
          brandId: brandA,
          authorId: userA,
          text: 'org A post',
        },
        {
          id: '99999999-9999-4999-8999-dc000000db01',
          organizationId: orgB,
          brandId: brandB,
          text: 'org B post — must never leak',
        },
      ]);
    });

    const visible = await runAs<Array<{ id: string }>>(
      fixture.db,
      { orgId: orgA, userId: userA },
      async (tx) => tx.select({ id: posts.id }).from(posts),
    );
    expect(visible.every((r) => r.id.includes('a01'))).toBe(true);
    expect(visible.length).toBe(1);
  });
});

describe('post_targets_set_org_id trigger', () => {
  it('auto-fills organization_id from the parent post on insert', async () => {
    const postId = '99999999-9999-4999-8999-dc000000da02';
    const targetId = 'aaaaaaaa-aaaa-4aaa-8aaa-dc000000da01';
    await runAdmin(fixture.db, async (tx) => {
      await tx.insert(posts).values({
        id: postId,
        organizationId: orgA,
        brandId: brandA,
        authorId: userA,
        text: 'parent post for trigger test',
      });
      // Insert WITHOUT organization_id — trigger fills it.
      await tx.execute(sql`
        INSERT INTO post_targets (id, post_id, connected_account_id)
        VALUES (${targetId}::uuid, ${postId}::uuid, ${accountA1}::uuid)
      `);
    });

    const [row] = await runAdmin<Array<{ organizationId: string }>>(
      fixture.db,
      async (tx) =>
        tx
          .select({ organizationId: postTargets.organizationId })
          .from(postTargets)
          .where(eq(postTargets.id, targetId)),
    );
    expect(row?.organizationId).toBe(orgA);
  });

  it('rejects cross-tenant insert: org-A session pointing at org-B post', async () => {
    const orgBPostId = '99999999-9999-4999-8999-dc000000db02';
    await runAdmin(fixture.db, async (tx) => {
      await tx.insert(posts).values({
        id: orgBPostId,
        organizationId: orgB,
        brandId: brandB,
        text: 'org B post',
      });
    });

    // Org-A authenticated SELECT inside the trigger returns no row
    // (RLS hides the org-B post). organization_id stays NULL.
    // NOT NULL constraint rejects.
    await expect(
      runAs(fixture.db, { orgId: orgA, userId: userA }, async (tx) =>
        tx.execute(sql`
          INSERT INTO post_targets (post_id, connected_account_id)
          VALUES (${orgBPostId}::uuid, ${accountA1}::uuid)
        `),
      ),
    ).rejects.toThrow();
  });
});

describe('posts (organization_id, idempotency_key) partial unique', () => {
  it('rejects a duplicate idempotency_key within the same org', async () => {
    await runAdmin(fixture.db, async (tx) =>
      tx.insert(posts).values({
        id: '99999999-9999-4999-8999-dc000000da03',
        organizationId: orgA,
        brandId: brandA,
        text: 'first',
        idempotencyKey: 'shared-key-1',
      }),
    );
    await expect(
      runAdmin(fixture.db, async (tx) =>
        tx.insert(posts).values({
          id: '99999999-9999-4999-8999-dc000000da04',
          organizationId: orgA,
          brandId: brandA,
          text: 'duplicate intent',
          idempotencyKey: 'shared-key-1',
        }),
      ),
    ).rejects.toThrow();
  });

  it('allows NULL idempotency_key to repeat (partial unique)', async () => {
    await runAdmin(fixture.db, async (tx) =>
      tx.insert(posts).values([
        {
          id: '99999999-9999-4999-8999-dc000000da05',
          organizationId: orgA,
          brandId: brandA,
          text: 'null key 1',
        },
        {
          id: '99999999-9999-4999-8999-dc000000da06',
          organizationId: orgA,
          brandId: brandA,
          text: 'null key 2',
        },
      ]),
    );
    const rows = await runAdmin<Array<{ id: string }>>(fixture.db, async (tx) =>
      tx
        .select({ id: posts.id })
        .from(posts)
        .where(eq(posts.organizationId, orgA)),
    );
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });
});

describe('post_targets one-success-per-account partial unique', () => {
  it('blocks two non-failed targets pointing at the same (post, account)', async () => {
    const postId = '99999999-9999-4999-8999-dc000000da07';
    await runAdmin(fixture.db, async (tx) => {
      await tx.insert(posts).values({
        id: postId,
        organizationId: orgA,
        brandId: brandA,
        text: 'parent',
      });
      await tx.insert(postTargets).values({
        organizationId: orgA,
        postId,
        connectedAccountId: accountA1,
        status: 'published',
      });
    });

    await expect(
      runAdmin(fixture.db, async (tx) =>
        tx.insert(postTargets).values({
          organizationId: orgA,
          postId,
          connectedAccountId: accountA1,
          status: 'pending',
        }),
      ),
    ).rejects.toThrow();
  });

  it('allows two failed targets pointing at the same (post, account)', async () => {
    const postId = '99999999-9999-4999-8999-dc000000da08';
    await runAdmin(fixture.db, async (tx) => {
      await tx.insert(posts).values({
        id: postId,
        organizationId: orgA,
        brandId: brandA,
        text: 'retry parent',
      });
      // Two failed rows from retries should be allowed.
      await tx.insert(postTargets).values([
        {
          organizationId: orgA,
          postId,
          connectedAccountId: accountA1,
          status: 'failed',
          errorMessage: 'first attempt: 503',
          attemptCount: 1,
        },
        {
          organizationId: orgA,
          postId,
          connectedAccountId: accountA1,
          status: 'failed',
          errorMessage: 'second attempt: rate limited',
          attemptCount: 2,
        },
      ]);
    });

    const count = await runAdmin<Array<{ n: number }>>(fixture.db, async (tx) => {
      const r = await tx.execute(
        sql`SELECT count(*)::int AS n FROM post_targets WHERE post_id = ${postId}::uuid`,
      );
      // Drizzle-pglite shape normalization.
      const arr =
        'rows' in r && Array.isArray((r as { rows: unknown[] }).rows)
          ? (r as { rows: Array<{ n: number }> }).rows
          : (r as unknown as Array<{ n: number }>);
      return arr;
    });
    expect(count[0]?.n).toBe(2);
  });
});

describe('cascade delete', () => {
  it('removing a post wipes its targets', async () => {
    const postId = '99999999-9999-4999-8999-dc000000da09';
    await runAdmin(fixture.db, async (tx) => {
      await tx.insert(posts).values({
        id: postId,
        organizationId: orgA,
        brandId: brandA,
        text: 'cascade test',
      });
      await tx.insert(postTargets).values({
        organizationId: orgA,
        postId,
        connectedAccountId: accountA1,
      });
    });
    await runAdmin(fixture.db, async (tx) =>
      tx.delete(posts).where(eq(posts.id, postId)),
    );
    const remaining = await runAdmin<Array<{ id: string }>>(
      fixture.db,
      async (tx) =>
        tx
          .select({ id: postTargets.id })
          .from(postTargets)
          .where(eq(postTargets.postId, postId)),
    );
    expect(remaining.length).toBe(0);
  });
});
