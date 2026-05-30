import { afterEach, describe, expect, it } from 'vitest';

import { normalizeAdStatus } from '../../lib/ads-connectors/base';
import { isRealAdsEnabled, resolveAdsConnector } from '../../lib/ads-connectors/dispatch';
import { googleMockConnector } from '../../lib/ads-connectors/google-mock';
import { metaMockConnector } from '../../lib/ads-connectors/meta-mock';
import { metaRealConnector } from '../../lib/ads-connectors/meta-real';
import { _setGraphFetchForTests } from '../../lib/connectors/meta/graph';
import { _resetFlagReaderForTests, _setFlagReaderForTests } from '../../lib/flags';

/**
 * C50 ads-connector extensions. Mock connectors: new listAdAccounts /
 * syncStructure / applyAction methods + conversions on spend rows (deterministic).
 * Real Meta adapter: Graph mapping for accounts/structure/insights/actions via the
 * fetch seam — zero network.
 */

const range = { from: '2026-05-19', to: '2026-05-20' };
const account = {
  adsAccountId: '00000000-0000-4000-8000-000000000001',
  externalAccountId: '123456',
  currency: 'USD',
  accessToken: 'EAAG-user-token',
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('mock connectors — C50 methods', () => {
  it('meta-mock fetchDailySpend now carries conversions and stays deterministic', async () => {
    const a = await metaMockConnector.fetchDailySpend(account, range);
    const b = await metaMockConnector.fetchDailySpend(account, range);
    expect(a).toEqual(b);
    for (const r of a) {
      expect(typeof r.conversions).toBe('number');
      expect(r.conversions).toBeGreaterThanOrEqual(0);
      expect(r.conversions).toBeLessThanOrEqual(r.clicks);
    }
  });

  it('listAdAccounts returns a deterministic account seeded from the token', async () => {
    const accts = await metaMockConnector.listAdAccounts({ accessToken: 'tok-abcdef' });
    expect(accts).toHaveLength(1);
    expect(accts[0]?.status).toBe('connected');
    expect(accts[0]?.externalAccountId).toContain('m-acct-');
  });

  it('syncStructure yields a coherent campaign→ad-set→ad tree (deterministic)', async () => {
    const s1 = await metaMockConnector.syncStructure(account);
    const s2 = await metaMockConnector.syncStructure(account);
    expect(s1).toEqual(s2);
    expect(s1.campaigns).toHaveLength(2);
    expect(s1.adSets.length).toBeGreaterThanOrEqual(2);
    expect(s1.ads.length).toBeGreaterThanOrEqual(2);
    // Every ad set points at a real campaign; every ad at a real ad set.
    const campaignIds = new Set(s1.campaigns.map((c) => c.externalId));
    const adSetIds = new Set(s1.adSets.map((s) => s.externalId));
    for (const s of s1.adSets) expect(campaignIds.has(s.campaignExternalId ?? '')).toBe(true);
    for (const a of s1.ads) expect(adSetIds.has(a.adSetExternalId ?? '')).toBe(true);
    // Campaign ids align with the spend-mock ids (m-…-c{n}) so they correlate.
    expect(s1.campaigns[0]?.externalId).toBe(`m-${account.externalAccountId}-c0`);
  });

  it('google-mock implements the same surface (3 campaigns, g- prefix)', async () => {
    const accts = await googleMockConnector.listAdAccounts({ accessToken: 'g-tok' });
    expect(accts).toHaveLength(1);
    const s = await googleMockConnector.syncStructure(account);
    expect(s.campaigns).toHaveLength(3);
    expect(s.campaigns[0]?.externalId).toBe(`g-${account.externalAccountId}-c0`);
  });

  it('applyAction echoes the resulting status', async () => {
    const paused = await metaMockConnector.applyAction(account, {
      level: 'campaign',
      externalId: 'm-123456-c0',
      action: 'pause',
    });
    expect(paused).toEqual({ ok: true, externalId: 'm-123456-c0', status: 'paused' });
    const resumed = await metaMockConnector.applyAction(account, {
      level: 'ad_set',
      externalId: 's1',
      action: 'resume',
    });
    expect(resumed.status).toBe('active');
    const budget = await metaMockConnector.applyAction(account, {
      level: 'campaign',
      externalId: 'c1',
      action: 'set_budget',
      dailyBudgetCents: 5000,
    });
    expect(budget).toEqual({ ok: true, externalId: 'c1' }); // no status for budget
  });
});

describe('normalizeAdStatus', () => {
  it('maps Meta status vocab to our normalized set', () => {
    expect(normalizeAdStatus('ACTIVE')).toBe('active');
    expect(normalizeAdStatus('PAUSED')).toBe('paused');
    expect(normalizeAdStatus('ARCHIVED')).toBe('archived');
    expect(normalizeAdStatus('PENDING_REVIEW')).toBe('pending');
    expect(normalizeAdStatus('SOMETHING_NEW')).toBe('unknown');
    expect(normalizeAdStatus(null)).toBe('unknown');
  });
});

describe('meta-real adapter — Graph mapping via fetch seam', () => {
  afterEach(() => _setGraphFetchForTests(null));

  it('listAdAccounts maps account_status → connection status', async () => {
    _setGraphFetchForTests(async () =>
      jsonResponse({
        data: [
          { account_id: '111', name: 'Acme', currency: 'EUR', account_status: 1 },
          { account_id: '222', name: 'Paused Co', currency: 'USD', account_status: 2 },
          { id: 'act_333', name: 'Errored', currency: 'USD', account_status: 3 },
        ],
      }),
    );
    const accts = await metaRealConnector.listAdAccounts({ accessToken: 'tok' });
    expect(accts).toEqual([
      { externalAccountId: '111', name: 'Acme', currency: 'EUR', status: 'connected' },
      { externalAccountId: '222', name: 'Paused Co', currency: 'USD', status: 'disconnected' },
      { externalAccountId: '333', name: 'Errored', currency: 'USD', status: 'error' },
    ]);
  });

  it('syncStructure maps campaigns/adsets/ads with budgets + parent links', async () => {
    _setGraphFetchForTests(async (input) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/campaigns')) {
        return jsonResponse({
          data: [
            { id: 'c1', name: 'C1', status: 'ACTIVE', objective: 'OUTCOME_TRAFFIC', daily_budget: '5000' },
          ],
        });
      }
      if (path.endsWith('/adsets')) {
        return jsonResponse({
          data: [{ id: 's1', name: 'S1', status: 'PAUSED', campaign_id: 'c1', daily_budget: '2000' }],
        });
      }
      if (path.endsWith('/ads')) {
        return jsonResponse({ data: [{ id: 'a1', name: 'A1', status: 'ACTIVE', adset_id: 's1' }] });
      }
      return jsonResponse({ data: [] });
    });

    const s = await metaRealConnector.syncStructure(account);
    expect(s.campaigns).toEqual([
      {
        externalId: 'c1',
        name: 'C1',
        status: 'active',
        objective: 'OUTCOME_TRAFFIC',
        dailyBudgetCents: 5000,
        lifetimeBudgetCents: null,
        currency: 'USD',
        raw: { id: 'c1', name: 'C1', status: 'ACTIVE', objective: 'OUTCOME_TRAFFIC', daily_budget: '5000' },
      },
    ]);
    expect(s.adSets[0]?.campaignExternalId).toBe('c1');
    expect(s.adSets[0]?.status).toBe('paused');
    expect(s.adSets[0]?.dailyBudgetCents).toBe(2000);
    expect(s.ads[0]?.adSetExternalId).toBe('s1');
  });

  it('fetchDailySpend maps insights spend → cents and sums conversion actions', async () => {
    _setGraphFetchForTests(async () =>
      jsonResponse({
        data: [
          {
            campaign_id: 'c1',
            date_start: '2026-05-19',
            impressions: '1000',
            clicks: '50',
            spend: '12.34',
            actions: [
              { action_type: 'purchase', value: '3' },
              { action_type: 'link_click', value: '40' },
              { action_type: 'lead', value: '2' },
            ],
          },
        ],
      }),
    );
    const rows = await metaRealConnector.fetchDailySpend(account, range);
    expect(rows).toEqual([
      {
        platformCampaignId: 'c1',
        date: '2026-05-19',
        impressions: 1000,
        clicks: 50,
        spendCents: 1234,
        conversions: 5, // purchase 3 + lead 2; link_click ignored
      },
    ]);
  });

  it('applyAction POSTs status / budget and returns the resulting status', async () => {
    const seen: Array<{ url: string; body: string | null }> = [];
    _setGraphFetchForTests(async (input, init) => {
      seen.push({ url: String(input), body: (init?.body as string) ?? null });
      return jsonResponse({ success: true });
    });
    const paused = await metaRealConnector.applyAction(account, {
      level: 'campaign',
      externalId: 'c1',
      action: 'pause',
    });
    expect(paused.status).toBe('paused');
    expect(seen[0]?.body).toContain('status=PAUSED');

    await metaRealConnector.applyAction(account, {
      level: 'campaign',
      externalId: 'c1',
      action: 'set_budget',
      dailyBudgetCents: 7500,
    });
    expect(seen[1]?.body).toContain('daily_budget=7500');
  });

  it('follows CURSOR pagination across pages (object edges)', async () => {
    let calls = 0;
    _setGraphFetchForTests(async (input) => {
      calls += 1;
      const u = new URL(String(input));
      if (u.searchParams.get('after')) {
        return jsonResponse({ data: [{ account_id: '2', name: 'B', currency: 'USD', account_status: 1 }] });
      }
      return jsonResponse({
        data: [{ account_id: '1', name: 'A', currency: 'USD', account_status: 1 }],
        paging: {
          next: 'https://graph.facebook.com/v21.0/me/adaccounts?after=CUR1',
          cursors: { after: 'CUR1' },
        },
      });
    });
    const accts = await metaRealConnector.listAdAccounts({ accessToken: 'tok' });
    expect(accts.map((a) => a.externalAccountId)).toEqual(['1', '2']);
    expect(calls).toBe(2);
  });

  it('follows OFFSET pagination on the insights edge (next present, cursors absent)', async () => {
    // The exact bug class fix #1 closed: insights paginates by offset with NO
    // `cursors`, so relying on cursors.after alone drops every page past the first.
    let calls = 0;
    _setGraphFetchForTests(async (input) => {
      calls += 1;
      const u = new URL(String(input));
      if (u.searchParams.get('offset')) {
        return jsonResponse({
          data: [{ campaign_id: 'c2', date_start: '2026-05-19', impressions: '2', clicks: '0', spend: '2.00' }],
        });
      }
      return jsonResponse({
        data: [{ campaign_id: 'c1', date_start: '2026-05-19', impressions: '1', clicks: '0', spend: '1.00' }],
        paging: { next: 'https://graph.facebook.com/v21.0/act_123456/insights?offset=200' },
      });
    });
    const rows = await metaRealConnector.fetchDailySpend(account, range);
    expect(rows.map((r) => r.platformCampaignId)).toEqual(['c1', 'c2']);
    expect(calls).toBe(2);
  });

  it('throws when no access token is present', async () => {
    await expect(
      metaRealConnector.syncStructure({ ...account, accessToken: undefined }),
    ).rejects.toThrow();
  });

  it('set_budget without dailyBudgetCents throws', async () => {
    _setGraphFetchForTests(async () => jsonResponse({}));
    await expect(
      metaRealConnector.applyAction(account, { level: 'campaign', externalId: 'c1', action: 'set_budget' }),
    ).rejects.toThrow();
  });
});

describe('ads dispatch gating (real-vs-mock)', () => {
  afterEach(() => _resetFlagReaderForTests());

  it('google always resolves to the mock (real google is a later batch)', async () => {
    expect(await isRealAdsEnabled('google')).toBe(false);
    expect(await resolveAdsConnector('google')).toBe(googleMockConnector);
  });

  it('meta resolves to the mock when the flag is off', async () => {
    _setFlagReaderForTests(() => Promise.resolve('off'));
    expect(await isRealAdsEnabled('meta')).toBe(false);
    expect(await resolveAdsConnector('meta')).toBe(metaMockConnector);
  });

  it('fails safe to the mock when the flag read throws', async () => {
    // metaCredsPresent() short-circuits to false without creds, and isFlagOn
    // catches + returns false WITH creds — both directions land on the mock.
    _setFlagReaderForTests(() => Promise.reject(new Error('db down')));
    expect(await isRealAdsEnabled('meta')).toBe(false);
    expect(await resolveAdsConnector('meta')).toBe(metaMockConnector);
  });
});
