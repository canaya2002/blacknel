import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runAdmin, runAs } from '../../lib/db/client';
import {
  adsAccounts,
  adsSpendDaily,
  brands,
  organizations,
  plans,
  users,
} from '../../lib/db/schema';
import {
  getAdsOverviewWithTx,
  listAdsAccountsWithTx,
} from '../../lib/ads/queries';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * /ads read-layer integration (Commit 28).
 *
 *   1. Empty org → empty lists + zero overview.
 *   2. Seeded data → overview totals = SUM(spend_usd_cents) ;
 *      list rows carry the 30d rollup per account.
 *   3. Rows older than 30d are excluded from the rollup but the
 *      account itself still shows up (so disconnected/stale
 *      accounts remain visible for re-connect).
 *   4. Tenant isolation: orgB never sees orgA's accounts.
 */

let fixture: TestDb;

const planId = '00000000-0000-4000-8000-c2810c2810c0';
const orgA = '11111111-1111-4111-8111-c2810c2810c0';
const orgB = '11111111-1111-4111-8111-c2810c2810c1';
const userA = '22222222-2222-4222-8222-c2810c2810c0';
const userB = '22222222-2222-4222-8222-c2810c2810c1';
const brandA = '44444444-4444-4444-8444-c2810c2810c0';
const accA1 = '55555555-5555-4555-8555-c2810c2810c0';
const accA2 = '55555555-5555-4555-8555-c2810c2810c1';
const accB1 = '55555555-5555-4555-8555-c2810c2810c2';

const NOW = new Date('2026-05-17T12:00:00Z');
const dayMs = 86_400_000;

function isoDate(offsetDays: number): string {
  return new Date(NOW.getTime() - offsetDays * dayMs)
    .toISOString()
    .slice(0, 10);
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
    await tx.insert(users).values([
      { id: userA, email: 'a@c28q.test', name: 'A' },
      { id: userB, email: 'b@c28q.test', name: 'B' },
    ]);
    await tx.insert(organizations).values([
      { id: orgA, name: 'Org A', slug: 'c28q-org-a', planId },
      { id: orgB, name: 'Org B', slug: 'c28q-org-b', planId },
    ]);
    await tx.insert(brands).values({
      id: brandA,
      organizationId: orgA,
      name: 'Brand A',
      slug: 'brand-a',
    });
  });
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
});

describe('getAdsOverview / listAdsAccounts — Commit 28', () => {
  it('empty org returns empty list + zero overview', async () => {
    const empty = await runAs(
      fixture.db,
      { orgId: orgA, userId: userA },
      (tx) => listAdsAccountsWithTx(tx, orgA),
    );
    expect(empty).toEqual([]);
    const overview = await runAs(
      fixture.db,
      { orgId: orgA, userId: userA },
      (tx) => getAdsOverviewWithTx(tx, orgA),
    );
    expect(overview).toEqual({
      accountsConnected: 0,
      spendUsdCents30d: 0,
      impressions30d: 0,
      clicks30d: 0,
      lastSyncAt: null,
    });
  });

  it('seeded accounts + spend → list and overview reflect the math', async () => {
    await runAdmin(fixture.db, async (tx) => {
      await tx.insert(adsAccounts).values([
        {
          id: accA1,
          organizationId: orgA,
          brandId: brandA,
          platform: 'google',
          externalAccountId: 'g-a-1',
          accountName: 'A1',
          currency: 'USD',
          status: 'connected',
          lastSyncAt: NOW,
        },
        {
          id: accA2,
          organizationId: orgA,
          platform: 'meta',
          externalAccountId: 'm-a-2',
          accountName: 'A2',
          currency: 'USD',
          status: 'disconnected',
          lastSyncAt: new Date(NOW.getTime() - 10 * dayMs),
        },
        {
          id: accB1,
          organizationId: orgB,
          platform: 'google',
          externalAccountId: 'g-b-1',
          accountName: 'B1',
          currency: 'USD',
          status: 'connected',
        },
      ]);

      // Org A · acc A1 (connected): 3 days within 30d window.
      await tx.insert(adsSpendDaily).values([
        {
          organizationId: orgA,
          adsAccountId: accA1,
          platformCampaignId: 'c1',
          date: isoDate(1),
          impressions: 10_000,
          clicks: 100,
          spendCents: 5000,
          spendUsdCents: 5000,
          currency: 'USD',
        },
        {
          organizationId: orgA,
          adsAccountId: accA1,
          platformCampaignId: 'c1',
          date: isoDate(2),
          impressions: 12_000,
          clicks: 120,
          spendCents: 6000,
          spendUsdCents: 6000,
          currency: 'USD',
        },
        {
          organizationId: orgA,
          adsAccountId: accA1,
          platformCampaignId: 'c2',
          date: isoDate(3),
          impressions: 8_000,
          clicks: 80,
          spendCents: 4000,
          spendUsdCents: 4000,
          currency: 'USD',
        },
        // Outside 30d window — should NOT count toward overview.
        {
          organizationId: orgA,
          adsAccountId: accA1,
          platformCampaignId: 'c1',
          date: isoDate(40),
          impressions: 100_000,
          clicks: 100,
          spendCents: 90_000,
          spendUsdCents: 90_000,
          currency: 'USD',
        },
        // Org B row — must not leak.
        {
          organizationId: orgB,
          adsAccountId: accB1,
          platformCampaignId: 'c1',
          date: isoDate(1),
          impressions: 1_000,
          clicks: 10,
          spendCents: 99_999,
          spendUsdCents: 99_999,
          currency: 'USD',
        },
      ]);
    });

    const overview = await runAs(
      fixture.db,
      { orgId: orgA, userId: userA },
      (tx) => getAdsOverviewWithTx(tx, orgA),
    );
    expect(overview.accountsConnected).toBe(1); // A1 only; A2 is disconnected
    expect(overview.spendUsdCents30d).toBe(15_000); // 5000+6000+4000
    expect(overview.impressions30d).toBe(30_000);
    expect(overview.clicks30d).toBe(300);
    expect(overview.lastSyncAt).not.toBeNull();

    const list = await runAs(
      fixture.db,
      { orgId: orgA, userId: userA },
      (tx) => listAdsAccountsWithTx(tx, orgA),
    );
    expect(list).toHaveLength(2);
    const a1 = list.find((r) => r.id === accA1)!;
    const a2 = list.find((r) => r.id === accA2)!;
    expect(a1.spendUsdCents30d).toBe(15_000);
    expect(a1.brandName).toBe('Brand A');
    expect(a2.spendUsdCents30d).toBe(0);
    expect(a2.status).toBe('disconnected');
    expect(a2.brandName).toBeNull();
  });

  it('tenant isolation under RLS: Org B sees only its own account', async () => {
    const list = await runAs(
      fixture.db,
      { orgId: orgB, userId: userB },
      (tx) => listAdsAccountsWithTx(tx, orgB),
    );
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(accB1);
  });
});
