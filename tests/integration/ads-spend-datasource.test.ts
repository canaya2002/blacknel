import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adsSpendSource } from '../../lib/custom-reports/data-sources/ads-spend';
import type { DataSourceContext } from '../../lib/custom-reports/data-sources/index';
import { type AnyPgTx, runAdmin, runAs } from '../../lib/db/client';
import { adsAccounts, adsSpendDaily, organizations, plans, users } from '../../lib/db/schema';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * C51 — the `ads_spend` custom-report data source executed against pglite. Proves
 * the pre-existing `day`→`date` column bug is fixed (the query would throw
 * "column day does not exist" before) AND that the newly-wired `conversions`
 * metric reads correctly. Raw-SQL data sources weren't exercised before, so this
 * is the first test that actually runs the query.
 */

let fixture: TestDb;
const planId = '00000000-0000-4000-8000-c51d50000001';
const orgA = '11111111-1111-4111-8111-c51d50000001';
const userA = '22222222-2222-4222-8222-c51d50000001';
const acct = '33333333-3333-4333-8333-c51d50000001';

beforeAll(async () => {
  fixture = await createTestDb();
  await runAdmin(fixture.db, async (tx) => {
    await tx.insert(plans).values({ id: planId, code: 'enterprise', name: 'Enterprise', priceCents: 109900 });
    await tx.insert(users).values({ id: userA, email: 'a@c51d.test', name: 'A' });
    await tx.insert(organizations).values({ id: orgA, name: 'Org A', slug: 'c51d-org-a', planId });
    await tx.insert(adsAccounts).values({
      id: acct,
      organizationId: orgA,
      platform: 'google',
      externalAccountId: '111',
      currency: 'USD',
      status: 'connected',
    });
    await tx.insert(adsSpendDaily).values([
      { organizationId: orgA, adsAccountId: acct, platformCampaignId: 'c1', date: '2026-05-10', impressions: 100, clicks: 10, spendCents: 1000, spendUsdCents: 1000, conversions: 5, currency: 'USD' },
      { organizationId: orgA, adsAccountId: acct, platformCampaignId: 'c1', date: '2026-05-11', impressions: 200, clicks: 20, spendCents: 2000, spendUsdCents: 2000, conversions: 3, currency: 'USD' },
    ]);
  });
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
});

function ctxWith(tx: AnyPgTx): DataSourceContext {
  return {
    tx,
    orgId: orgA,
    userId: userA,
    rangeStart: new Date('2026-05-01T00:00:00Z'),
    rangeEnd: new Date('2026-05-31T00:00:00Z'),
    brandId: null,
  };
}

describe('ads_spend data source (date column + conversions)', () => {
  it('loadScalar spend_usd sums spend_usd_cents → dollars (no "day" column error)', async () => {
    const r = await runAs(fixture.db, { orgId: orgA, userId: userA }, (tx) =>
      adsSpendSource.loadScalar!('spend_usd', ctxWith(tx)),
    );
    expect(r.value).toBe(30); // (1000 + 2000) cents → $30
  });

  it('loadScalar conversions sums the new column', async () => {
    const r = await runAs(fixture.db, { orgId: orgA, userId: userA }, (tx) =>
      adsSpendSource.loadScalar!('conversions', ctxWith(tx)),
    );
    expect(r.value).toBe(8);
  });

  it('loadTimeseries spend_usd buckets by date ascending', async () => {
    const r = await runAs(fixture.db, { orgId: orgA, userId: userA }, (tx) =>
      adsSpendSource.loadTimeseries!('spend_usd', ctxWith(tx)),
    );
    expect(r).toEqual([
      { t: '2026-05-10', v: 10 },
      { t: '2026-05-11', v: 20 },
    ]);
  });

  it('loadTimeseries conversions buckets by date', async () => {
    const r = await runAs(fixture.db, { orgId: orgA, userId: userA }, (tx) =>
      adsSpendSource.loadTimeseries!('conversions', ctxWith(tx)),
    );
    expect(r).toEqual([
      { t: '2026-05-10', v: 5 },
      { t: '2026-05-11', v: 3 },
    ]);
  });

  it('declares conversions in its capabilities', () => {
    expect(adsSpendSource.capabilities.scalar).toContain('conversions');
    expect(adsSpendSource.capabilities.timeseries).toContain('conversions');
  });
});
