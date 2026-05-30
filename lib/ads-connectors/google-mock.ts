/**
 * Google Ads mock connector — Phase 8 / Commit 28.
 *
 * Deterministic stand-in until Phase 11 swaps in `google-ads-api`.
 * For each `(externalAccountId, date)` we generate THREE
 * synthetic campaign ids and one spend row each. Numbers per
 * Ajuste 2 spec:
 *
 *   - spend per campaign per day: $20.00–$200.00 native
 *   - CTR: 1%–3%
 *   - impressions: 5k–25k → clicks derived from CTR
 *
 * Seeded by FNV-1a hash of `external|date|campaign`. Pure: no
 * I/O, no clock reads, no global RNG. Re-running the cron on the
 * same range yields byte-identical rows, so the upsert is a
 * no-op (no `updated_at` churn) — exactly what we want.
 */

import {
  type AdAccountSummary,
  type AdStructure,
  type AdsActionInput,
  type AdsActionResult,
  type AdsConnector,
  type AdsConnectorAccount,
  type AdsConnectorAuth,
  type AdsConnectorDateRange,
  type AdsConnectorSpendRow,
  enumerateDates,
  fnv1a32,
  mulberry32,
} from './base';
import {
  mockApplyAction,
  mockConversions,
  mockListAdAccounts,
  mockSyncStructure,
} from './mock-structure';

const CAMPAIGNS_PER_ACCOUNT = 3;
const PREFIX = 'g';

function generateRow(
  externalAccountId: string,
  date: string,
  campaignIndex: number,
): AdsConnectorSpendRow {
  const platformCampaignId = `${PREFIX}-${externalAccountId}-c${campaignIndex}`;
  const seed = fnv1a32(`${externalAccountId}|${date}|${campaignIndex}`);
  const rng = mulberry32(seed);

  // spend $20–$200 in cents
  const spendCents = Math.round(2000 + rng() * 18000);
  // impressions 5k–25k
  const impressions = Math.round(5000 + rng() * 20000);
  // CTR 1%–3%
  const ctr = 0.01 + rng() * 0.02;
  const clicks = Math.round(impressions * ctr);

  return {
    platformCampaignId,
    date,
    impressions,
    clicks,
    spendCents,
    conversions: mockConversions(seed, clicks),
  };
}

export const googleMockConnector: AdsConnector = {
  platform: 'google',
  async fetchDailySpend(
    account: AdsConnectorAccount,
    range: AdsConnectorDateRange,
  ): Promise<readonly AdsConnectorSpendRow[]> {
    const dates = enumerateDates(range);
    const out: AdsConnectorSpendRow[] = [];
    for (const date of dates) {
      for (let c = 0; c < CAMPAIGNS_PER_ACCOUNT; c += 1) {
        out.push(generateRow(account.externalAccountId, date, c));
      }
    }
    return out;
  },
  async listAdAccounts(auth: AdsConnectorAuth): Promise<readonly AdAccountSummary[]> {
    return mockListAdAccounts(PREFIX, auth);
  },
  async syncStructure(account: AdsConnectorAccount): Promise<AdStructure> {
    return mockSyncStructure(PREFIX, CAMPAIGNS_PER_ACCOUNT, account);
  },
  async applyAction(
    _account: AdsConnectorAccount,
    input: AdsActionInput,
  ): Promise<AdsActionResult> {
    return mockApplyAction(input);
  },
};
