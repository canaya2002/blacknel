import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runAdmin, runAs } from '../../lib/db/client';
import {
  brands,
  connectedAccounts,
  organizations,
  plans,
  postTargets,
  posts,
  users,
} from '../../lib/db/schema';
import { loadPublishingReportWithTx } from '../../lib/reports/publishing-queries';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * /reports Publishing tab (Phase 8 / Commit 30).
 *
 *   1. Empty org → 0 counts, 0% success rate.
 *   2. Seeded posts + targets → counts and success-rate math.
 *   3. Brand filter narrows the cohort.
 */

let fixture: TestDb;

const planId = '00000000-0000-4000-8000-c3030c3030c0';
const orgA = '11111111-1111-4111-8111-c3030c3030c0';
const userA = '22222222-2222-4222-8222-c3030c3030c0';
const brandA = '44444444-4444-4444-8444-c3030c3030c0';
const brandB = '44444444-4444-4444-8444-c3030c3030c1';
const conn = '55555555-5555-4555-8555-c3030c3030c0';

const NOW = new Date('2026-05-17T12:00:00Z');
const dayMs = 86_400_000;

beforeAll(async () => {
  fixture = await createTestDb();
  await runAdmin(fixture.db, async (tx) => {
    await tx.insert(plans).values({
      id: planId,
      code: 'enterprise',
      name: 'Enterprise',
      priceCents: 109900,
    });
    await tx.insert(users).values({ id: userA, email: 'a@c30p.test', name: 'A' });
    await tx.insert(organizations).values({
      id: orgA,
      name: 'Org A',
      slug: 'c30p-org-a',
      planId,
    });
    await tx.insert(brands).values([
      { id: brandA, organizationId: orgA, name: 'A', slug: 'a' },
      { id: brandB, organizationId: orgA, name: 'B', slug: 'b' },
    ]);
    await tx.insert(connectedAccounts).values({
      id: conn,
      organizationId: orgA,
      platform: 'facebook',
      externalAccountId: 'fb-1',
      displayName: 'FB',
      status: 'connected',
    });
  });
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
});

describe('loadPublishingReportWithTx — empty org', () => {
  it('returns 0 counts, 0% success rate', async () => {
    const payload = await runAs(fixture.db, { orgId: orgA, userId: userA }, (tx) =>
      loadPublishingReportWithTx(tx, {
        orgId: orgA,
        userId: userA,
        period: '30d',
        brandId: null,
        now: NOW,
      }),
    );
    expect(payload.postsPublished.current).toBe(0);
    expect(payload.postsFailed.current).toBe(0);
    expect(payload.targetSuccessRate.current).toBe(0);
    expect(payload.targetsWithRetry.current).toBe(0);
  });
});

describe('loadPublishingReportWithTx — seeded data', () => {
  beforeAll(async () => {
    await runAdmin(fixture.db, async (tx) => {
      // brandA: 2 published + 1 failed (current window).
      // brandB: 1 published.
      await tx.insert(posts).values([
        {
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-c30300000001',
          organizationId: orgA,
          authorId: userA,
          brandId: brandA,
          status: 'published',
          text: 'p',
          createdAt: new Date(NOW.getTime() - 5 * dayMs),
        },
        {
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-c30300000002',
          organizationId: orgA,
          authorId: userA,
          brandId: brandA,
          status: 'published',
          text: 'p',
          createdAt: new Date(NOW.getTime() - 6 * dayMs),
        },
        {
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-c30300000003',
          organizationId: orgA,
          authorId: userA,
          brandId: brandA,
          status: 'failed',
          text: 'p',
          createdAt: new Date(NOW.getTime() - 4 * dayMs),
        },
        {
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-c30300000004',
          organizationId: orgA,
          authorId: userA,
          brandId: brandB,
          status: 'published',
          text: 'p',
          createdAt: new Date(NOW.getTime() - 5 * dayMs),
        },
      ]);

      // Targets: 3 published, 1 failed, 1 retried (still
      // published though — retry_count > 0 on a 'published').
      await tx.insert(postTargets).values([
        {
          id: 'cccccccc-cccc-4ccc-8ccc-c30300000001',
          organizationId: orgA,
          postId: 'bbbbbbbb-bbbb-4bbb-8bbb-c30300000001',
          connectedAccountId: conn,
          status: 'published',
          retryCount: 0,
          createdAt: new Date(NOW.getTime() - 5 * dayMs),
        },
        {
          id: 'cccccccc-cccc-4ccc-8ccc-c30300000002',
          organizationId: orgA,
          postId: 'bbbbbbbb-bbbb-4bbb-8bbb-c30300000002',
          connectedAccountId: conn,
          status: 'published',
          retryCount: 1,
          createdAt: new Date(NOW.getTime() - 6 * dayMs),
        },
        {
          id: 'cccccccc-cccc-4ccc-8ccc-c30300000003',
          organizationId: orgA,
          postId: 'bbbbbbbb-bbbb-4bbb-8bbb-c30300000003',
          connectedAccountId: conn,
          status: 'failed',
          retryCount: 3,
          createdAt: new Date(NOW.getTime() - 4 * dayMs),
        },
        {
          id: 'cccccccc-cccc-4ccc-8ccc-c30300000004',
          organizationId: orgA,
          postId: 'bbbbbbbb-bbbb-4bbb-8bbb-c30300000004',
          connectedAccountId: conn,
          status: 'published',
          retryCount: 0,
          createdAt: new Date(NOW.getTime() - 5 * dayMs),
        },
      ]);
    });
  });

  it('counts published/failed posts + computes success rate', async () => {
    const payload = await runAs(fixture.db, { orgId: orgA, userId: userA }, (tx) =>
      loadPublishingReportWithTx(tx, {
        orgId: orgA,
        userId: userA,
        period: '30d',
        brandId: null,
        now: NOW,
      }),
    );
    expect(payload.postsPublished.current).toBe(3);
    expect(payload.postsFailed.current).toBe(1);
    // Targets: 3 published / 4 total = 75%. 2 targets had
    // retry_count > 0 (1 published-after-retry + 1 failed-after-3).
    expect(payload.targetSuccessRate.current).toBeCloseTo(75, 0);
    expect(payload.targetsWithRetry.current).toBe(2);
  });

  it('brand filter narrows the cohort — brandB has 1 published only', async () => {
    const payload = await runAs(fixture.db, { orgId: orgA, userId: userA }, (tx) =>
      loadPublishingReportWithTx(tx, {
        orgId: orgA,
        userId: userA,
        period: '30d',
        brandId: brandB,
        now: NOW,
      }),
    );
    expect(payload.postsPublished.current).toBe(1);
    expect(payload.postsFailed.current).toBe(0);
  });
});
