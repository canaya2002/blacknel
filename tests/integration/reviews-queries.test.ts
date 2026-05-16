import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runAdmin, runAs } from '../../lib/db/client';
import {
  brands,
  locations,
  organizations,
  plans,
  reviewResponses,
  reviews,
  users,
} from '../../lib/db/schema';
import { decodeReviewCursor } from '../../lib/reviews/cursor';
import {
  listReviewsWithTx,
  orgHasAnyReviewsWithTx,
} from '../../lib/reviews/queries';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * Integration coverage for `listReviewsWithTx`. Mirrors the inbox
 * queries test layout: seed a deterministic mini-world through
 * `runAdmin` (RLS off for setup), exercise via `runAs` so RLS evaluates
 * the same policies production hits.
 *
 * What's locked in:
 *
 *   1. Tenant isolation — org B reviews never appear for an org A session.
 *   2. Sort order — DESC `(posted_at, id)`.
 *   3. Filters: rating, sentiment, status, platform, dateFrom/dateTo,
 *      assignedTo (= me / unassigned).
 *   4. Cursor pagination — page-by-page covers every row exactly once.
 *   5. Plan gating (Ajuste 4):
 *        - Yelp review exists in org's DB.
 *        - listReviewsWithTx({ filters: { platform: ['yelp'] }, plan: 'growth' })
 *          returns EMPTY (no rows, no nextCursor).
 *        - Same query without `plan` returns the row (proves the row
 *          itself is visible — the gating, not RLS, hid it).
 *        - Mixed platform list on Growth keeps the allowed members
 *          and drops the gated ones.
 *   6. `hasPublishedResponse` flag derives from review_responses.
 *   7. `canReply` flag — false for Yelp rows, true for GBP/Facebook.
 */

let fixture: TestDb;

// Growth plan = facebook, instagram, gbp, whatsapp, tiktok, linkedin.
// Yelp is NOT in Growth → it's our gated test platform.
const growthPlanId = '00000000-0000-4000-8000-fff000000001';
const enterprisePlanId = '00000000-0000-4000-8000-fff000000002';
const orgA = '11111111-1111-4111-8111-fff000000001';
const orgB = '11111111-1111-4111-8111-fff000000002';
const userA = '22222222-2222-4222-8222-fff000000001';
const userB = '22222222-2222-4222-8222-fff000000002';
const brandA = '33333333-3333-4333-8333-fff000000001';
const locationA = '44444444-4444-4444-8444-fff000000001';

// Org A reviews: a mix of platforms / ratings / sentiments / dates.
// IDs are stable so cursor / pagination tests can assert exact ordering.
const rOldest = '55555555-5555-4555-8555-fff000000001'; // -10d, gbp, 5★
const r9d = '55555555-5555-4555-8555-fff000000002'; //   -9d, gbp, 1★, unassigned
const r8d = '55555555-5555-4555-8555-fff000000003'; //   -8d, facebook, 3★, assigned userA
const r7d = '55555555-5555-4555-8555-fff000000004'; //   -7d, gbp, 4★
const r6d = '55555555-5555-4555-8555-fff000000005'; //   -6d, facebook, 5★, archived
const r5d = '55555555-5555-4555-8555-fff000000006'; //   -5d, instagram, 2★
const r3d = '55555555-5555-4555-8555-fff000000007'; //   -3d, gbp, 4★, responded
const r2d = '55555555-5555-4555-8555-fff000000008'; //   -2d, gbp, 5★
const r1d = '55555555-5555-4555-8555-fff000000009'; //   -1d, facebook, 5★
const rYelp = '55555555-5555-4555-8555-fff00000000a'; //  -4d, YELP, 1★ (gated for growth)

const r9d_response = '99999999-9999-4999-8999-fff000000002';
const r3d_response = '99999999-9999-4999-8999-fff000000007';

const reviewB1 = '55555555-5555-4555-8555-fff0000000b1';

const BASE_NOW = new Date('2026-05-15T16:00:00Z').getTime();
const DAY = 24 * 60 * 60 * 1000;

beforeAll(async () => {
  fixture = await createTestDb();
  await runAdmin(fixture.db, async (tx) => {
    await tx.insert(plans).values([
      { id: growthPlanId, code: 'growth', name: 'Growth', priceCents: 29900 },
      {
        id: enterprisePlanId,
        code: 'enterprise',
        name: 'Enterprise',
        priceCents: 109900,
      },
    ]);
    await tx.insert(users).values([
      { id: userA, email: 'a@rq.test', name: 'A' },
      { id: userB, email: 'b@rq.test', name: 'B' },
    ]);
    await tx.insert(organizations).values([
      { id: orgA, name: 'Q Org A', slug: 'rq-org-a', planId: growthPlanId },
      { id: orgB, name: 'Q Org B', slug: 'rq-org-b', planId: enterprisePlanId },
    ]);
    await tx
      .insert(brands)
      .values({ id: brandA, organizationId: orgA, name: 'Brand A', slug: 'brand-a' });
    await tx
      .insert(locations)
      .values({ id: locationA, organizationId: orgA, brandId: brandA, name: 'Downtown' });

    await tx.insert(reviews).values([
      {
        id: rOldest,
        organizationId: orgA,
        brandId: brandA,
        locationId: locationA,
        platform: 'gbp',
        externalReviewId: 'gbp-rq-1',
        authorName: 'Oldest',
        rating: 5,
        body: 'Top experience.',
        sentiment: 'positive',
        status: 'pending',
        assignedTo: userA,
        postedAt: new Date(BASE_NOW - 10 * DAY),
      },
      {
        id: r9d,
        organizationId: orgA,
        brandId: brandA,
        locationId: locationA,
        platform: 'gbp',
        externalReviewId: 'gbp-rq-2',
        authorName: 'NineDays',
        rating: 1,
        body: 'Bad service.',
        sentiment: 'negative',
        status: 'pending',
        assignedTo: null, // unassigned (drives unassigned filter test)
        postedAt: new Date(BASE_NOW - 9 * DAY),
      },
      {
        id: r8d,
        organizationId: orgA,
        brandId: brandA,
        locationId: locationA,
        platform: 'facebook',
        externalReviewId: 'fb-rq-3',
        authorName: 'EightDays',
        rating: 3,
        body: 'Average.',
        sentiment: 'neutral',
        status: 'in_progress',
        assignedTo: userA,
        postedAt: new Date(BASE_NOW - 8 * DAY),
      },
      {
        id: r7d,
        organizationId: orgA,
        brandId: brandA,
        locationId: locationA,
        platform: 'gbp',
        externalReviewId: 'gbp-rq-4',
        authorName: 'SevenDays',
        rating: 4,
        body: 'Good vibes overall.',
        sentiment: 'positive',
        status: 'pending',
        assignedTo: userA,
        postedAt: new Date(BASE_NOW - 7 * DAY),
      },
      {
        id: r6d,
        organizationId: orgA,
        brandId: brandA,
        locationId: locationA,
        platform: 'facebook',
        externalReviewId: 'fb-rq-5',
        authorName: 'SixDays',
        rating: 5,
        body: 'Loved it.',
        sentiment: 'positive',
        status: 'archived',
        assignedTo: userA,
        postedAt: new Date(BASE_NOW - 6 * DAY),
      },
      {
        id: r5d,
        organizationId: orgA,
        brandId: brandA,
        locationId: locationA,
        platform: 'instagram',
        externalReviewId: 'ig-rq-6',
        authorName: 'FiveDays',
        rating: 2,
        body: 'Disappointed.',
        sentiment: 'negative',
        status: 'pending',
        assignedTo: userA,
        postedAt: new Date(BASE_NOW - 5 * DAY),
      },
      {
        id: rYelp,
        organizationId: orgA,
        brandId: brandA,
        locationId: locationA,
        platform: 'yelp',
        externalReviewId: 'yelp-rq-7',
        authorName: 'YelpHater',
        rating: 1,
        body: 'Yelp gated test row.',
        sentiment: 'negative',
        status: 'pending',
        assignedTo: userA,
        postedAt: new Date(BASE_NOW - 4 * DAY),
      },
      {
        id: r3d,
        organizationId: orgA,
        brandId: brandA,
        locationId: locationA,
        platform: 'gbp',
        externalReviewId: 'gbp-rq-8',
        authorName: 'ThreeDays',
        rating: 4,
        body: 'Pretty good.',
        sentiment: 'positive',
        status: 'responded',
        assignedTo: userA,
        postedAt: new Date(BASE_NOW - 3 * DAY),
      },
      {
        id: r2d,
        organizationId: orgA,
        brandId: brandA,
        locationId: locationA,
        platform: 'gbp',
        externalReviewId: 'gbp-rq-9',
        authorName: 'TwoDays',
        rating: 5,
        body: 'Excellent.',
        sentiment: 'positive',
        status: 'pending',
        assignedTo: userA,
        postedAt: new Date(BASE_NOW - 2 * DAY),
      },
      {
        id: r1d,
        organizationId: orgA,
        brandId: brandA,
        locationId: locationA,
        platform: 'facebook',
        externalReviewId: 'fb-rq-10',
        authorName: 'OneDay',
        rating: 5,
        body: 'Recent positive.',
        sentiment: 'positive',
        status: 'pending',
        assignedTo: userA,
        postedAt: new Date(BASE_NOW - 1 * DAY),
      },
      // Org B row — exists only to verify RLS isolation.
      {
        id: reviewB1,
        organizationId: orgB,
        platform: 'gbp',
        externalReviewId: 'gbp-rq-b1',
        authorName: 'OrgB Reviewer',
        rating: 5,
        body: 'Org B content — must never leak.',
        sentiment: 'positive',
        status: 'pending',
        postedAt: new Date(BASE_NOW - 1 * DAY),
      },
    ]);

    // Two published responses so `hasPublishedResponse` toggles per-row.
    await tx.insert(reviewResponses).values([
      {
        id: r9d_response,
        organizationId: orgA,
        reviewId: r9d,
        finalText: 'Lamentamos la experiencia.',
        status: 'published',
        authorId: userA,
        publishedAt: new Date(BASE_NOW - 9 * DAY + 4 * 60 * 60 * 1000),
      },
      {
        id: r3d_response,
        organizationId: orgA,
        reviewId: r3d,
        finalText: 'Gracias por tu reseña.',
        status: 'published',
        authorId: userA,
        publishedAt: new Date(BASE_NOW - 3 * DAY + 4 * 60 * 60 * 1000),
      },
    ]);
  });
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
});

// All ten org-A reviews including the Yelp row (no plan filter applied).
const ORG_A_TOTAL = 10;

describe('listReviewsWithTx — basic listing', () => {
  it('returns org A rows only, DESC posted_at order', async () => {
    const page = await runAs(
      fixture.db,
      { orgId: orgA, userId: userA },
      async (tx) =>
        listReviewsWithTx(tx, {
          orgId: orgA,
          userId: userA,
          filters: {},
          cursor: null,
          pageSize: 50,
        }),
    );
    expect(page.reviews.length).toBe(ORG_A_TOTAL);
    // Most recent first → r1d.
    expect(page.reviews[0]?.id).toBe(r1d);
    expect(page.reviews[page.reviews.length - 1]?.id).toBe(rOldest);
    expect(page.reviews.every((r) => r.id !== reviewB1)).toBe(true);
    expect(page.nextCursor).toBeNull();
  });

  it('joins location.name and projects bodyExcerpt', async () => {
    const page = await runAs(
      fixture.db,
      { orgId: orgA, userId: userA },
      async (tx) =>
        listReviewsWithTx(tx, {
          orgId: orgA,
          userId: userA,
          filters: { platform: ['gbp'] },
          cursor: null,
          pageSize: 1,
        }),
    );
    expect(page.reviews[0]?.locationName).toBe('Downtown');
    expect(page.reviews[0]?.bodyExcerpt.length).toBeGreaterThan(0);
  });

  it('computes hasPublishedResponse from review_responses', async () => {
    const page = await runAs(
      fixture.db,
      { orgId: orgA, userId: userA },
      async (tx) =>
        listReviewsWithTx(tx, {
          orgId: orgA,
          userId: userA,
          filters: {},
          cursor: null,
          pageSize: 50,
        }),
    );
    const byId = new Map(page.reviews.map((r) => [r.id, r] as const));
    expect(byId.get(r9d)?.hasPublishedResponse).toBe(true);
    expect(byId.get(r3d)?.hasPublishedResponse).toBe(true);
    expect(byId.get(r1d)?.hasPublishedResponse).toBe(false);
  });

  it('derives canReply from platform — false on Yelp, true on GBP/Facebook', async () => {
    const page = await runAs(
      fixture.db,
      { orgId: orgA, userId: userA },
      async (tx) =>
        listReviewsWithTx(tx, {
          orgId: orgA,
          userId: userA,
          filters: {},
          cursor: null,
          pageSize: 50,
        }),
    );
    const byId = new Map(page.reviews.map((r) => [r.id, r] as const));
    expect(byId.get(rYelp)?.canReply).toBe(false);
    expect(byId.get(r1d)?.canReply).toBe(true);
    expect(byId.get(rOldest)?.canReply).toBe(true);
  });
});

describe('listReviewsWithTx — filters', () => {
  it('filters by rating (multi-value)', async () => {
    const page = await runAs(
      fixture.db,
      { orgId: orgA, userId: userA },
      async (tx) =>
        listReviewsWithTx(tx, {
          orgId: orgA,
          userId: userA,
          filters: { rating: [1, 2] },
          cursor: null,
          pageSize: 50,
        }),
    );
    expect(page.reviews.every((r) => r.rating === 1 || r.rating === 2)).toBe(true);
    expect(page.reviews.length).toBeGreaterThan(0);
  });

  it('filters by sentiment=negative', async () => {
    const page = await runAs(
      fixture.db,
      { orgId: orgA, userId: userA },
      async (tx) =>
        listReviewsWithTx(tx, {
          orgId: orgA,
          userId: userA,
          filters: { sentiment: ['negative'] },
          cursor: null,
          pageSize: 50,
        }),
    );
    expect(page.reviews.every((r) => r.sentiment === 'negative')).toBe(true);
  });

  it('filters by status=responded', async () => {
    const page = await runAs(
      fixture.db,
      { orgId: orgA, userId: userA },
      async (tx) =>
        listReviewsWithTx(tx, {
          orgId: orgA,
          userId: userA,
          filters: { status: ['responded'] },
          cursor: null,
          pageSize: 50,
        }),
    );
    expect(page.reviews.length).toBe(1);
    expect(page.reviews[0]?.id).toBe(r3d);
  });

  it('filters by platform=facebook', async () => {
    const page = await runAs(
      fixture.db,
      { orgId: orgA, userId: userA },
      async (tx) =>
        listReviewsWithTx(tx, {
          orgId: orgA,
          userId: userA,
          filters: { platform: ['facebook'] },
          cursor: null,
          pageSize: 50,
        }),
    );
    expect(page.reviews.every((r) => r.platform === 'facebook')).toBe(true);
    expect(page.reviews.length).toBe(3);
  });

  it('filters by assignedTo=unassigned', async () => {
    const page = await runAs(
      fixture.db,
      { orgId: orgA, userId: userA },
      async (tx) =>
        listReviewsWithTx(tx, {
          orgId: orgA,
          userId: userA,
          filters: { assignedTo: 'unassigned' },
          cursor: null,
          pageSize: 50,
        }),
    );
    expect(page.reviews.length).toBe(1);
    expect(page.reviews[0]?.id).toBe(r9d);
  });

  it('filters by assignedTo=me', async () => {
    const page = await runAs(
      fixture.db,
      { orgId: orgA, userId: userA },
      async (tx) =>
        listReviewsWithTx(tx, {
          orgId: orgA,
          userId: userA,
          filters: { assignedTo: 'me' },
          cursor: null,
          pageSize: 50,
        }),
    );
    expect(page.reviews.every((r) => r.assignedTo === userA)).toBe(true);
  });

  it('filters by date range — last 5 days', async () => {
    const dateTo = isoDate(new Date(BASE_NOW));
    const dateFrom = isoDate(new Date(BASE_NOW - 5 * DAY));
    const page = await runAs(
      fixture.db,
      { orgId: orgA, userId: userA },
      async (tx) =>
        listReviewsWithTx(tx, {
          orgId: orgA,
          userId: userA,
          filters: { dateFrom, dateTo },
          cursor: null,
          pageSize: 50,
        }),
    );
    // r5d, rYelp(-4d), r3d, r2d, r1d → 5 rows.
    const ids = new Set(page.reviews.map((r) => r.id));
    expect(ids.has(r5d)).toBe(true);
    expect(ids.has(rYelp)).toBe(true);
    expect(ids.has(r3d)).toBe(true);
    expect(ids.has(r2d)).toBe(true);
    expect(ids.has(r1d)).toBe(true);
    expect(ids.has(r6d)).toBe(false);
    expect(ids.has(rOldest)).toBe(false);
  });

  it('q matches review body (ILIKE)', async () => {
    const page = await runAs(
      fixture.db,
      { orgId: orgA, userId: userA },
      async (tx) =>
        listReviewsWithTx(tx, {
          orgId: orgA,
          userId: userA,
          filters: { q: 'disappointed' },
          cursor: null,
          pageSize: 50,
        }),
    );
    expect(page.reviews.length).toBe(1);
    expect(page.reviews[0]?.id).toBe(r5d);
  });
});

describe('listReviewsWithTx — cursor pagination', () => {
  it('paginates through every row exactly once with no overlap', async () => {
    const pageSize = 3;
    const seen: string[] = [];
    let cursor: ReturnType<typeof decodeReviewCursor> = null;
    for (let i = 0; i < 5; i++) {
      const page = await runAs(
        fixture.db,
        { orgId: orgA, userId: userA },
        async (tx) =>
          listReviewsWithTx(tx, {
            orgId: orgA,
            userId: userA,
            filters: {},
            cursor,
            pageSize,
          }),
      );
      seen.push(...page.reviews.map((r) => r.id));
      if (!page.nextCursor) break;
      cursor = decodeReviewCursor(page.nextCursor);
    }
    expect(seen.length).toBe(ORG_A_TOTAL);
    expect(new Set(seen).size).toBe(ORG_A_TOTAL);
  });

  it('emits a nextCursor only when there is a next page', async () => {
    const page = await runAs(
      fixture.db,
      { orgId: orgA, userId: userA },
      async (tx) =>
        listReviewsWithTx(tx, {
          orgId: orgA,
          userId: userA,
          filters: {},
          cursor: null,
          pageSize: 3,
        }),
    );
    expect(page.reviews.length).toBe(3);
    expect(page.nextCursor).not.toBeNull();
  });
});

describe('listReviewsWithTx — tenant isolation', () => {
  it('org B rows are invisible to org A session', async () => {
    const page = await runAs(
      fixture.db,
      { orgId: orgA, userId: userA },
      async (tx) =>
        listReviewsWithTx(tx, {
          orgId: orgA,
          userId: userA,
          filters: {},
          cursor: null,
          pageSize: 50,
        }),
    );
    expect(page.reviews.every((r) => r.id !== reviewB1)).toBe(true);
  });
});

describe('listReviewsWithTx — plan gating (Ajuste 4)', () => {
  it('without `plan`, a Yelp row in Org A IS visible (proves RLS does not hide it)', async () => {
    const page = await runAs(
      fixture.db,
      { orgId: orgA, userId: userA },
      async (tx) =>
        listReviewsWithTx(tx, {
          orgId: orgA,
          userId: userA,
          filters: { platform: ['yelp'] },
          cursor: null,
          pageSize: 50,
        }),
    );
    expect(page.reviews.length).toBe(1);
    expect(page.reviews[0]?.id).toBe(rYelp);
  });

  it('with `plan: growth`, listReviews({ platform: [yelp] }) returns EMPTY', async () => {
    const page = await runAs(
      fixture.db,
      { orgId: orgA, userId: userA },
      async (tx) =>
        listReviewsWithTx(tx, {
          orgId: orgA,
          userId: userA,
          filters: { platform: ['yelp'] },
          cursor: null,
          pageSize: 50,
          plan: 'growth',
        }),
    );
    expect(page.reviews.length).toBe(0);
    expect(page.nextCursor).toBeNull();
  });

  it('with `plan: enterprise`, the same Yelp filter returns the row', async () => {
    const page = await runAs(
      fixture.db,
      { orgId: orgA, userId: userA },
      async (tx) =>
        listReviewsWithTx(tx, {
          orgId: orgA,
          userId: userA,
          filters: { platform: ['yelp'] },
          cursor: null,
          pageSize: 50,
          plan: 'enterprise',
        }),
    );
    expect(page.reviews.length).toBe(1);
    expect(page.reviews[0]?.id).toBe(rYelp);
  });

  it('mixed list on Growth: keeps allowed (facebook), drops gated (yelp)', async () => {
    const page = await runAs(
      fixture.db,
      { orgId: orgA, userId: userA },
      async (tx) =>
        listReviewsWithTx(tx, {
          orgId: orgA,
          userId: userA,
          filters: { platform: ['facebook', 'yelp'] },
          cursor: null,
          pageSize: 50,
          plan: 'growth',
        }),
    );
    expect(page.reviews.every((r) => r.platform === 'facebook')).toBe(true);
    expect(page.reviews.length).toBe(3);
  });
});

describe('orgHasAnyReviewsWithTx', () => {
  it('returns true when the org has any review', async () => {
    const hasAny = await runAs(
      fixture.db,
      { orgId: orgA, userId: userA },
      async (tx) => orgHasAnyReviewsWithTx(tx, { orgId: orgA }),
    );
    expect(hasAny).toBe(true);
  });

  it('returns false for an org with no reviews', async () => {
    const orgC = '11111111-1111-4111-8111-fff0000000c1';
    await runAdmin(fixture.db, async (tx) =>
      tx
        .insert(organizations)
        .values({
          id: orgC,
          name: 'No Reviews Org',
          slug: 'rq-org-c',
          planId: growthPlanId,
        }),
    );
    const hasAny = await runAs(
      fixture.db,
      { orgId: orgC, userId: userA },
      async (tx) => orgHasAnyReviewsWithTx(tx, { orgId: orgC }),
    );
    expect(hasAny).toBe(false);
  });
});

function isoDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
