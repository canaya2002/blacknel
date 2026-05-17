/**
 * FX rates table — Phase 8 / Commit 28, Ajuste 1.
 *
 * Static rate table (data, not a service call). Used by
 * `lib/jobs/ads-sync.ts` to compute `spend_usd_cents` at-insert.
 * Each `ads_spend_daily` row freezes its USD value when written —
 * we do NOT retroactively recompute on rate change. That's the
 * correct semantics for ad-spend reporting: "you spent X local
 * dollars on day D, which at the time was ≈ Y USD."
 *
 * **Phase 8 (today)** — these constants ARE the FX feed. Rates
 * snapshot from publicly available ECB / xe.com data on
 * `FX_RATES_AS_OF`. Updating the table requires a code change,
 * which is intentional: ad-spend rollups should not change
 * silently because of a vendor's data revision.
 *
 * **Phase 11 swap** — when we wire a real FX provider (likely
 * `openexchangerates.org` or ECB daily feed), only this module
 * changes. The contract stays:
 *   - `toUsdCents(amountCents, currency)` returns USD cents.
 *   - Callers MUST call this once at insert and store the result;
 *     never re-derive USD from native on read.
 *
 * Unsupported currencies fall back to a 1:1 USD multiplier and
 * log a warning. We do NOT throw — the alternative is silently
 * dropping spend data, which is worse than slightly-wrong dollar
 * totals.
 */

/**
 * Conversion rates: 1 unit of CURRENCY = N USD.
 *
 * Snapshot from ECB / xe.com on 2026-05-01.
 */
export const FX_RATES_TO_USD: Readonly<Record<string, number>> = {
  USD: 1.0,
  EUR: 1.08,
  GBP: 1.27,
  MXN: 0.058,
  CAD: 0.73,
  BRL: 0.2,
  ARS: 0.0011,
  AUD: 0.65,
  JPY: 0.0067,
  CLP: 0.0011,
  COP: 0.00025,
  PEN: 0.27,
};

export const FX_RATES_AS_OF = '2026-05-01';

/**
 * Convert a native-currency cents amount to USD cents.
 *
 * Pure function — no I/O, deterministic for a given rate table.
 * Rounds to the nearest cent (banker's rounding is not worth the
 * complexity at this scale).
 *
 * @param amountCents — integer cents in the native currency
 * @param currency — ISO 4217 code; case-insensitive
 * @returns USD cents (integer)
 */
export function toUsdCents(amountCents: number, currency: string): number {
  if (!Number.isFinite(amountCents)) return 0;
  const code = currency.toUpperCase();
  const rate = FX_RATES_TO_USD[code];
  if (rate == null) {
    // Last-resort 1:1. Better than dropping data — but flag it.
    console.warn(
      `[fx-rates] Unsupported currency "${currency}"; falling back 1:1 to USD. ` +
        `Add it to FX_RATES_TO_USD if real spend lands in this currency.`,
    );
    return Math.round(amountCents);
  }
  return Math.round(amountCents * rate);
}

/**
 * Convenience: list every supported currency code.
 */
export function listSupportedCurrencies(): readonly string[] {
  return Object.keys(FX_RATES_TO_USD);
}
