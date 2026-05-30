import 'server-only';

import { PlatformError } from '@/lib/connectors/base/errors';
import { graphRequest } from '@/lib/connectors/meta/graph';

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
  normalizeAdStatus,
} from './base';

/**
 * Real Meta Marketing API ads connector (C50) — cabled but INACTIVE until creds
 * + App Review land and `use_real_meta_ads='on'` (see `config.ts`). Reaches the
 * Graph API through the shared `graphRequest` client so error taxonomy
 * (190→TokenExpired, throttling→RateLimited) and the test fetch seam are reused
 * — CI never touches the network.
 *
 * Token: the user access token (with `ads_management`/`ads_read`) stored on the
 * `meta_ads` connection. Threaded in via `account.accessToken` / `auth`.
 *
 * Budgets: Meta returns `daily_budget`/`lifetime_budget` as strings in the
 * account-currency MINOR unit (cents) — stored as-is. Spend `insights.spend` is
 * a major-unit decimal string → ×100. Conversions are summed from a small
 * allowlist of `actions` types (documented heuristic, not exhaustive).
 */

const MAX_PAGES = 25;

function requireToken(account: AdsConnectorAccount): string {
  if (!account.accessToken) {
    throw new PlatformError('facebook', 'Meta ads: no access token on account.');
  }
  return account.accessToken;
}

function parseCents(v: string | number | null | undefined): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function toInt(v: string | number | null | undefined): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

interface GraphPage<T> {
  data?: T[];
  paging?: { next?: string; cursors?: { after?: string } };
}

/**
 * Derive the next-page advance param from `paging.next`. Object edges
 * (/campaigns, /adsets, /ads, /me/adaccounts) paginate by CURSOR (`after`); the
 * insights edge paginates by OFFSET (`offset`, no `cursors`). Reading the param
 * out of the `next` URL itself handles BOTH — relying on `cursors.after` alone
 * silently drops every page past the first on the insights edge.
 */
function advanceFromNext(
  next: string,
  cursorAfter: string | undefined,
): Record<string, string> | null {
  try {
    const u = new URL(next);
    const after = u.searchParams.get('after') ?? cursorAfter ?? undefined;
    if (after) return { after };
    const offset = u.searchParams.get('offset') ?? undefined;
    if (offset) return { offset };
    return null;
  } catch {
    return cursorAfter ? { after: cursorAfter } : null;
  }
}

/** Paginate a Graph edge (cursor OR offset) until exhausted or the page cap. */
async function graphPaged<T>(
  path: string,
  params: Record<string, string | number | boolean | undefined>,
  accessToken: string,
): Promise<T[]> {
  const out: T[] = [];
  let pageParams: Record<string, string> = {};
  let guard = 0;
  while (guard < MAX_PAGES) {
    const page = await graphRequest<GraphPage<T>>({
      method: 'GET',
      path,
      platform: 'facebook',
      params: {
        ...params,
        access_token: accessToken,
        limit: 200,
        ...pageParams,
      },
    });
    out.push(...(page.data ?? []));
    guard += 1;
    const next = page.paging?.next;
    if (!next) break;
    const advance = advanceFromNext(next, page.paging?.cursors?.after);
    if (!advance) break; // can't advance safely → stop rather than refetch page 1
    pageParams = advance;
  }
  return out;
}

// Conversion-like Meta action types. Heuristic — a real deployment may tune this
// per advertiser objective. Unknown action types are ignored (not summed).
const CONVERSION_ACTION_TYPES = new Set([
  'purchase',
  'offsite_conversion.fb_pixel_purchase',
  'lead',
  'offsite_conversion.fb_pixel_lead',
  'complete_registration',
  'offsite_conversion.fb_pixel_complete_registration',
]);

function sumConversions(
  actions: Array<{ action_type?: string; value?: string | number }> | undefined,
): number {
  if (!actions) return 0;
  let total = 0;
  for (const a of actions) {
    if (a.action_type && CONVERSION_ACTION_TYPES.has(a.action_type)) {
      total += toInt(a.value);
    }
  }
  return total;
}

export const metaRealConnector: AdsConnector = {
  platform: 'meta',

  async listAdAccounts(auth: AdsConnectorAuth): Promise<readonly AdAccountSummary[]> {
    const rows = await graphPaged<{
      id?: string;
      account_id?: string;
      name?: string;
      currency?: string;
      account_status?: number;
    }>('/me/adaccounts', { fields: 'account_id,name,currency,account_status' }, auth.accessToken);
    return rows
      .map((r): AdAccountSummary => ({
        externalAccountId: r.account_id ?? (r.id ?? '').replace(/^act_/, ''),
        name: r.name ?? 'Ad Account',
        currency: r.currency ?? 'USD',
        status:
          r.account_status === 1
            ? 'connected'
            : r.account_status === 2
              ? 'disconnected'
              : 'error',
      }))
      .filter((a) => a.externalAccountId.length > 0);
  },

  async syncStructure(account: AdsConnectorAccount): Promise<AdStructure> {
    const token = requireToken(account);
    const act = `act_${account.externalAccountId}`;

    const campaignsRaw = await graphPaged<{
      id: string;
      name?: string;
      status?: string;
      objective?: string;
      daily_budget?: string;
      lifetime_budget?: string;
    }>(`/${act}/campaigns`, { fields: 'id,name,status,objective,daily_budget,lifetime_budget' }, token);

    const adSetsRaw = await graphPaged<{
      id: string;
      name?: string;
      status?: string;
      campaign_id?: string;
      daily_budget?: string;
      lifetime_budget?: string;
    }>(`/${act}/adsets`, { fields: 'id,name,status,campaign_id,daily_budget,lifetime_budget' }, token);

    const adsRaw = await graphPaged<{
      id: string;
      name?: string;
      status?: string;
      adset_id?: string;
    }>(`/${act}/ads`, { fields: 'id,name,status,adset_id' }, token);

    const campaigns: AdCampaignNode[] = campaignsRaw.map((c) => ({
      externalId: c.id,
      name: c.name ?? c.id,
      status: normalizeAdStatus(c.status),
      objective: c.objective ?? null,
      dailyBudgetCents: parseCents(c.daily_budget),
      lifetimeBudgetCents: parseCents(c.lifetime_budget),
      currency: account.currency,
      raw: c,
    }));
    const adSets: AdSetNode[] = adSetsRaw.map((s) => ({
      externalId: s.id,
      campaignExternalId: s.campaign_id ?? null,
      name: s.name ?? s.id,
      status: normalizeAdStatus(s.status),
      dailyBudgetCents: parseCents(s.daily_budget),
      lifetimeBudgetCents: parseCents(s.lifetime_budget),
      currency: account.currency,
      raw: s,
    }));
    const ads: AdNode[] = adsRaw.map((a) => ({
      externalId: a.id,
      adSetExternalId: a.adset_id ?? null,
      name: a.name ?? a.id,
      status: normalizeAdStatus(a.status),
      raw: a,
    }));
    return { campaigns, adSets, ads };
  },

  async fetchDailySpend(
    account: AdsConnectorAccount,
    range: AdsConnectorDateRange,
  ): Promise<readonly AdsConnectorSpendRow[]> {
    const token = requireToken(account);
    const act = `act_${account.externalAccountId}`;
    const rows = await graphPaged<{
      campaign_id?: string;
      date_start?: string;
      impressions?: string;
      clicks?: string;
      spend?: string;
      actions?: Array<{ action_type?: string; value?: string | number }>;
    }>(
      `/${act}/insights`,
      {
        level: 'campaign',
        time_increment: 1,
        time_range: JSON.stringify({ since: range.from, until: range.to }),
        fields: 'campaign_id,impressions,clicks,spend,actions',
      },
      token,
    );
    return rows
      .filter((r) => r.campaign_id)
      .map((r): AdsConnectorSpendRow => ({
        platformCampaignId: r.campaign_id as string,
        date: r.date_start ?? range.from,
        impressions: toInt(r.impressions),
        clicks: toInt(r.clicks),
        spendCents: Math.round(Number.parseFloat(r.spend ?? '0') * 100),
        conversions: sumConversions(r.actions),
      }));
  },

  async applyAction(
    account: AdsConnectorAccount,
    input: AdsActionInput,
  ): Promise<AdsActionResult> {
    const token = requireToken(account);
    const params: Record<string, string | number | boolean | undefined> = {
      access_token: token,
    };
    if (input.action === 'pause') {
      params.status = 'PAUSED';
    } else if (input.action === 'resume') {
      params.status = 'ACTIVE';
    } else {
      if (input.dailyBudgetCents == null) {
        throw new PlatformError('facebook', 'Meta ads: set_budget requires dailyBudgetCents.');
      }
      params.daily_budget = String(input.dailyBudgetCents);
    }
    await graphRequest({ method: 'POST', path: `/${input.externalId}`, params, platform: 'facebook' });
    return {
      ok: true,
      externalId: input.externalId,
      ...(input.action === 'pause'
        ? { status: 'paused' as const }
        : input.action === 'resume'
          ? { status: 'active' as const }
          : {}),
    };
  },
};
