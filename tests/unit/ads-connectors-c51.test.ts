import { afterEach, describe, expect, it } from 'vitest';

import { _setAdsFetchForTests } from '../../lib/ads-connectors/ads-http';
import { isRealAdsEnabled, resolveAdsConnector } from '../../lib/ads-connectors/dispatch';
import { googleMockConnector } from '../../lib/ads-connectors/google-mock';
import { googleRealConnector } from '../../lib/ads-connectors/google-real';
import { tiktokMockConnector } from '../../lib/ads-connectors/tiktok-mock';
import { tiktokRealConnector } from '../../lib/ads-connectors/tiktok-real';
import { _resetFlagReaderForTests, _setFlagReaderForTests } from '../../lib/flags';

/**
 * C51 Google + TikTok ads adapters. TikTok mock determinism; the real Google Ads
 * (GAQL/REST) + TikTok Marketing API mappings via the ads-http fetch seam (zero
 * network); dispatch gating for the two new platforms.
 */

const range = { from: '2026-05-19', to: '2026-05-20' };
const account = {
  adsAccountId: '00000000-0000-4000-8000-000000000001',
  externalAccountId: '123456',
  currency: 'USD',
  accessToken: 'tok-xyz',
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('tiktok mock connector', () => {
  it('is deterministic + carries conversions; structure tree is coherent', async () => {
    const a = await tiktokMockConnector.fetchDailySpend(account, range);
    const b = await tiktokMockConnector.fetchDailySpend(account, range);
    expect(a).toEqual(b);
    for (const r of a) expect(r.conversions).toBeGreaterThanOrEqual(0);

    const accts = await tiktokMockConnector.listAdAccounts({ accessToken: 'tok-abcdef' });
    expect(accts[0]?.externalAccountId).toContain('t-acct-');
    const s = await tiktokMockConnector.syncStructure(account);
    expect(s.campaigns).toHaveLength(2);
    expect(s.campaigns[0]?.externalId).toBe(`t-${account.externalAccountId}-c0`);
  });
});

describe('google-real adapter (GAQL via ads-http seam)', () => {
  afterEach(() => _setAdsFetchForTests(null));

  it('listAdAccounts maps resourceNames → customer ids', async () => {
    _setAdsFetchForTests(async () =>
      jsonResponse({ resourceNames: ['customers/111', 'customers/222'] }),
    );
    const accts = await googleRealConnector.listAdAccounts({ accessToken: 'tok' });
    expect(accts.map((a) => a.externalAccountId)).toEqual(['111', '222']);
    expect(accts[0]?.status).toBe('connected');
  });

  it('syncStructure maps campaigns/ad_groups/ads with micros→cents + parent links', async () => {
    _setAdsFetchForTests(async (_input, init) => {
      const query = JSON.parse((init?.body as string) ?? '{}').query as string;
      if (query.includes('FROM ad_group_ad')) {
        return jsonResponse({
          results: [{ adGroupAd: { ad: { id: 'a1', name: 'Ad1' }, status: 'ENABLED', adGroup: 'customers/123456/adGroups/s1' } }],
        });
      }
      if (query.includes('FROM ad_group')) {
        return jsonResponse({
          results: [{ adGroup: { id: 's1', name: 'AG1', status: 'PAUSED', campaign: 'customers/123456/campaigns/c1' } }],
        });
      }
      return jsonResponse({
        results: [
          {
            campaign: { id: 'c1', name: 'C1', status: 'ENABLED', advertisingChannelType: 'SEARCH' },
            campaignBudget: { amountMicros: '50000000' },
          },
        ],
      });
    });
    const s = await googleRealConnector.syncStructure(account);
    expect(s.campaigns[0]).toMatchObject({
      externalId: 'c1',
      status: 'active',
      dailyBudgetCents: 5000, // 50_000_000 micros / 10_000
    });
    expect(s.adSets[0]).toMatchObject({ externalId: 's1', status: 'paused', campaignExternalId: 'c1' });
    // Ad externalId is the COMPOSITE {adGroupId}~{adId} Google's mutate needs.
    expect(s.ads[0]).toMatchObject({ externalId: 's1~a1', adSetExternalId: 's1' });
  });

  it('fetchDailySpend maps cost_micros→cents + conversions', async () => {
    _setAdsFetchForTests(async () =>
      jsonResponse({
        results: [
          {
            campaign: { id: 'c1' },
            metrics: { impressions: '1000', clicks: '50', costMicros: '12340000', conversions: 3 },
            segments: { date: '2026-05-19' },
          },
        ],
      }),
    );
    const rows = await googleRealConnector.fetchDailySpend(account, range);
    expect(rows).toEqual([
      { platformCampaignId: 'c1', date: '2026-05-19', impressions: 1000, clicks: 50, spendCents: 1234, conversions: 3 },
    ]);
  });

  it('applyAction pause POSTs a status mutate; throws without a token', async () => {
    const seen: Array<{ url: string; body: string | null }> = [];
    _setAdsFetchForTests(async (input, init) => {
      seen.push({ url: String(input), body: (init?.body as string) ?? null });
      return jsonResponse({ results: [{}] });
    });
    const r = await googleRealConnector.applyAction(account, { level: 'campaign', externalId: 'c1', action: 'pause' });
    expect(r.status).toBe('paused');
    expect(seen[0]?.url).toContain('/campaigns:mutate');
    expect(seen[0]?.body).toContain('PAUSED');

    // Ad-level action targets the composite adGroupAds resource name verbatim.
    await googleRealConnector.applyAction(account, { level: 'ad', externalId: 's1~a1', action: 'resume' });
    expect(seen[1]?.url).toContain('/adGroupAds:mutate');
    expect(seen[1]?.body).toContain('adGroupAds/s1~a1');

    await expect(
      googleRealConnector.applyAction({ ...account, accessToken: undefined }, { level: 'campaign', externalId: 'c1', action: 'pause' }),
    ).rejects.toThrow();
  });
});

describe('tiktok-real adapter (Marketing API via ads-http seam)', () => {
  afterEach(() => _setAdsFetchForTests(null));

  it('listAdAccounts unwraps the {code,data} envelope', async () => {
    _setAdsFetchForTests(async () =>
      jsonResponse({ code: 0, data: { list: [{ advertiser_id: '900', advertiser_name: 'Acme', currency: 'EUR' }] } }),
    );
    const accts = await tiktokRealConnector.listAdAccounts({ accessToken: 'tok' });
    expect(accts).toEqual([{ externalAccountId: '900', name: 'Acme', currency: 'EUR', status: 'connected' }]);
  });

  it('throws on a non-zero envelope code', async () => {
    _setAdsFetchForTests(async () => jsonResponse({ code: 40001, message: 'bad token', data: {} }));
    await expect(tiktokRealConnector.listAdAccounts({ accessToken: 'tok' })).rejects.toThrow(/40001/);
  });

  it('fetchDailySpend maps report dimensions/metrics → spend cents + conversions', async () => {
    _setAdsFetchForTests(async () =>
      jsonResponse({
        code: 0,
        data: {
          list: [
            {
              dimensions: { campaign_id: 'c9', stat_time_day: '2026-05-19 00:00:00' },
              metrics: { spend: '12.34', impressions: '1000', clicks: '40', conversion: '5' },
            },
          ],
          page_info: { total_page: 1 },
        },
      }),
    );
    const rows = await tiktokRealConnector.fetchDailySpend(account, range);
    expect(rows).toEqual([
      { platformCampaignId: 'c9', date: '2026-05-19', impressions: 1000, clicks: 40, spendCents: 1234, conversions: 5 },
    ]);
  });

  it('applyAction set_budget on an ad rejects; campaign budget POSTs currency units', async () => {
    const seen: Array<{ body: string | null }> = [];
    _setAdsFetchForTests(async (_i, init) => {
      seen.push({ body: (init?.body as string) ?? null });
      return jsonResponse({ code: 0, data: {} });
    });
    await expect(
      tiktokRealConnector.applyAction(account, { level: 'ad', externalId: 'x', action: 'set_budget', dailyBudgetCents: 100 }),
    ).rejects.toThrow();

    const r = await tiktokRealConnector.applyAction(account, {
      level: 'campaign',
      externalId: 'c1',
      action: 'set_budget',
      dailyBudgetCents: 9900,
    });
    expect(r.ok).toBe(true);
    expect(seen.at(-1)?.body).toContain('"budget":99'); // 9900 cents → 99 units
  });
});

describe('dispatch gating for google + tiktok', () => {
  afterEach(() => _resetFlagReaderForTests());

  it('both resolve to their mocks when flags off / no creds', async () => {
    _setFlagReaderForTests(() => Promise.resolve('off'));
    expect(await isRealAdsEnabled('google')).toBe(false);
    expect(await isRealAdsEnabled('tiktok')).toBe(false);
    expect(await resolveAdsConnector('google')).toBe(googleMockConnector);
    expect(await resolveAdsConnector('tiktok')).toBe(tiktokMockConnector);
  });

  it('fails safe to the mock when the flag read throws', async () => {
    _setFlagReaderForTests(() => Promise.reject(new Error('db down')));
    expect(await isRealAdsEnabled('google')).toBe(false);
    expect(await resolveAdsConnector('tiktok')).toBe(tiktokMockConnector);
  });
});
