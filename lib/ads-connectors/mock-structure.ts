/**
 * Shared deterministic generators for the mock ads connectors (C50).
 *
 * Same determinism contract as `base.ts`: pure functions of their inputs, no
 * clock / global RNG, seeded by FNV-1a so re-running the sync yields
 * byte-identical structure (the idempotent upsert relies on it). The campaign
 * external ids match `google-mock` / `meta-mock`'s `fetchDailySpend` ids
 * (`g-…-c{n}` / `m-…-c{n}`) so spend rows and structure correlate.
 */

import {
  type AdAccountSummary,
  type AdCampaignNode,
  type AdNode,
  type AdSetNode,
  type AdStructure,
  type AdsActionInput,
  type AdsActionResult,
  type AdsConnectorAccount,
  type AdsConnectorAuth,
  fnv1a32,
  mulberry32,
} from './base';

/** Deterministic conversion count: 2%–10% of clicks. */
export function mockConversions(seed: number, clicks: number): number {
  const rng = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  return Math.round(clicks * (0.02 + rng() * 0.08));
}

/** One deterministic ad account seeded from the token. */
export function mockListAdAccounts(
  prefix: string,
  auth: AdsConnectorAuth,
): readonly AdAccountSummary[] {
  const seed = auth.accessToken.slice(-6) || 'dev';
  return [
    {
      externalAccountId: `${prefix}-acct-${seed}`,
      name: `Mock ${prefix.toUpperCase()} Ad Account`,
      currency: 'USD',
      status: 'connected',
    },
  ];
}

/**
 * Deterministic campaign→ad-set→ad tree. `campaignCount` matches the platform's
 * spend-mock campaign count so structure and spend share campaign ids.
 */
export function mockSyncStructure(
  prefix: string,
  campaignCount: number,
  account: AdsConnectorAccount,
): AdStructure {
  const campaigns: AdCampaignNode[] = [];
  const adSets: AdSetNode[] = [];
  const ads: AdNode[] = [];

  for (let c = 0; c < campaignCount; c += 1) {
    // Mirrors `${prefix}-${external}-c${c}` from the spend mocks.
    const campaignExternalId = `${prefix}-${account.externalAccountId}-c${c}`;
    const seed = fnv1a32(`${prefix}|struct|${account.externalAccountId}|${c}`);
    const rng = mulberry32(seed);
    campaigns.push({
      externalId: campaignExternalId,
      name: `${prefix.toUpperCase()} Campaign ${c + 1}`,
      status: c === 0 ? 'active' : 'paused',
      objective: 'OUTCOME_TRAFFIC',
      dailyBudgetCents: Math.round(2000 + rng() * 8000),
      lifetimeBudgetCents: null,
      currency: account.currency,
    });

    const adSetCount = 1 + (seed % 2); // 1 or 2
    for (let s = 0; s < adSetCount; s += 1) {
      const adSetExternalId = `${campaignExternalId}-s${s}`;
      adSets.push({
        externalId: adSetExternalId,
        campaignExternalId,
        name: `Ad Set ${c + 1}.${s + 1}`,
        status: 'active',
        dailyBudgetCents: Math.round(1000 + rng() * 4000),
        lifetimeBudgetCents: null,
        currency: account.currency,
      });

      const adCount = 1 + (fnv1a32(adSetExternalId) % 2);
      for (let a = 0; a < adCount; a += 1) {
        ads.push({
          externalId: `${adSetExternalId}-a${a}`,
          adSetExternalId,
          name: `Ad ${c + 1}.${s + 1}.${a + 1}`,
          status: 'active',
        });
      }
    }
  }
  return { campaigns, adSets, ads };
}

/** Echo a successful action with the resulting status (pause/resume). */
export function mockApplyAction(input: AdsActionInput): AdsActionResult {
  const status =
    input.action === 'pause'
      ? 'paused'
      : input.action === 'resume'
        ? 'active'
        : undefined;
  return { ok: true, externalId: input.externalId, ...(status ? { status } : {}) };
}
