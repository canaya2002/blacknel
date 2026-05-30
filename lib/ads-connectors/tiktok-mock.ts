/**
 * TikTok Ads mock connector (C51). Same deterministic contract as google/meta
 * mocks — seeded by FNV-1a so re-running the sync is byte-identical. Phase-11
 * swap target is the TikTok Marketing API (advertiser context). 2 campaigns per
 * account; `t-` id prefix keeps seeds disjoint from google (`g-`) / meta (`m-`).
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

const CAMPAIGNS_PER_ACCOUNT = 2;
const PREFIX = 't';

function generateRow(
  externalAccountId: string,
  date: string,
  campaignIndex: number,
): AdsConnectorSpendRow {
  const platformCampaignId = `${PREFIX}-${externalAccountId}-c${campaignIndex}`;
  const seed = fnv1a32(`tiktok|${externalAccountId}|${date}|${campaignIndex}`);
  const rng = mulberry32(seed);

  const spendCents = Math.round(2000 + rng() * 18000);
  const impressions = Math.round(5000 + rng() * 20000);
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

export const tiktokMockConnector: AdsConnector = {
  platform: 'tiktok',
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
