import { describe, expect, it } from 'vitest';

import {
  enumerateDates,
  fnv1a32,
  mulberry32,
} from '../../lib/ads-connectors/base';
import { googleMockConnector } from '../../lib/ads-connectors/google-mock';
import { metaMockConnector } from '../../lib/ads-connectors/meta-mock';
import { getAdsConnector } from '../../lib/ads-connectors';

const account = {
  adsAccountId: '00000000-0000-4000-8000-000000000001',
  externalAccountId: '123-456-7890',
  currency: 'USD',
};

const range = { from: '2026-05-15', to: '2026-05-16' };

describe('ads connectors — Commit 28 / Ajuste 2 (determinism)', () => {
  it('google-mock returns 3 campaigns × N dates rows', async () => {
    const rows = await googleMockConnector.fetchDailySpend(account, range);
    // 2 dates × 3 campaigns
    expect(rows).toHaveLength(6);
    // Two distinct dates
    expect(new Set(rows.map((r) => r.date))).toEqual(
      new Set(['2026-05-15', '2026-05-16']),
    );
    // Three distinct campaign ids per platform
    expect(new Set(rows.map((r) => r.platformCampaignId)).size).toBe(3);
  });

  it('meta-mock returns 2 campaigns × N dates rows', async () => {
    const rows = await metaMockConnector.fetchDailySpend(account, range);
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map((r) => r.platformCampaignId)).size).toBe(2);
  });

  it('re-running the same call yields byte-identical rows', async () => {
    const a = await googleMockConnector.fetchDailySpend(account, range);
    const b = await googleMockConnector.fetchDailySpend(account, range);
    expect(b).toEqual(a);
  });

  it('rows are within Ajuste-2 envelopes (spend $20–$200, CTR 1–3%)', async () => {
    const rows = await googleMockConnector.fetchDailySpend(account, range);
    for (const r of rows) {
      expect(r.spendCents).toBeGreaterThanOrEqual(2000);
      expect(r.spendCents).toBeLessThanOrEqual(20000);
      expect(r.impressions).toBeGreaterThanOrEqual(5000);
      expect(r.impressions).toBeLessThanOrEqual(25000);
      const ctr = r.clicks / r.impressions;
      expect(ctr).toBeGreaterThanOrEqual(0.005); // ~1% with rounding slack
      expect(ctr).toBeLessThanOrEqual(0.035); // ~3% with rounding slack
    }
  });

  it('google + meta seeds are disjoint for the same external account', async () => {
    const g = await googleMockConnector.fetchDailySpend(account, range);
    const m = await metaMockConnector.fetchDailySpend(account, range);
    // The campaign ids must not collide
    const gIds = new Set(g.map((r) => r.platformCampaignId));
    const mIds = new Set(m.map((r) => r.platformCampaignId));
    for (const id of mIds) {
      expect(gIds.has(id)).toBe(false);
    }
  });

  it('getAdsConnector returns the right impl per platform', () => {
    expect(getAdsConnector('google').platform).toBe('google');
    expect(getAdsConnector('meta').platform).toBe('meta');
  });

  it('enumerateDates inclusive on both ends; throws on inverted', () => {
    expect(enumerateDates({ from: '2026-05-15', to: '2026-05-15' })).toEqual([
      '2026-05-15',
    ]);
    expect(
      enumerateDates({ from: '2026-05-15', to: '2026-05-17' }),
    ).toEqual(['2026-05-15', '2026-05-16', '2026-05-17']);
    expect(() =>
      enumerateDates({ from: '2026-05-17', to: '2026-05-15' }),
    ).toThrow();
  });

  it('fnv1a32 is deterministic and mulberry32 yields stable sequences', () => {
    const h = fnv1a32('seed-abc');
    expect(h).toBe(fnv1a32('seed-abc'));
    const r1 = mulberry32(42);
    const r2 = mulberry32(42);
    const first1 = [r1(), r1(), r1()];
    const first2 = [r2(), r2(), r2()];
    expect(first1).toEqual(first2);
  });
});
