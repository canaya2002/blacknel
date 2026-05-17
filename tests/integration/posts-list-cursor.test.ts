import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runAdmin, runAs } from '../../lib/db/client';
import {
  brands,
  organizations,
  plans,
  posts,
  users,
} from '../../lib/db/schema';
import { decodePostCursor } from '../../lib/publish/cursor';
import { listPostsWithTx } from '../../lib/publish/queries';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * Cursor pagination on /publish post list (Commit 21, B11).
 *
 * Seeds 51 draft posts so the first batch hits the 50-row page
 * size + one more. Three cases:
 *
 *   1. First batch (no cursor) returns 50 + nextCursor !== null.
 *   2. Second batch (with the returned cursor) continues from
 *      where the first left off and the union covers all 51.
 *   3. Stale cursor against a different filter set returns
 *      reasonable results without throwing.
 *
 * Uses the `*WithTx` variant under `runAs` so we don't hit the
 * `getRawDb()` guard production `dbAs` enforces in test runs.
 */

let fixture: TestDb;

const planId = '00000000-0000-4000-8000-cc00cc00cc00';
const orgId = '11111111-1111-4111-8111-cc00cc00cc00';
const userId = '22222222-2222-4222-8222-cc00cc00cc00';
const brandId = '33333333-3333-4333-8333-cc00cc00cc00';

beforeAll(async () => {
  fixture = await createTestDb();
  await runAdmin(fixture.db, async (tx) => {
    await tx.insert(plans).values({
      id: planId,
      code: 'enterprise',
      name: 'Enterprise',
      priceCents: 109900,
    });
    await tx.insert(users).values({ id: userId, email: 'a@plc.test', name: 'A' });
    await tx.insert(organizations).values({
      id: orgId,
      name: 'PLC Org',
      slug: 'plc-org',
      planId,
    });
    await tx.insert(brands).values({
      id: brandId,
      organizationId: orgId,
      name: 'PLC Brand',
      slug: 'plc-brand',
    });

    // Seed 51 draft posts with monotonic createdAt so the cursor
    // path is deterministic. Each insert is 1s apart.
    const baseTs = Date.UTC(2026, 0, 1);
    const values: Array<typeof posts.$inferInsert> = [];
    for (let i = 0; i < 51; i++) {
      values.push({
        id: `aaaaaaaa-aaaa-4aaa-8aaa-cc00cc00${(0xaa00 + i).toString(16).padStart(4, '0')}`,
        organizationId: orgId,
        brandId,
        authorId: userId,
        status: 'draft',
        text: `Post #${i}`,
        createdAt: new Date(baseTs + i * 1000),
      });
    }
    await tx.insert(posts).values(values);
  });
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
});

describe('posts-list cursor — first batch + hasMore', () => {
  it('returns 50 posts and a non-null nextCursor when 51 rows exist', async () => {
    const page = await runAs(fixture.db, { orgId, userId }, (tx) =>
      listPostsWithTx(tx, {
        orgId,
        userId,
        filters: {},
        cursor: null,
      }),
    );
    expect(page.posts.length).toBe(50);
    expect(page.nextCursor).not.toBeNull();
    expect(decodePostCursor(page.nextCursor)).not.toBeNull();
  });
});

describe('posts-list cursor — second batch via cursor continues', () => {
  it('returns the remaining 1 post when the cursor is the last of batch 1', async () => {
    const first = await runAs(fixture.db, { orgId, userId }, (tx) =>
      listPostsWithTx(tx, {
        orgId,
        userId,
        filters: {},
        cursor: null,
      }),
    );
    expect(first.nextCursor).not.toBeNull();
    const cursor = decodePostCursor(first.nextCursor);
    expect(cursor).not.toBeNull();

    const second = await runAs(fixture.db, { orgId, userId }, (tx) =>
      listPostsWithTx(tx, {
        orgId,
        userId,
        filters: {},
        cursor,
      }),
    );
    expect(second.posts.length).toBe(1);
    expect(second.nextCursor).toBeNull();

    // No overlap — the cursor predicate uses (created_at, id) < cursor.
    const idsFirst = new Set(first.posts.map((p) => p.id));
    const idsSecond = new Set(second.posts.map((p) => p.id));
    for (const id of idsSecond) {
      expect(idsFirst.has(id)).toBe(false);
    }
    // Union covers all 51.
    expect(idsFirst.size + idsSecond.size).toBe(51);
  });
});

describe('posts-list cursor — stale cursor against a different filter degrades to 0', () => {
  it('cursor from un-filtered query against status=published filter returns 0 (no rows published)', async () => {
    const first = await runAs(fixture.db, { orgId, userId }, (tx) =>
      listPostsWithTx(tx, {
        orgId,
        userId,
        filters: {},
        cursor: null,
      }),
    );
    const cursor = decodePostCursor(first.nextCursor);
    const page = await runAs(fixture.db, { orgId, userId }, (tx) =>
      listPostsWithTx(tx, {
        orgId,
        userId,
        filters: { status: ['published'] },
        cursor,
      }),
    );
    expect(page.posts.length).toBe(0);
    expect(page.nextCursor).toBeNull();
  });
});
