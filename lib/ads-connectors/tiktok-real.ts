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
 * Real TikTok Ads adapter (C51) — cabled but INACTIVE until creds + API access
 * land and `use_real_tiktok_ads='on'`. Uses the TikTok Marketing API v1.3
 * (advertiser context) via the shared ads-http seam (unit-tested, zero network).
 *
 * Honest simplifications (validate at cutover):
 *  - TikTok wraps every response in `{code, message, data}`; code≠0 → throw.
 *  - money (`spend`, `budget`) is a decimal in the account currency → ×100 cents.
 *  - `budget` is mapped to dailyBudgetCents regardless of budget_mode (a real
 *    deployment may branch on DAILY vs TOTAL).
 *  - operation_status ENABLE/DISABLE/DELETE → active/paused/deleted.
 */

const BASE = 'https://business-api.tiktok.com/open_api/v1.3';

function mapTiktokStatus(raw: string | undefined): AdCampaignNode['status'] {
  switch ((raw ?? '').toUpperCase()) {
    case 'ENABLE':
      return 'active';
    case 'DISABLE':
      return 'paused';
    case 'DELETE':
      return 'deleted';
    default:
      return 'unknown';
  }
}

function requireToken(account: AdsConnectorAccount): string {
  if (!account.accessToken) throw new Error('TikTok Ads: no access token on account.');
  return account.accessToken;
}

interface TiktokEnvelope<T> {
  code?: number;
  message?: string;
  data?: T;
}

async function tiktokGet<T>(
  path: string,
  params: Record<string, string | number | undefined>,
  token: string,
): Promise<T> {
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }
  const body = await adsHttpJson<TiktokEnvelope<T>>({
    method: 'GET',
    url: url.toString(),
    headers: { 'Access-Token': token },
  });
  if (body.code && body.code !== 0) throw new Error(`TikTok ${body.code}: ${body.message ?? 'error'}`);
  return (body.data ?? ({} as T)) as T;
}

async function tiktokPost<T>(path: string, json: unknown, token: string): Promise<T> {
  const body = await adsHttpJson<TiktokEnvelope<T>>({
    method: 'POST',
    url: `${BASE}${path}`,
    headers: { 'Access-Token': token },
    json,
  });
  if (body.code && body.code !== 0) throw new Error(`TikTok ${body.code}: ${body.message ?? 'error'}`);
  return (body.data ?? ({} as T)) as T;
}

/** Page through a list endpoint (data.list + data.page_info.total_page). */
async function tiktokList<T>(
  path: string,
  params: Record<string, string | number | undefined>,
  token: string,
): Promise<T[]> {
  const out: T[] = [];
  let page = 1;
  let totalPage = 1;
  let guard = 0;
  do {
    const data = await tiktokGet<{ list?: T[]; page_info?: { total_page?: number } }>(
      path,
      { ...params, page, page_size: 100 },
      token,
    );
    out.push(...(data.list ?? []));
    totalPage = data.page_info?.total_page ?? 1;
    page += 1;
    guard += 1;
  } while (page <= totalPage && guard < 25);
  if (page <= totalPage) {
    log.warn({ path, totalPage }, 'tiktok_ads.list.truncated');
  }
  return out;
}

function toCents(v: string | number | null | undefined): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export const tiktokRealConnector: AdsConnector = {
  platform: 'tiktok',

  async listAdAccounts(auth: AdsConnectorAuth): Promise<readonly AdAccountSummary[]> {
    const data = await tiktokGet<{
      list?: Array<{ advertiser_id?: string; advertiser_name?: string; currency?: string }>;
    }>(
      '/oauth2/advertiser/get/',
      { app_id: env.TIKTOK_ADS_APP_ID, secret: env.TIKTOK_ADS_SECRET },
      auth.accessToken,
    );
    return (data.list ?? [])
      .filter((a) => a.advertiser_id)
      .map((a) => ({
        externalAccountId: a.advertiser_id!,
        name: a.advertiser_name ?? a.advertiser_id!,
        currency: a.currency ?? 'USD',
        status: 'connected' as const,
      }));
  },

  async syncStructure(account: AdsConnectorAccount): Promise<AdStructure> {
    const token = requireToken(account);
    const advertiser_id = account.externalAccountId;

    const campaignRows = await tiktokList<{
      campaign_id?: string;
      campaign_name?: string;
      operation_status?: string;
      objective_type?: string;
      budget?: number | string;
    }>('/campaign/get/', { advertiser_id }, token);
    const adGroupRows = await tiktokList<{
      adgroup_id?: string;
      campaign_id?: string;
      adgroup_name?: string;
      operation_status?: string;
      budget?: number | string;
    }>('/adgroup/get/', { advertiser_id }, token);
    const adRows = await tiktokList<{
      ad_id?: string;
      adgroup_id?: string;
      ad_name?: string;
      operation_status?: string;
    }>('/ad/get/', { advertiser_id }, token);

    const campaigns: AdCampaignNode[] = campaignRows
      .filter((c) => c.campaign_id)
      .map((c) => ({
        externalId: c.campaign_id!,
        name: c.campaign_name ?? c.campaign_id!,
        status: mapTiktokStatus(c.operation_status),
        objective: c.objective_type ?? null,
        dailyBudgetCents: c.budget != null ? toCents(c.budget) : null,
        lifetimeBudgetCents: null,
        currency: account.currency,
        raw: c,
      }));
    const adSets: AdSetNode[] = adGroupRows
      .filter((g) => g.adgroup_id)
      .map((g) => ({
        externalId: g.adgroup_id!,
        campaignExternalId: g.campaign_id ?? null,
        name: g.adgroup_name ?? g.adgroup_id!,
        status: mapTiktokStatus(g.operation_status),
        dailyBudgetCents: g.budget != null ? toCents(g.budget) : null,
        lifetimeBudgetCents: null,
        currency: account.currency,
        raw: g,
      }));
    const ads: AdNode[] = adRows
      .filter((a) => a.ad_id)
      .map((a) => ({
        externalId: a.ad_id!,
        adSetExternalId: a.adgroup_id ?? null,
        name: a.ad_name ?? a.ad_id!,
        status: mapTiktokStatus(a.operation_status),
        raw: a,
      }));
    return { campaigns, adSets, ads };
  },

  async fetchDailySpend(
    account: AdsConnectorAccount,
    range: AdsConnectorDateRange,
  ): Promise<readonly AdsConnectorSpendRow[]> {
    const token = requireToken(account);
    const rows = await tiktokList<{
      dimensions?: { campaign_id?: string; stat_time_day?: string };
      metrics?: { spend?: string; impressions?: string; clicks?: string; conversion?: string | number };
    }>(
      '/report/integrated/get/',
      {
        advertiser_id: account.externalAccountId,
        report_type: 'BASIC',
        data_level: 'AUCTION_CAMPAIGN',
        dimensions: JSON.stringify(['campaign_id', 'stat_time_day']),
        metrics: JSON.stringify(['spend', 'impressions', 'clicks', 'conversion']),
        start_date: range.from,
        end_date: range.to,
      },
      token,
    );
    return rows
      .filter((r) => r.dimensions?.campaign_id && r.dimensions?.stat_time_day)
      .map((r): AdsConnectorSpendRow => ({
        platformCampaignId: r.dimensions!.campaign_id!,
        date: r.dimensions!.stat_time_day!.slice(0, 10),
        impressions: Math.round(Number(r.metrics?.impressions ?? 0)),
        clicks: Math.round(Number(r.metrics?.clicks ?? 0)),
        spendCents: toCents(r.metrics?.spend),
        conversions: Math.round(Number(r.metrics?.conversion ?? 0)),
      }));
  },

  async applyAction(
    account: AdsConnectorAccount,
    input: AdsActionInput,
  ): Promise<AdsActionResult> {
    const token = requireToken(account);
    const advertiser_id = account.externalAccountId;

    if (input.action === 'set_budget') {
      if (input.level === 'ad') {
        throw new Error('TikTok Ads: ads have no budget — set it on the campaign or ad group.');
      }
      if (input.dailyBudgetCents == null) {
        throw new Error('TikTok Ads: set_budget requires dailyBudgetCents.');
      }
      const budget = input.dailyBudgetCents / 100;
      if (input.level === 'campaign') {
        await tiktokPost('/campaign/update/', { advertiser_id, campaign_id: input.externalId, budget }, token);
      } else {
        await tiktokPost('/adgroup/update/', { advertiser_id, adgroup_id: input.externalId, budget }, token);
      }
      return { ok: true, externalId: input.externalId };
    }

    const operation_status = input.action === 'pause' ? 'DISABLE' : 'ENABLE';
    if (input.level === 'campaign') {
      await tiktokPost('/campaign/status/update/', { advertiser_id, campaign_ids: [input.externalId], operation_status }, token);
    } else if (input.level === 'ad_set') {
      await tiktokPost('/adgroup/status/update/', { advertiser_id, adgroup_ids: [input.externalId], operation_status }, token);
    } else {
      await tiktokPost('/ad/status/update/', { advertiser_id, ad_ids: [input.externalId], operation_status }, token);
    }
    return {
      ok: true,
      externalId: input.externalId,
      status: input.action === 'pause' ? 'paused' : 'active',
    };
  },
};
