import 'server-only';

import { env } from '@/lib/env';
import { log } from '@/lib/log';

import {
  type AdAccountSummary,
  type AdCampaignNode,
  type AdNode,
  type AdSetNode,
  type AdStructure,
  type AdsActionInput,
  type AdsActionResult,
  type AdsConnector,
  type AdsConnectorAccount,
  type AdsConnectorAuth,
  type AdsConnectorDateRange,
  type AdsConnectorSpendRow,
} from './base';
import { adsHttpJson } from './ads-http';

/**
 * Real Google Ads adapter (C51) — cabled but INACTIVE until creds + API access
 * land and `use_real_google_ads='on'`. Uses the Google Ads REST API (v17) +
 * GAQL via the shared ads-http seam (unit-tested, zero network).
 *
 * Honest simplifications (validate at cutover with a real developer token):
 *  - listAdAccounts uses `customers:listAccessibleCustomers`; name/currency are
 *    not enriched per-customer (defaults to the id / USD) to avoid an N+1 — a
 *    follow-up can query `customer.currency_code`.
 *  - money is in micros (1/1e6 of the account currency); cents = micros / 1e4.
 *  - set_budget mutates the campaign's shared `campaign_budget` resource (looked
 *    up via GAQL), since Google budgets are a separate resource, not a field.
 *  - GAQL status vocab is ENABLED/PAUSED/REMOVED (mapped locally).
 */

const API_BASE = 'https://googleads.googleapis.com/v17';

function mapGoogleStatus(raw: string | undefined): AdCampaignNode['status'] {
  switch ((raw ?? '').toUpperCase()) {
    case 'ENABLED':
      return 'active';
    case 'PAUSED':
      return 'paused';
    case 'REMOVED':
      return 'deleted';
    default:
      return 'unknown';
  }
}

function authHeaders(token: string): Record<string, string> {
  const h: Record<string, string> = {
    authorization: `Bearer ${token}`,
    'developer-token': env.GOOGLE_ADS_DEVELOPER_TOKEN ?? '',
  };
  if (env.GOOGLE_ADS_LOGIN_CUSTOMER_ID) {
    h['login-customer-id'] = env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
  }
  return h;
}

function requireToken(account: AdsConnectorAccount): string {
  if (!account.accessToken) throw new Error('Google Ads: no access token on account.');
  return account.accessToken;
}

interface GaqlResult<T> {
  results?: T[];
  nextPageToken?: string;
}

/** Run a GAQL query against one customer, following pageToken to exhaustion. */
async function gaqlSearch<T>(customerId: string, token: string, query: string): Promise<T[]> {
  const out: T[] = [];
  let pageToken: string | undefined;
  let guard = 0;
  do {
    const page = await adsHttpJson<GaqlResult<T>>({
      method: 'POST',
      url: `${API_BASE}/customers/${customerId}/googleAds:search`,
      headers: authHeaders(token),
      json: { query, ...(pageToken ? { pageToken } : {}) },
    });
    out.push(...(page.results ?? []));
    pageToken = page.nextPageToken;
    guard += 1;
  } while (pageToken && guard < 25);
  // Surface truncation rather than silently dropping the tail of a huge account.
  if (pageToken) {
    log.warn({ customerId, query: query.slice(0, 80) }, 'google_ads.gaql.truncated');
  }
  return out;
}

function microsToCents(micros: string | number | null | undefined): number | null {
  if (micros == null) return null;
  const n = Number(micros);
  return Number.isFinite(n) ? Math.round(n / 10_000) : null;
}

export const googleRealConnector: AdsConnector = {
  platform: 'google',

  async listAdAccounts(auth: AdsConnectorAuth): Promise<readonly AdAccountSummary[]> {
    const res = await adsHttpJson<{ resourceNames?: string[] }>({
      method: 'GET',
      url: `${API_BASE}/customers:listAccessibleCustomers`,
      headers: authHeaders(auth.accessToken),
    });
    return (res.resourceNames ?? []).map((name) => {
      const id = name.replace(/^customers\//, '');
      return { externalAccountId: id, name: id, currency: 'USD', status: 'connected' as const };
    });
  },

  async syncStructure(account: AdsConnectorAccount): Promise<AdStructure> {
    const token = requireToken(account);
    const cid = account.externalAccountId;

    const campaignRows = await gaqlSearch<{
      campaign?: { id?: string; name?: string; status?: string; advertisingChannelType?: string };
      campaignBudget?: { amountMicros?: string };
    }>(
      cid,
      token,
      'SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign_budget.amount_micros FROM campaign',
    );
    const adGroupRows = await gaqlSearch<{
      adGroup?: { id?: string; name?: string; status?: string; campaign?: string };
    }>(cid, token, 'SELECT ad_group.id, ad_group.name, ad_group.status, ad_group.campaign FROM ad_group');
    const adRows = await gaqlSearch<{
      adGroupAd?: { ad?: { id?: string; name?: string }; status?: string; adGroup?: string };
    }>(
      cid,
      token,
      'SELECT ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.status, ad_group_ad.ad_group FROM ad_group_ad',
    );

    const campaigns: AdCampaignNode[] = campaignRows
      .filter((r) => r.campaign?.id)
      .map((r) => ({
        externalId: r.campaign!.id!,
        name: r.campaign!.name ?? r.campaign!.id!,
        status: mapGoogleStatus(r.campaign!.status),
        // Google has no single "objective" field — advertising_channel_type is
        // the NETWORK (SEARCH/DISPLAY/…), not the marketing goal Meta/TikTok put
        // here. Leave the shared column null; the channel type is kept in `raw`.
        objective: null,
        dailyBudgetCents: microsToCents(r.campaignBudget?.amountMicros),
        lifetimeBudgetCents: null,
        currency: account.currency,
        raw: r,
      }));
    const adSets: AdSetNode[] = adGroupRows
      .filter((r) => r.adGroup?.id)
      .map((r) => ({
        externalId: r.adGroup!.id!,
        // ad_group.campaign is `customers/{cid}/campaigns/{id}`.
        campaignExternalId: r.adGroup!.campaign?.split('/').pop() ?? null,
        name: r.adGroup!.name ?? r.adGroup!.id!,
        status: mapGoogleStatus(r.adGroup!.status),
        dailyBudgetCents: null,
        lifetimeBudgetCents: null,
        currency: account.currency,
        raw: r,
      }));
    const ads: AdNode[] = adRows
      .filter((r) => r.adGroupAd?.ad?.id)
      .map((r) => {
        const adGroupId = r.adGroupAd!.adGroup?.split('/').pop() ?? null;
        const adId = r.adGroupAd!.ad!.id!;
        // Google ad_group_ad resource names are COMPOSITE `{adGroupId}~{adId}`;
        // store the composite so a later pause/resume targets the right resource
        // (campaigns/ad_groups use bare ids, so they're unaffected).
        return {
          externalId: adGroupId ? `${adGroupId}~${adId}` : adId,
          adSetExternalId: adGroupId,
          name: r.adGroupAd!.ad!.name ?? adId,
          status: mapGoogleStatus(r.adGroupAd!.status),
          raw: r,
        };
      });
    return { campaigns, adSets, ads };
  },

  async fetchDailySpend(
    account: AdsConnectorAccount,
    range: AdsConnectorDateRange,
  ): Promise<readonly AdsConnectorSpendRow[]> {
    const token = requireToken(account);
    const cid = account.externalAccountId;
    const rows = await gaqlSearch<{
      campaign?: { id?: string };
      metrics?: { impressions?: string; clicks?: string; costMicros?: string; conversions?: number | string };
      segments?: { date?: string };
    }>(
      cid,
      token,
      `SELECT campaign.id, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, segments.date ` +
        `FROM campaign WHERE segments.date BETWEEN '${range.from}' AND '${range.to}'`,
    );
    return rows
      .filter((r) => r.campaign?.id && r.segments?.date)
      .map((r): AdsConnectorSpendRow => ({
        platformCampaignId: r.campaign!.id!,
        date: r.segments!.date!,
        impressions: Math.round(Number(r.metrics?.impressions ?? 0)),
        clicks: Math.round(Number(r.metrics?.clicks ?? 0)),
        spendCents: microsToCents(r.metrics?.costMicros) ?? 0,
        conversions: Math.round(Number(r.metrics?.conversions ?? 0)),
      }));
  },

  async applyAction(
    account: AdsConnectorAccount,
    input: AdsActionInput,
  ): Promise<AdsActionResult> {
    const token = requireToken(account);
    const cid = account.externalAccountId;

    if (input.action === 'set_budget') {
      if (input.level !== 'campaign') {
        throw new Error('Google Ads: budget is set on the campaign (shared campaign_budget).');
      }
      if (input.dailyBudgetCents == null) {
        throw new Error('Google Ads: set_budget requires dailyBudgetCents.');
      }
      // Google budgets live on a separate campaign_budget resource — look it up.
      const budgetRows = await gaqlSearch<{ campaign?: { campaignBudget?: string } }>(
        cid,
        token,
        `SELECT campaign.campaign_budget FROM campaign WHERE campaign.id = ${input.externalId}`,
      );
      const budgetResource = budgetRows[0]?.campaign?.campaignBudget;
      if (!budgetResource) throw new Error('Google Ads: campaign budget resource not found.');
      await adsHttpJson({
        method: 'POST',
        url: `${API_BASE}/customers/${cid}/campaignBudgets:mutate`,
        headers: authHeaders(token),
        json: {
          operations: [
            {
              update: { resourceName: budgetResource, amountMicros: String(input.dailyBudgetCents * 10_000) },
              updateMask: 'amount_micros',
            },
          ],
        },
      });
      return { ok: true, externalId: input.externalId };
    }

    const status = input.action === 'pause' ? 'PAUSED' : 'ENABLED';
    // ad_group_ad resource names are composite (`{adGroupId}~{adId}`); the caller
    // passes that composite as externalId for level 'ad'.
    const collection = input.level === 'ad' ? 'adGroupAds' : input.level === 'ad_set' ? 'adGroups' : 'campaigns';
    await adsHttpJson({
      method: 'POST',
      url: `${API_BASE}/customers/${cid}/${collection}:mutate`,
      headers: authHeaders(token),
      json: {
        operations: [
          {
            update: {
              resourceName: `customers/${cid}/${collection}/${input.externalId}`,
              status,
            },
            updateMask: 'status',
          },
        ],
      },
    });
    return {
      ok: true,
      externalId: input.externalId,
      status: input.action === 'pause' ? 'paused' : 'active',
    };
  },
};
