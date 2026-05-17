import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runAdmin, runAs } from '../../lib/db/client';
import {
  adsAccounts,
  adsAlerts,
  adsSpendDaily,
  brands,
  organizations,
  plans,
  users,
} from '../../lib/db/schema';
import { listAdsAlertsWithTx } from '../../lib/ads/alerts-queries';
import {
  getAdsAccountDetailWithTx,
  listAdsAccountDailyWithTx,
} from '../../lib/ads/queries';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * /ads/[adsAccountId] drill-down integration (Phase 8 / Commit 30).
 *
 *   1. detail returns the row + brand_name JOIN.
 *   2. daily rollup groups by date (NOT by campaign_id).
 *   3. alerts list filtered by adsAccountId returns only that
 *      account's rows.
 *   4. Tenant isolation: org B can't fetch org A's detail.
 */

let fixture: TestDb;

const planId = '00000000-0000-4000-8000-c3010c3010c0';
const orgA = '11111111-1111-4111-8111-c3010c3010c0';
const orgB = '11111111-1111-4111-8111-c3010c3010c1';
const userA = '22222222-2222-4222-8222-c3010c3010c0';
const userB = '22222222-2222-4222-8222-c3010c3010c1';
const brandA = '44444444-4444-4444-8444-c3010c3010c0';
const accA = '33333333-3333-4333-8333-c3010c3010c0';
const accOther = '33333333-3333-4333-8333-c3010c3010c1';
const accOrgB = '33333333-3333-4333-8333-c3010c3010c2';

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
      { id: userA, email: 'a@c30.test', name: 'A' },
      { id: userB, email: 'b@c30.test', name: 'B' },
    ]);
    await tx.insert(organizations).values([
      { id: orgA, name: 'Org A', slug: 'c30-org-a', planId },
      { id: orgB, name: 'Org B', slug: 'c30-org-b', planId },
    ]);
    await tx.insert(brands).values({
      id: brandA,
      organizationId: orgA,
      name: 'Brand A',
      slug: 'brand-a',
    });
    await tx.insert(adsAccounts).values([
      {
        id: accA,
        organizationId: orgA,
        brandId: brandA,
        platform: 'google',
        externalAccountId: 'a-1',
        accountName: 'Account A',
        currency: 'USD',
        status: 'connected',
      },
      {
        id: accOther,
        organizationId: orgA,
        platform: 'meta',
        externalAccountId: 'a-2',
        accountName: 'Other A',
        currency: 'USD',
        status: 'connected',
      },
      {
        id: accOrgB,
        organizationId: orgB,
        platform: 'google',
        externalAccountId: 'b-1',
        currency: 'USD',
        status: 'connected',
      },
    ]);

    // accA daily rows on 3 distinct dates, with TWO campaigns per
    // date so the rollup proves it sums across campaigns.
    const rows = [];
    for (let i = 1; i <= 3; i += 1) {
      for (const c of ['c1', 'c2']) {
        rows.push({
          organizationId: orgA,
          adsAccountId: accA,
          platformCampaignId: c,
          date: isoDate(i),
          impressions: 1_000,
          clicks: 30,
          spendCents: 5000,
          spendUsdCents: 5000,
          currency: 'USD',
        });
      }
    }
    await tx.insert(adsSpendDaily).values(rows);

    // accA alerts: one pending + one accepted.
    await tx.insert(adsAlerts).values([
      {
        organizationId: orgA,
        adsAccountId: accA,
        kind: 'ctr_drop',
        severity: 'medium',
        title: 'CTR drop',
        body: 'b',
        evidence: {},
        status: 'pending',
      },
      {
        organizationId: orgA,
        adsAccountId: accA,
        kind: 'spend_spike',
        severity: 'high',
        title: 'Spike',
        body: 'b',
        evidence: {},
        status: 'accepted',
      },
      // accOther — should NOT appear in accA's filtered list.
      {
        organizationId: orgA,
        adsAccountId: accOther,
        kind: 'ctr_drop',
        severity: 'low',
        title: 'Other',
        body: 'b',
        evidence: {},
        status: 'pending',
      },
    ]);
  });
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
});

describe('getAdsAccountDetailWithTx', () => {
  it('returns the row with brand_name JOIN', async () => {
    const detail = await runAs(
      fixture.db,
      { orgId: orgA, userId: userA },
      (tx) => getAdsAccountDetailWithTx(tx, orgA, accA),
    );
    expect(detail).not.toBeNull();
    expect(detail!.id).toBe(accA);
    expect(detail!.brandName).toBe('Brand A');
    expect(detail!.currency).toBe('USD');
  });

  it('returns null when org does not own the account (RLS)', async () => {
    const detail = await runAs(
      fixture.db,
      { orgId: orgB, userId: userB },
      (tx) => getAdsAccountDetailWithTx(tx, orgB, accA),
    );
    expect(detail).toBeNull();
  });
});

describe('listAdsAccountDailyWithTx', () => {
  it('groups by date — one row per (date, currency), not per campaign', async () => {
    const rows = await runAs(
      fixture.db,
      { orgId: orgA, userId: userA },
      (tx) => listAdsAccountDailyWithTx(tx, orgA, accA),
    );
    expect(rows).toHaveLength(3);
    // Each date has 2 campaigns × 1000 imps = 2000 imps total.
    for (const r of rows) {
      expect(r.impressions).toBe(2000);
      expect(r.clicks).toBe(60);
      expect(r.spendUsdCents).toBe(10_000);
    }
    // Sorted DESC.
    const dates = rows.map((r) => r.date);
    expect([...dates].sort().reverse()).toEqual(dates);
  });
});

describe('listAdsAlertsWithTx — adsAccountId filter', () => {
  it('returns only that account\'s alerts, sorted by severity then age', async () => {
    const alerts = await runAs(
      fixture.db,
      { orgId: orgA, userId: userA },
      (tx) =>
        listAdsAlertsWithTx(tx, {
          orgId: orgA,
          userId: userA,
          adsAccountId: accA,
          limit: 100,
        }),
    );
    expect(alerts).toHaveLength(2);
    for (const a of alerts) {
      expect(a.adsAccountId).toBe(accA);
    }
    // sortBySeverityThenAge: 'high' before 'medium'.
    expect(alerts[0]!.severity).toBe('high');
    expect(alerts[1]!.severity).toBe('medium');
  });
});

describe('Breadcrumbs aria-label', () => {
  it('Breadcrumbs renders nav with aria-label="breadcrumb"', async () => {
    const { renderToString } = await import('react-dom/server');
    const { Breadcrumbs } = await import('@/components/ui/breadcrumbs');
    const html = renderToString(
      Breadcrumbs({
        items: [{ label: 'Ads', href: '/ads' }, { label: 'Account A' }],
      }),
    );
    expect(html).toContain('aria-label="breadcrumb"');
    expect(html).toContain('href="/ads"');
    expect(html).toContain('aria-current="page"');
  });
});
