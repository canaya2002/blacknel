import { describe, expect, it } from 'vitest';

import {
  ACCOUNT_ERROR_MIN_DURATION_MS,
  CTR_DROP_MIN_CLICKS,
  CTR_DROP_MIN_IMPRESSIONS,
  evaluateAdsAlerts,
  SPEND_SPIKE_MIN_MEDIAN_USD_CENTS,
} from '../../lib/ads/alerts';

/**
 * Ajuste 1 floor tests — small accounts don't trip alerts.
 *
 * The heuristic is pure; tests pin every input including `now`
 * so the eval is deterministic.
 */

const NOW = new Date('2026-05-17T12:00:00Z');

function baseInput(overrides: Partial<Parameters<typeof evaluateAdsAlerts>[0]>) {
  return {
    baseline7d: {
      impressions: 0,
      clicks: 0,
      medianDailySpendUsdCents: 0,
    },
    today: { impressions: 0, clicks: 0, spendUsdCents: 0 },
    accountStatus: 'connected' as const,
    errorSince: null,
    now: NOW,
    ...overrides,
  };
}

describe('Ajuste 1 — statistical floors', () => {
  it('small account (< 1000 impressions baseline) does NOT trip CTR-drop', () => {
    const signals = evaluateAdsAlerts(
      baseInput({
        baseline7d: {
          impressions: 500, // below floor
          clicks: 50,
          medianDailySpendUsdCents: 0,
        },
        today: { impressions: 100, clicks: 0, spendUsdCents: 0 }, // CTR=0 → "drop"
      }),
    );
    expect(signals.find((s) => s.kind === 'ctr_drop')).toBeUndefined();
  });

  it('exactly-at-floor account WITH a 60% CTR drop DOES trip', () => {
    const signals = evaluateAdsAlerts(
      baseInput({
        baseline7d: {
          impressions: CTR_DROP_MIN_IMPRESSIONS, // 1000
          clicks: CTR_DROP_MIN_CLICKS, // 20  → 2% baseline CTR
          medianDailySpendUsdCents: 0,
        },
        today: {
          impressions: 1000,
          clicks: 8, // 0.8% CTR — well below 0.5x of 2%
          spendUsdCents: 0,
        },
      }),
    );
    const ctr = signals.find((s) => s.kind === 'ctr_drop');
    expect(ctr).toBeDefined();
  });

  it('low baseline CTR (< 0.5%) does NOT trip even if it halves', () => {
    const signals = evaluateAdsAlerts(
      baseInput({
        baseline7d: {
          impressions: 50_000,
          clicks: 100, // 0.2% CTR — below 0.5% floor
          medianDailySpendUsdCents: 0,
        },
        today: {
          impressions: 50_000,
          clicks: 25, // 0.05% — half of baseline
          spendUsdCents: 0,
        },
      }),
    );
    expect(signals.find((s) => s.kind === 'ctr_drop')).toBeUndefined();
  });

  it('spend spike: under $5/day median does NOT trip', () => {
    const signals = evaluateAdsAlerts(
      baseInput({
        baseline7d: {
          impressions: 0,
          clicks: 0,
          medianDailySpendUsdCents: SPEND_SPIKE_MIN_MEDIAN_USD_CENTS - 1, // $4.99
        },
        today: { impressions: 0, clicks: 0, spendUsdCents: 50_000 }, // huge today
      }),
    );
    expect(signals.find((s) => s.kind === 'spend_spike')).toBeUndefined();
  });

  it('spend spike: median ≥ $5 AND today > 2× DOES trip', () => {
    const signals = evaluateAdsAlerts(
      baseInput({
        baseline7d: {
          impressions: 0,
          clicks: 0,
          medianDailySpendUsdCents: 1000, // $10
        },
        today: { impressions: 0, clicks: 0, spendUsdCents: 3000 }, // $30 (3×)
      }),
    );
    expect(signals.find((s) => s.kind === 'spend_spike')).toBeDefined();
  });

  it('account_error always trips after 24h, no floor', () => {
    const errorSince = new Date(
      NOW.getTime() - (ACCOUNT_ERROR_MIN_DURATION_MS + 1000),
    );
    const signals = evaluateAdsAlerts(
      baseInput({
        accountStatus: 'error',
        errorSince,
      }),
    );
    expect(signals.find((s) => s.kind === 'account_error')).toBeDefined();
  });

  it('account_error before 24h does NOT trip', () => {
    const errorSince = new Date(NOW.getTime() - 6 * 60 * 60_000); // 6h
    const signals = evaluateAdsAlerts(
      baseInput({
        accountStatus: 'error',
        errorSince,
      }),
    );
    expect(signals.find((s) => s.kind === 'account_error')).toBeUndefined();
  });

  it('CTR drop only counts when today_ctr < baseline × 0.5', () => {
    // Baseline 2%, today 1.5% — only 25% drop, not enough.
    const signals = evaluateAdsAlerts(
      baseInput({
        baseline7d: {
          impressions: 10_000,
          clicks: 200, // 2%
          medianDailySpendUsdCents: 0,
        },
        today: { impressions: 10_000, clicks: 150, spendUsdCents: 0 }, // 1.5%
      }),
    );
    expect(signals.find((s) => s.kind === 'ctr_drop')).toBeUndefined();
  });
});
