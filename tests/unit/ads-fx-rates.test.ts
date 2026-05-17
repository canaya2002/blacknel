import { describe, expect, it, vi } from 'vitest';

import {
  FX_RATES_AS_OF,
  FX_RATES_TO_USD,
  listSupportedCurrencies,
  toUsdCents,
} from '../../lib/ads/fx-rates';

describe('lib/ads/fx-rates — Commit 28 / Ajuste 1', () => {
  it('USD is the 1.0 anchor so spend_cents == spend_usd_cents for USD accounts', () => {
    expect(FX_RATES_TO_USD.USD).toBe(1.0);
    expect(toUsdCents(12345, 'USD')).toBe(12345);
  });

  it('EUR converts using the rate table and rounds to the nearest cent', () => {
    // 1 EUR cent = FX_RATES_TO_USD.EUR USD cents (because both
    // sides are in cents — the rate is dimensionless).
    const eur = FX_RATES_TO_USD.EUR!;
    expect(toUsdCents(10000, 'EUR')).toBe(Math.round(10000 * eur));
    // Currency code is case-insensitive
    expect(toUsdCents(10000, 'eur')).toBe(toUsdCents(10000, 'EUR'));
  });

  it('unsupported currency falls back 1:1 to USD and emits one console.warn', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(toUsdCents(500, 'XYZ')).toBe(500);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(String(spy.mock.calls[0]?.[0])).toContain('Unsupported currency');
    } finally {
      spy.mockRestore();
    }
  });

  it('non-finite input returns 0 instead of NaN', () => {
    expect(toUsdCents(Number.NaN, 'USD')).toBe(0);
    expect(toUsdCents(Number.POSITIVE_INFINITY, 'USD')).toBe(0);
  });

  it('FX_RATES_AS_OF is a parseable ISO date', () => {
    expect(new Date(FX_RATES_AS_OF).toString()).not.toBe('Invalid Date');
    expect(listSupportedCurrencies()).toEqual(Object.keys(FX_RATES_TO_USD));
  });
});
