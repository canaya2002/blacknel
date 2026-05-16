import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { runAdmin, runAs } from '../../lib/db/client';
import {
  brands,
  locations,
  organizations,
  plans,
  reviews,
  users,
} from '../../lib/db/schema';
import {
  defaultDashboardQueryDeps,
  loadReputationDashboardDataWithTx,
  type DashboardQueryDeps,
} from '../../lib/reputation/queries';
import type { ReputationFilters } from '../../lib/reputation/filters';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * Single-call dashboard guarantee (Ajuste Extra).
 *
 * The /reputation page makes exactly one call to
 * `loadReputationDashboardData`. The loader then dispatches to each
 * underlying query *exactly once* (or twice for `overview` — current
 * + previous windows). This test pins that contract: a future
 * refactor that adds a "fetch from inside a component" hidden round-
 * trip breaks the assertion.
 *
 * The production loader opens its own `dbAs` transaction; that path
 * goes through `getRawDb()` which refuses test runs by design (see
 * `lib/db/client.ts`). For testing the call-shape we use the sibling
 * `loadReputationDashboardDataWithTx` which accepts an existing tx —
 * exact same body, just no `dbAs` envelope. The spy contract is
 * identical.
 */

let fixture: TestDb;

const planId = '00000000-0000-4000-8000-dd000000d001';
const orgA = '11111111-1111-4111-8111-dd000000d001';
const userA = '22222222-2222-4222-8222-dd000000d001';
const brandA = '33333333-3333-4333-8333-dd000000d001';
const locationA = '44444444-4444-4444-8444-dd000000d001';

const NOW = new Date('2026-05-15T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

beforeAll(async () => {
  fixture = await createTestDb();
  await runAdmin(fixture.db, async (tx) => {
    await tx.insert(plans).values({
      id: planId,
      code: 'enterprise',
      name: 'Enterprise',
      priceCents: 109900,
    });
    await tx.insert(users).values({ id: userA, email: 'a@ldr.test', name: 'A' });
    await tx
      .insert(organizations)
      .values({ id: orgA, name: 'Org A', slug: 'ldr-org-a', planId });
    await tx
      .insert(brands)
      .values({ id: brandA, organizationId: orgA, name: 'Trattoria', slug: 'trattoria' });
    await tx
      .insert(locations)
      .values({ id: locationA, organizationId: orgA, brandId: brandA, name: 'Downtown' });
    for (let i = 0; i < 3; i++) {
      await tx.insert(reviews).values({
        id: `55555555-5555-4555-8555-dd000000d${i}00`,
        organizationId: orgA,
        brandId: brandA,
        locationId: locationA,
        platform: 'gbp',
        externalReviewId: `gbp-ldr-${i}`,
        rating: 4,
        body: 'Bueno.',
        sentiment: 'positive',
        status: 'pending',
        postedAt: new Date(NOW.getTime() - (i + 1) * DAY),
        tags: [],
      });
    }
  });
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
});

function filters(): ReputationFilters {
  return {
    dateFrom: new Date(NOW.getTime() - 30 * DAY),
    dateTo: NOW,
    windowDays: 30,
    preset: 30,
  };
}

describe('loadReputationDashboardDataWithTx — single-pass contract', () => {
  it('calls every per-card query exactly once (overview twice for current+previous)', async () => {
    const spies: DashboardQueryDeps = {
      overview: vi.fn(defaultDashboardQueryDeps.overview),
      stars: vi.fn(defaultDashboardQueryDeps.stars),
      sentiment: vi.fn(defaultDashboardQueryDeps.sentiment),
      trend: vi.fn(defaultDashboardQueryDeps.trend),
      topTags: vi.fn(defaultDashboardQueryDeps.topTags),
      responseTime: vi.fn(defaultDashboardQueryDeps.responseTime),
      crisisCounts: vi.fn(defaultDashboardQueryDeps.crisisCounts),
    };

    const data = await runAs(fixture.db, { orgId: orgA, userId: userA }, async (tx) =>
      loadReputationDashboardDataWithTx(tx, {
        orgId: orgA,
        filters: filters(),
        now: NOW,
        deps: spies,
      }),
    );

    expect(spies.overview).toHaveBeenCalledTimes(2);
    expect(spies.stars).toHaveBeenCalledTimes(1);
    expect(spies.sentiment).toHaveBeenCalledTimes(1);
    expect(spies.trend).toHaveBeenCalledTimes(1);
    expect(spies.topTags).toHaveBeenCalledTimes(1);
    expect(spies.responseTime).toHaveBeenCalledTimes(1);
    expect(spies.crisisCounts).toHaveBeenCalledTimes(1);

    // Sanity: the returned shape carries every section so a future
    // refactor that removes a card forces the test to be updated.
    expect(data.current.reviewCount).toBe(3);
    expect(data.stars.total).toBe(3);
    expect(data.sentiment.total).toBe(3);
    expect(data.topTags).toBeDefined();
    expect(data.responseTime.responseSampleSize).toBe(0);
    expect(data.crisis.triggered).toBe(false);
  });
});
