import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getOrgBranding } from '../../lib/branding/org-branding';
import { adsSpendSource } from '../../lib/custom-reports/data-sources/ads-spend';
import type { DataSourceContext } from '../../lib/custom-reports/data-sources/index';
import { postInsightsSource } from '../../lib/custom-reports/data-sources/post-insights';
import { reviewsAggregatesSource } from '../../lib/custom-reports/data-sources/reviews-aggregates';
import { type AnyPgTx, runAdmin, runAs } from '../../lib/db/client';
import {
  adsAccounts,
  adsSpendDaily,
  connectedAccounts,
  organizations,
  plans,
  postInsights,
  postTargets,
  posts,
  reviews,
  users,
} from '../../lib/db/schema';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * C52 analytics data sources executed against pglite: the new ads CTR/CPC, the
 * reviews response_rate, the real post_insights source, and the org-branding
 * resolver. All org-scoped via the caller's RLS tx.
 */

let fixture: TestDb;
const planId = '00000000-0000-4000-8000-c52d00000001';
const orgA = '11111111-1111-4111-8111-c52d00000001';
const userA = '22222222-2222-4222-8222-c52d00000001';
const acct = '33333333-3333-4333-8333-c52d00000001';
const conn = '33333333-3333-4333-8333-c52d000000c1';
const postA = '44444444-4444-4444-8444-c52d00000001';
const tgt = '55555555-5555-4555-8555-c52d00000001';

const RANGE_START = new Date('2026-05-01T00:00:00Z');
const RANGE_END = new Date('2026-05-31T00:00:00Z');

beforeAll(async () => {
  fixture = await createTestDb();
  await runAdmin(fixture.db, async (tx) => {
    await tx.insert(plans).values({ id: planId, code: 'enterprise', name: 'Enterprise', priceCents: 109900 });
    await tx.insert(users).values({ id: userA, email: 'a@c52d.test', name: 'A' });
    await tx.insert(organizations).values({
      id: orgA,
      name: 'Org A',
      slug: 'c52d-org-a',
      planId,
      displayName: 'Brandy Co',
      primaryColor: '#abcdef',
      locale: 'es',
    });
    await tx.insert(adsAccounts).values({
      id: acct,
      organizationId: orgA,
      platform: 'meta',
      externalAccountId: 'act1',
      currency: 'USD',
      status: 'connected',
    });
    await tx.insert(adsSpendDaily).values([
      { organizationId: orgA, adsAccountId: acct, platformCampaignId: 'c1', date: '2026-05-10', impressions: 1000, clicks: 50, spendCents: 5049, spendUsdCents: 5049, conversions: 4, currency: 'USD' },
      { organizationId: orgA, adsAccountId: acct, platformCampaignId: 'c2', date: '2026-05-11', impressions: 1000, clicks: 50, spendCents: 5000, spendUsdCents: 5000, conversions: 6, currency: 'USD' },
    ]);
    await tx.insert(reviews).values([
      { organizationId: orgA, platform: 'gbp', rating: 5, body: 'a', status: 'responded', postedAt: new Date('2026-05-05') },
      { organizationId: orgA, platform: 'gbp', rating: 4, body: 'b', status: 'responded', postedAt: new Date('2026-05-06') },
      { organizationId: orgA, platform: 'gbp', rating: 3, body: 'c', status: 'pending', postedAt: new Date('2026-05-07') },
      { organizationId: orgA, platform: 'gbp', rating: 2, body: 'd', status: 'pending', postedAt: new Date('2026-05-08') },
    ]);
    await tx.insert(connectedAccounts).values({ id: conn, organizationId: orgA, platform: 'facebook', externalAccountId: 'pg', status: 'connected' });
    await tx.insert(posts).values({ id: postA, organizationId: orgA, authorId: userA, status: 'published', text: 'p' });
    await tx.insert(postTargets).values({ id: tgt, organizationId: orgA, postId: postA, connectedAccountId: conn, status: 'published', externalPostId: 'x', publishedAt: new Date('2026-05-10') });
    await tx.insert(postInsights).values([
      { organizationId: orgA, postTargetId: tgt, platform: 'facebook', externalPostId: 'x', reach: 300, impressions: 500, likes: 20, comments: 8, shares: 2, engagement: 30, postedAt: new Date('2026-05-10') },
    ]);
  });
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
});

function ctx(tx: AnyPgTx): DataSourceContext {
  return { tx, orgId: orgA, userId: userA, rangeStart: RANGE_START, rangeEnd: RANGE_END, brandId: null };
}

describe('ads_spend CTR/CPC + spend precision', () => {
  it('CTR = clicks/impressions %; CPC = $/click', async () => {
    const [ctr, cpc] = await runAs(fixture.db, { orgId: orgA, userId: userA }, async (tx) => [
      await adsSpendSource.loadScalar!('ctr', ctx(tx)),
      await adsSpendSource.loadScalar!('cpc', ctx(tx)),
    ]);
    // totals: impressions 2000, clicks 100 → CTR 5%, CPC ≈$1.
    expect(ctr.value).toBe(5);
    expect(cpc.value).toBe(1);
  });

  it('spend_usd preserves cents (10049¢ → 100.49, not 100)', async () => {
    const r = await runAs(fixture.db, { orgId: orgA, userId: userA }, (tx) =>
      adsSpendSource.loadScalar!('spend_usd', ctx(tx)),
    );
    expect(r.value).toBe(100.49);
  });
});

describe('reviews_aggregates response_rate', () => {
  it('% of reviews responded to', async () => {
    const r = await runAs(fixture.db, { orgId: orgA, userId: userA }, (tx) =>
      reviewsAggregatesSource.loadScalar!('response_rate', ctx(tx)),
    );
    expect(r.value).toBe(50); // 2 responded / 4 total
  });
});

describe('post_insights source', () => {
  it('aggregates reach + engagement from the real table', async () => {
    const { reach, engagement, ts } = await runAs(fixture.db, { orgId: orgA, userId: userA }, async (tx) => ({
      reach: await postInsightsSource.loadScalar!('total_reach', ctx(tx)),
      engagement: await postInsightsSource.loadScalar!('total_engagement', ctx(tx)),
      ts: await postInsightsSource.loadTimeseries!('engagement', ctx(tx)),
    }));
    expect(reach.value).toBe(300);
    expect(engagement.value).toBe(30);
    expect(ts).toEqual([{ t: '2026-05-10', v: 30 }]);
  });
});

describe('getOrgBranding', () => {
  it('reads set branding + applies the locale', async () => {
    const b = await runAs(fixture.db, { orgId: orgA, userId: userA }, (tx) => getOrgBranding(tx, orgA));
    expect(b.displayName).toBe('Brandy Co');
    expect(b.primaryColor).toBe('#abcdef');
    expect(b.locale).toBe('es');
  });
});
