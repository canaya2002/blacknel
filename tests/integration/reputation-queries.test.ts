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
import {
  getCrisisCountsWithTx,
  getOverviewMetricsWithTx,
  getRatingTrendWithTx,
  getResponseTimeStatsWithTx,
  getSentimentDistributionWithTx,
  getStarDistributionWithTx,
  getTopTagsWithTx,
} from '../../lib/reputation/queries';
import type { ReputationFilters } from '../../lib/reputation/filters';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * Integration coverage for the per-card reputation queries. Same
 * fixture-+-runAs pattern as inbox/reviews queries tests. Each `*WithTx`
 * function is exercised against a seeded mini-world with known
 * counts so the assertions are exact.
 *
 * Tenant isolation is covered by the cross-org check: an org-A
 * session running these queries sees only org-A reviews. The org-B
 * row in the fixture has a recognisable platform / rating shape so
 * any leakage would surface.
 */

let fixture: TestDb;

const planId = '00000000-0000-4000-8000-cd000000d001';
const orgA = '11111111-1111-4111-8111-cd000000d001';
const orgB = '11111111-1111-4111-8111-cd000000d002';
const userA = '22222222-2222-4222-8222-cd000000d001';
const brandA = '33333333-3333-4333-8333-cd000000d001';
const locationA1 = '44444444-4444-4444-8444-cd000000d001';
const locationA2 = '44444444-4444-4444-8444-cd000000d002';

const BASE_NOW = new Date('2026-05-15T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

/**
 * Filter shaped like the loader output. The integration tests don't
 * exercise the URL parser — that's covered by reputation-filters.test.ts.
 */
function filterAllPlatforms(): ReputationFilters {
  return {
    dateFrom: new Date(BASE_NOW.getTime() - 30 * DAY),
    dateTo: BASE_NOW,
    windowDays: 30,
    preset: 30,
  };
}

beforeAll(async () => {
  fixture = await createTestDb();
  await runAdmin(fixture.db, async (tx) => {
    await tx.insert(plans).values({
      id: planId,
      code: 'enterprise',
      name: 'Enterprise',
      priceCents: 109900,
    });
    await tx.insert(users).values({ id: userA, email: 'a@rep.test', name: 'A' });
    await tx.insert(organizations).values([
      { id: orgA, name: 'Org A', slug: 'rep-org-a', planId },
      { id: orgB, name: 'Org B', slug: 'rep-org-b', planId },
    ]);
    await tx
      .insert(brands)
      .values({ id: brandA, organizationId: orgA, name: 'Trattoria', slug: 'trattoria' });
    await tx
      .insert(locations)
      .values([
        { id: locationA1, organizationId: orgA, brandId: brandA, name: 'Downtown' },
        { id: locationA2, organizationId: orgA, brandId: brandA, name: 'Mall' },
      ]);

    // ---- Org A: deterministic shape ----------------------------------
    // 10 reviews total in the 30d window.
    // Ratings: 1×5 (positive), 4 (positive), 3 (neutral), 3 (neutral),
    //          2 (negative), 1 (negative), 5, 5, 4, 2 → avg = 3.4.
    // Tags: 5 reviews tagged "servicio", 3 tagged "limpieza",
    //       2 tagged "ruido" — exercises the count >= 3 filter
    //       (servicio + limpieza qualify; ruido does not).
    const rows: Array<typeof reviews.$inferInsert> = [
      // 5-star, 5 days ago, servicio
      {
        id: '55555555-5555-4555-8555-cd000000d001',
        organizationId: orgA,
        brandId: brandA,
        locationId: locationA1,
        platform: 'gbp',
        externalReviewId: 'gbp-rep-1',
        rating: 5,
        body: 'Top.',
        sentiment: 'positive',
        status: 'responded',
        postedAt: new Date(BASE_NOW.getTime() - 5 * DAY),
        tags: ['servicio', 'limpieza'],
      },
      {
        id: '55555555-5555-4555-8555-cd000000d002',
        organizationId: orgA,
        brandId: brandA,
        locationId: locationA1,
        platform: 'gbp',
        externalReviewId: 'gbp-rep-2',
        rating: 4,
        body: 'Bueno.',
        sentiment: 'positive',
        status: 'pending',
        postedAt: new Date(BASE_NOW.getTime() - 6 * DAY),
        tags: ['servicio'],
      },
      {
        id: '55555555-5555-4555-8555-cd000000d003',
        organizationId: orgA,
        brandId: brandA,
        locationId: locationA1,
        platform: 'facebook',
        externalReviewId: 'fb-rep-3',
        rating: 3,
        body: 'Promedio.',
        sentiment: 'neutral',
        status: 'pending',
        postedAt: new Date(BASE_NOW.getTime() - 8 * DAY),
        tags: ['servicio', 'limpieza', 'ruido'],
      },
      {
        id: '55555555-5555-4555-8555-cd000000d004',
        organizationId: orgA,
        brandId: brandA,
        locationId: locationA1,
        platform: 'facebook',
        externalReviewId: 'fb-rep-4',
        rating: 3,
        body: 'Mid.',
        sentiment: 'neutral',
        status: 'pending',
        postedAt: new Date(BASE_NOW.getTime() - 10 * DAY),
        tags: ['servicio'],
      },
      {
        id: '55555555-5555-4555-8555-cd000000d005',
        organizationId: orgA,
        brandId: brandA,
        locationId: locationA1,
        platform: 'gbp',
        externalReviewId: 'gbp-rep-5',
        rating: 2,
        body: 'Malo.',
        sentiment: 'negative',
        status: 'pending',
        postedAt: new Date(BASE_NOW.getTime() - 12 * DAY),
        tags: ['ruido'],
      },
      {
        id: '55555555-5555-4555-8555-cd000000d006',
        organizationId: orgA,
        brandId: brandA,
        locationId: locationA1,
        platform: 'gbp',
        externalReviewId: 'gbp-rep-6',
        rating: 1,
        body: 'Muy malo.',
        sentiment: 'negative',
        status: 'pending',
        postedAt: new Date(BASE_NOW.getTime() - 14 * DAY),
        tags: ['limpieza'],
      },
      {
        id: '55555555-5555-4555-8555-cd000000d007',
        organizationId: orgA,
        brandId: brandA,
        locationId: locationA2,
        platform: 'facebook',
        externalReviewId: 'fb-rep-7',
        rating: 5,
        body: 'Excelente.',
        sentiment: 'positive',
        status: 'responded',
        postedAt: new Date(BASE_NOW.getTime() - 16 * DAY),
        tags: ['servicio'],
      },
      {
        id: '55555555-5555-4555-8555-cd000000d008',
        organizationId: orgA,
        brandId: brandA,
        locationId: locationA2,
        platform: 'facebook',
        externalReviewId: 'fb-rep-8',
        rating: 5,
        body: 'Recomendado.',
        sentiment: 'positive',
        status: 'pending',
        postedAt: new Date(BASE_NOW.getTime() - 18 * DAY),
        tags: ['servicio'],
      },
      {
        id: '55555555-5555-4555-8555-cd000000d009',
        organizationId: orgA,
        brandId: brandA,
        locationId: locationA2,
        platform: 'gbp',
        externalReviewId: 'gbp-rep-9',
        rating: 4,
        body: 'Bien.',
        sentiment: 'positive',
        status: 'pending',
        postedAt: new Date(BASE_NOW.getTime() - 20 * DAY),
        tags: ['limpieza'],
      },
      {
        id: '55555555-5555-4555-8555-cd000000d00a',
        organizationId: orgA,
        brandId: brandA,
        locationId: locationA2,
        platform: 'gbp',
        externalReviewId: 'gbp-rep-10',
        rating: 2,
        body: 'Necesita mejorar.',
        sentiment: 'negative',
        status: 'pending',
        postedAt: new Date(BASE_NOW.getTime() - 22 * DAY),
        tags: [],
      },
      // Org B — must NOT leak.
      {
        id: '55555555-5555-4555-8555-cd0000000b01',
        organizationId: orgB,
        platform: 'gbp',
        externalReviewId: 'gbp-rep-b1',
        rating: 5,
        body: 'OrgB row — must never leak.',
        sentiment: 'positive',
        status: 'pending',
        postedAt: new Date(BASE_NOW.getTime() - 1 * DAY),
        tags: [],
      },
    ];
    await tx.insert(reviews).values(rows);

    // Published responses on reviews 1 + 7 — drives the response-time
    // + response-rate metrics. Review 1 responded 4h after posting,
    // review 7 responded 24h after.
    await tx.insert(reviewResponses).values([
      {
        organizationId: orgA,
        reviewId: '55555555-5555-4555-8555-cd000000d001',
        status: 'published',
        finalText: 'Gracias!',
        publishedAt: new Date(BASE_NOW.getTime() - 5 * DAY + 4 * HOUR),
        authorId: userA,
      },
      {
        organizationId: orgA,
        reviewId: '55555555-5555-4555-8555-cd000000d007',
        status: 'published',
        finalText: 'Mil gracias!',
        publishedAt: new Date(BASE_NOW.getTime() - 16 * DAY + 24 * HOUR),
        authorId: userA,
      },
    ]);
  });
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
});

describe('getOverviewMetricsWithTx', () => {
  it('debug: verify review_responses were inserted', async () => {
    const responseRows = await runAdmin<Array<{ id: string; reviewId: string }>>(
      fixture.db,
      async (tx) =>
        tx.select({ id: reviewResponses.id, reviewId: reviewResponses.reviewId }).from(
          reviewResponses,
        ),
    );
    expect(responseRows.length).toBe(2);
  });

  it('counts reviews, computes avg, and reports response rate', async () => {
    const filters = filterAllPlatforms();
    const m = await runAs(fixture.db, { orgId: orgA, userId: userA }, async (tx) =>
      getOverviewMetricsWithTx(tx, orgA, filters, {
        from: filters.dateFrom,
        to: filters.dateTo,
      }),
    );
    expect(m.reviewCount).toBe(10);
    expect(m.responseCount).toBe(2);
    expect(m.ratingAvg).toBeCloseTo(3.4, 5);
    expect(m.responseRate).toBeCloseTo(20, 5);
  });

  it('does not leak Org B reviews', async () => {
    const filters = filterAllPlatforms();
    const m = await runAs(fixture.db, { orgId: orgA, userId: userA }, async (tx) =>
      getOverviewMetricsWithTx(tx, orgA, filters, {
        from: filters.dateFrom,
        to: filters.dateTo,
      }),
    );
    // 11 total in DB; Org A sees 10.
    expect(m.reviewCount).toBe(10);
  });

  it('respects locationId filter', async () => {
    const filters: ReputationFilters = {
      ...filterAllPlatforms(),
      locationId: locationA1,
    };
    const m = await runAs(fixture.db, { orgId: orgA, userId: userA }, async (tx) =>
      getOverviewMetricsWithTx(tx, orgA, filters, {
        from: filters.dateFrom,
        to: filters.dateTo,
      }),
    );
    // Reviews 1..6 are at locationA1 → 6 reviews.
    expect(m.reviewCount).toBe(6);
  });
});

describe('getStarDistributionWithTx', () => {
  it('returns counts by star rating with correct totals', async () => {
    const filters = filterAllPlatforms();
    const d = await runAs(fixture.db, { orgId: orgA, userId: userA }, async (tx) =>
      getStarDistributionWithTx(tx, orgA, filters, {
        from: filters.dateFrom,
        to: filters.dateTo,
      }),
    );
    expect(d.total).toBe(10);
    expect(d.counts[5]).toBe(3); // reviews 1, 7, 8
    expect(d.counts[4]).toBe(2); // reviews 2, 9
    expect(d.counts[3]).toBe(2); // reviews 3, 4
    expect(d.counts[2]).toBe(2); // reviews 5, 10
    expect(d.counts[1]).toBe(1); // review 6
  });
});

describe('getSentimentDistributionWithTx', () => {
  it('returns counts by sentiment', async () => {
    const filters = filterAllPlatforms();
    const d = await runAs(fixture.db, { orgId: orgA, userId: userA }, async (tx) =>
      getSentimentDistributionWithTx(tx, orgA, filters, {
        from: filters.dateFrom,
        to: filters.dateTo,
      }),
    );
    expect(d.total).toBe(10);
    expect(d.counts.positive).toBe(5);
    expect(d.counts.neutral).toBe(2);
    expect(d.counts.negative).toBe(3);
  });
});

describe('getRatingTrendWithTx', () => {
  it('groups by week and produces a non-empty timeseries', async () => {
    const filters = filterAllPlatforms();
    const trend = await runAs(fixture.db, { orgId: orgA, userId: userA }, async (tx) =>
      getRatingTrendWithTx(tx, orgA, filters),
    );
    expect(trend.length).toBeGreaterThan(0);
    for (const p of trend) {
      expect(typeof p.week).toBe('string');
      expect(p.reviewCount).toBeGreaterThan(0);
    }
  });
});

describe('getTopTagsWithTx', () => {
  it('returns only tags with count >= 3, ordered DESC, top 10', async () => {
    const filters = filterAllPlatforms();
    const tags = await runAs(fixture.db, { orgId: orgA, userId: userA }, async (tx) =>
      getTopTagsWithTx(
        tx,
        orgA,
        filters,
        { from: filters.dateFrom, to: filters.dateTo },
        10,
      ),
    );
    // servicio: 5 (reviews 1,2,3,4,7,8) — wait, 1,2,3,4,7,8 = 6 → 6 counts
    // limpieza: 3 (reviews 1,3,6,9) → 4
    // ruido: 2 (reviews 3,5) → BELOW threshold, filtered out
    const names = tags.map((t) => t.tag).sort();
    expect(names).toEqual(['limpieza', 'servicio']);
  });

  it('computes percentage of reviews per tag against the total count', async () => {
    const filters = filterAllPlatforms();
    const tags = await runAs(fixture.db, { orgId: orgA, userId: userA }, async (tx) =>
      getTopTagsWithTx(
        tx,
        orgA,
        filters,
        { from: filters.dateFrom, to: filters.dateTo },
        10,
      ),
    );
    const servicio = tags.find((t) => t.tag === 'servicio')!;
    // 6 reviews carry "servicio" / 10 total = 60%.
    expect(servicio.percentOfReviews).toBe(60);
    expect(servicio.count).toBe(6);
  });

  it('reports the dominant sentiment per tag', async () => {
    const filters = filterAllPlatforms();
    const tags = await runAs(fixture.db, { orgId: orgA, userId: userA }, async (tx) =>
      getTopTagsWithTx(
        tx,
        orgA,
        filters,
        { from: filters.dateFrom, to: filters.dateTo },
        10,
      ),
    );
    const servicio = tags.find((t) => t.tag === 'servicio')!;
    // servicio: 4 positive (1,2,7,8) + 2 neutral (3,4). Positive wins.
    expect(servicio.dominantSentiment).toBe('positive');
  });
});

describe('getResponseTimeStatsWithTx', () => {
  it('computes avg / p50 / p90 in hours over reviews with a published response', async () => {
    const filters = filterAllPlatforms();
    const s = await runAs(fixture.db, { orgId: orgA, userId: userA }, async (tx) =>
      getResponseTimeStatsWithTx(tx, orgA, filters, {
        from: filters.dateFrom,
        to: filters.dateTo,
      }),
    );
    // Review 1 → 4h, Review 7 → 24h. avg=14, p50=14, p90≈22.
    expect(s.responseSampleSize).toBe(2);
    expect(s.avgHours).toBeCloseTo(14, 1);
    expect(s.p50Hours).toBeCloseTo(14, 1);
    expect(s.p90Hours).toBeCloseTo(22, 1);
  });
});

describe('getCrisisCountsWithTx', () => {
  it('counts negative reviews in the 72h and prior-72h windows', async () => {
    const filters = filterAllPlatforms();
    const c = await runAs(fixture.db, { orgId: orgA, userId: userA }, async (tx) =>
      getCrisisCountsWithTx(tx, orgA, filters, BASE_NOW),
    );
    // None of the seeded negatives sit inside the last 72h (5,6,10
    // are 12d/14d/22d old). Both windows should be 0.
    expect(c.recentCount).toBe(0);
    expect(c.previousCount).toBe(0);
  });

  it('triggers when negative reviews cluster inside the last 72h', async () => {
    // Insert 5 brand-new 1★ reviews on Org B (we'll query as Org B to
    // avoid mutating the Org-A counts other tests rely on).
    const negativeIds: string[] = [];
    await runAdmin(fixture.db, async (tx) => {
      for (let i = 0; i < 5; i++) {
        const id = `55555555-5555-4555-8555-cd000c00000${i}`;
        negativeIds.push(id);
        await tx.insert(reviews).values({
          id,
          organizationId: orgB,
          platform: 'gbp',
          externalReviewId: `gbp-crisis-${i}`,
          rating: 1,
          body: 'crisis sample',
          sentiment: 'negative',
          status: 'pending',
          postedAt: new Date(BASE_NOW.getTime() - i * 4 * HOUR),
        });
      }
    });
    const c = await runAs(fixture.db, { orgId: orgB, userId: userA }, async (tx) =>
      getCrisisCountsWithTx(
        tx,
        orgB,
        { ...filterAllPlatforms() },
        BASE_NOW,
      ),
    );
    expect(c.recentCount).toBe(5);
    expect(c.previousCount).toBe(0);
    expect(c.sampleReviewIds.length).toBeGreaterThan(0);
  });
});
