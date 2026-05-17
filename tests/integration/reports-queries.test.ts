import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runAdmin, runAs } from '../../lib/db/client';
import {
  contactProfiles,
  inboxMessages,
  inboxThreads,
  organizations,
  plans,
  posts,
  reviews,
  users,
} from '../../lib/db/schema';
import { loadOverviewReportWithTx } from '../../lib/reports/queries';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * Reports aggregations integration (Phase 8 / Commit 27).
 *
 *   1. Empty org → all KPI currents are 0/null, trends flat.
 *   2. Seeded data → counts + averages match expected math.
 *   3. Period filter actually scopes: rows in current window
 *      contribute, prior-window rows feed `previous` deltas.
 *   4. Tenant isolation: orgB's data never leaks into orgA's
 *      payload.
 *
 * The aggregations consume Phase 1-7 tables read-only — no
 * schema or index modifications per the Phase 8 charter rule.
 */

let fixture: TestDb;

const planId = '00000000-0000-4000-8000-c2700c2700c0';
const orgA = '11111111-1111-4111-8111-c2700c2700c0';
const orgB = '11111111-1111-4111-8111-c2700c2700c1';
const userA = '22222222-2222-4222-8222-c2700c2700c0';
const userB = '22222222-2222-4222-8222-c2700c2700c1';

// Use a fixed `now` so the time-range math is reproducible.
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
    await tx.insert(users).values([
      { id: userA, email: 'a@r27.test', name: 'A' },
      { id: userB, email: 'b@r27.test', name: 'B' },
    ]);
    await tx.insert(organizations).values([
      { id: orgA, name: 'Org A', slug: 'r27-org-a', planId },
      { id: orgB, name: 'Org B', slug: 'r27-org-b', planId },
    ]);
  });
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
});

describe('loadOverviewReport — empty org returns null/0 deltas + flat trend', () => {
  it('empty inbox/reviews/posts → counts 0, avg null, trend flat', async () => {
    const payload = await runAs(fixture.db, { orgId: orgA, userId: userA }, (tx) =>
      loadOverviewReportWithTx(tx, {
        orgId: orgA,
        userId: userA,
        period: '30d',
        brandId: null,
        now: NOW,
      }),
    );
    expect(payload.inboxThreadCount.current).toBe(0);
    expect(payload.inboxThreadCount.trend).toBe('flat');
    expect(payload.reviewsAvg.current).toBeNull();
    expect(payload.reviewsCount.current).toBe(0);
    expect(payload.postsPublishedCount.current).toBe(0);
    expect(payload.postsFailedCount.current).toBe(0);
    expect(payload.aiCostCents.current).toBe(0);
    expect(payload.aiGenerationsCount.current).toBe(0);
    expect(payload.crisisRecsPending).toBe(0);
    expect(payload.crisisAcceptedRatio).toBeNull();
  });
});

describe('loadOverviewReport — seeded data matches expected math', () => {
  beforeAll(async () => {
    // Seed 4 reviews inside the 30d window for orgA + 2 in the
    // prior window. Mix of ratings to verify avg math.
    await runAdmin(fixture.db, async (tx) => {
      await tx.insert(reviews).values([
        // Current window (5 days ago) — ratings 5, 4, 3, 1.
        ...[5, 4, 3, 1].map((rating, idx) => ({
          id: `aaaaaaaa-aaaa-4aaa-8aaa-${(0xa00 + idx).toString(16).padStart(12, '0')}`,
          organizationId: orgA,
          platform: 'gbp' as const,
          externalReviewId: `gbp-r27-cur-${idx}`,
          authorName: 'Cliente',
          rating,
          body: 'test',
          sentiment: (rating >= 4 ? 'positive' : rating === 3 ? 'neutral' : 'negative') as
            | 'positive'
            | 'neutral'
            | 'negative',
          status: idx === 0 ? ('responded' as const) : ('pending' as const),
          createdAt: new Date(NOW.getTime() - 5 * dayMs),
        })),
        // Previous window (40 days ago) — ratings 5, 5.
        ...[5, 5].map((rating, idx) => ({
          id: `aaaaaaaa-aaaa-4aaa-8aaa-${(0xb00 + idx).toString(16).padStart(12, '0')}`,
          organizationId: orgA,
          platform: 'gbp' as const,
          externalReviewId: `gbp-r27-prev-${idx}`,
          authorName: 'Cliente',
          rating,
          body: 'test',
          sentiment: 'positive' as const,
          status: 'pending' as const,
          createdAt: new Date(NOW.getTime() - 40 * dayMs),
        })),
      ]);

      // 2 published posts current, 1 prev.
      await tx.insert(posts).values([
        ...[0, 1].map((idx) => ({
          id: `bbbbbbbb-bbbb-4bbb-8bbb-${(0xc00 + idx).toString(16).padStart(12, '0')}`,
          organizationId: orgA,
          authorId: userA,
          status: 'published' as const,
          text: 'p',
          createdAt: new Date(NOW.getTime() - 5 * dayMs),
        })),
        {
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-c00000000c00',
          organizationId: orgA,
          authorId: userA,
          status: 'failed' as const,
          text: 'p',
          createdAt: new Date(NOW.getTime() - 3 * dayMs),
        },
        {
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-c00000000d00',
          organizationId: orgA,
          authorId: userA,
          status: 'published' as const,
          text: 'p',
          createdAt: new Date(NOW.getTime() - 40 * dayMs),
        },
      ]);

      // 1 inbox thread current + 1 prev.
      const contactA = 'dddddddd-dddd-4ddd-8ddd-d00000000000';
      await tx.insert(contactProfiles).values({
        id: contactA,
        organizationId: orgA,
        platform: 'facebook',
        externalId: 'fb-r27',
        displayName: 'Cliente',
      });
      await tx.insert(inboxThreads).values([
        {
          id: 'eeeeeeee-eeee-4eee-8eee-e00000000000',
          organizationId: orgA,
          contactProfileId: contactA,
          platform: 'facebook',
          kind: 'dm',
          externalThreadId: 'thr-r27-cur',
          lastMessageAt: new Date(NOW.getTime() - 5 * dayMs),
          status: 'open',
          createdAt: new Date(NOW.getTime() - 5 * dayMs),
        },
        {
          id: 'eeeeeeee-eeee-4eee-8eee-e00000000001',
          organizationId: orgA,
          contactProfileId: contactA,
          platform: 'facebook',
          kind: 'dm',
          externalThreadId: 'thr-r27-prev',
          lastMessageAt: new Date(NOW.getTime() - 40 * dayMs),
          status: 'open',
          createdAt: new Date(NOW.getTime() - 40 * dayMs),
        },
      ]);

      // Response time pair (inbound then outbound 1h later).
      const inboundAt = new Date(NOW.getTime() - 5 * dayMs);
      const outboundAt = new Date(inboundAt.getTime() + 60 * 60_000);
      await tx.insert(inboxMessages).values([
        {
          id: 'ffffffff-ffff-4fff-8fff-f00000000000',
          organizationId: orgA,
          threadId: 'eeeeeeee-eeee-4eee-8eee-e00000000000',
          direction: 'inbound',
          authorType: 'contact',
          body: 'Hola',
          sentAt: inboundAt,
        },
        {
          id: 'ffffffff-ffff-4fff-8fff-f00000000001',
          organizationId: orgA,
          threadId: 'eeeeeeee-eeee-4eee-8eee-e00000000000',
          direction: 'outbound',
          authorType: 'user',
          body: 'Hola, gracias por escribir',
          sentAt: outboundAt,
        },
      ]);
    });
  });

  it('reviewsAvg = 3.25 (5+4+3+1 / 4), reviewsCount = 4, prev = 5', async () => {
    const payload = await runAs(fixture.db, { orgId: orgA, userId: userA }, (tx) =>
      loadOverviewReportWithTx(tx, {
        orgId: orgA,
        userId: userA,
        period: '30d',
        brandId: null,
        now: NOW,
      }),
    );
    expect(payload.reviewsCount.current).toBe(4);
    expect(payload.reviewsCount.previous).toBe(2);
    expect(payload.reviewsAvg.current).toBeCloseTo(3.25, 2);
    expect(payload.reviewsAvg.previous).toBe(5);
  });

  it('postsPublishedCount: 2 current, 1 previous; postsFailedCount: 1 current', async () => {
    const payload = await runAs(fixture.db, { orgId: orgA, userId: userA }, (tx) =>
      loadOverviewReportWithTx(tx, {
        orgId: orgA,
        userId: userA,
        period: '30d',
        brandId: null,
        now: NOW,
      }),
    );
    expect(payload.postsPublishedCount.current).toBe(2);
    expect(payload.postsPublishedCount.previous).toBe(1);
    expect(payload.postsFailedCount.current).toBe(1);
  });

  it('responseTimeAvgMs ≈ 3_600_000 (1 hour)', async () => {
    const payload = await runAs(fixture.db, { orgId: orgA, userId: userA }, (tx) =>
      loadOverviewReportWithTx(tx, {
        orgId: orgA,
        userId: userA,
        period: '30d',
        brandId: null,
        now: NOW,
      }),
    );
    expect(payload.responseTimeAvgMs.current).toBeCloseTo(3_600_000, -4);
  });

  it('inboxThreadCount: 1 current + 1 previous', async () => {
    const payload = await runAs(fixture.db, { orgId: orgA, userId: userA }, (tx) =>
      loadOverviewReportWithTx(tx, {
        orgId: orgA,
        userId: userA,
        period: '30d',
        brandId: null,
        now: NOW,
      }),
    );
    expect(payload.inboxThreadCount.current).toBe(1);
    expect(payload.inboxThreadCount.previous).toBe(1);
  });
});

describe('loadOverviewReport — tenant isolation', () => {
  it('orgB sees empty payload despite orgA having seeded data', async () => {
    const payload = await runAs(fixture.db, { orgId: orgB, userId: userB }, (tx) =>
      loadOverviewReportWithTx(tx, {
        orgId: orgB,
        userId: userB,
        period: '30d',
        brandId: null,
        now: NOW,
      }),
    );
    expect(payload.reviewsCount.current).toBe(0);
    expect(payload.postsPublishedCount.current).toBe(0);
    expect(payload.inboxThreadCount.current).toBe(0);
  });
});
