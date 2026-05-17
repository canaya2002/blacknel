/**
 * Ads connector contract — Phase 8 / Commit 28.
 *
 * Two implementations today: `google-mock` and `meta-mock`. Both
 * produce deterministic spend rows seeded by
 * `(externalAccountId, date)` so re-running the sync yields
 * byte-identical results — which is exactly the property
 * `ads_spend_daily`'s ON-CONFLICT upsert relies on (no spurious
 * `updated_at` churn).
 *
 * **Why mock-only today (Ajuste 2 spec).** Real OAuth + provider
 * SDKs (`google-ads-api`, Meta Marketing API) wire at Phase 11.
 * Until then, mocks let the cron, the queries, the UI, and the
 * tests all exercise the same code paths without external calls.
 *
 * **Determinism contract.** Implementations MUST be pure functions
 * of `(account, dateRange)`. No `Date.now()`, no `Math.random()`
 * without a seeded RNG. Tests rely on this — and so will Phase 11
 * fixtures.
 *
 * **The window.** `dateRange` is inclusive on both ends.
 * `ads-sync.ts` passes a 2d window per D-28-2 to catch late
 * attribution. Connectors return one row per
 * `(platform_campaign_id, date)` — never aggregating dates.
 */

export type AdsConnectorPlatform = 'google' | 'meta';

export interface AdsConnectorAccount {
  /** Our internal id — passed through for logging only. */
  adsAccountId: string;
  /** External id at the platform (e.g. "123-456-7890" for Google). */
  externalAccountId: string;
  /** Native currency for this account (USD, EUR, MXN, ...). */
  currency: string;
}

export interface AdsConnectorDateRange {
  /** ISO date string YYYY-MM-DD, inclusive. */
  from: string;
  /** ISO date string YYYY-MM-DD, inclusive. */
  to: string;
}

export interface AdsConnectorSpendRow {
  platformCampaignId: string;
  /** ISO date YYYY-MM-DD. */
  date: string;
  impressions: number;
  clicks: number;
  /** Native-currency cents — connectors do NOT convert to USD. */
  spendCents: number;
}

export interface AdsConnector {
  readonly platform: AdsConnectorPlatform;
  /**
   * Fetch daily spend rows for one ad account over a date range.
   * Returns ONE row per (campaign, date). Caller is responsible
   * for FX conversion and upsert.
   */
  fetchDailySpend(
    account: AdsConnectorAccount,
    range: AdsConnectorDateRange,
  ): Promise<readonly AdsConnectorSpendRow[]>;
}

/**
 * FNV-1a 32-bit hash. Deterministic, cheap, no deps. We use it
 * to seed the per-campaign-per-day mock numbers so re-running the
 * sync produces identical rows.
 *
 * Not cryptographic. Don't use it for anything that needs to be
 * unpredictable.
 */
export function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Pseudo-random number generator seeded by an integer. Mulberry32
 * — small, fast, decent distribution. Each call returns a new
 * float in [0, 1).
 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Yield every YYYY-MM-DD string in `[range.from, range.to]`
 * inclusive. Throws if from > to.
 */
export function enumerateDates(range: AdsConnectorDateRange): string[] {
  const start = new Date(`${range.from}T00:00:00Z`);
  const end = new Date(`${range.to}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error(`Invalid range: ${range.from}..${range.to}`);
  }
  if (start.getTime() > end.getTime()) {
    throw new Error(`Range from > to: ${range.from} > ${range.to}`);
  }
  const out: string[] = [];
  const cursor = new Date(start.getTime());
  while (cursor.getTime() <= end.getTime()) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}
