import { describe, expect, it } from 'vitest';

import {
  computeCostCents,
  estimateTokensFromChars,
  MODEL_PRICING,
} from '../../lib/ai/pricing';

describe('MODEL_PRICING', () => {
  it('Haiku is cheaper than Opus across the board', () => {
    const haiku = MODEL_PRICING['claude-haiku-4-5'];
    const opus = MODEL_PRICING['claude-opus-4-7'];
    expect(haiku.inputCentsPerM).toBeLessThan(opus.inputCentsPerM);
    expect(haiku.outputCentsPerM).toBeLessThan(opus.outputCentsPerM);
    expect(haiku.cachedInputCentsPerM).toBeLessThan(opus.cachedInputCentsPerM);
  });

  it('cached input is exactly 10% of regular input (Anthropic 90% discount)', () => {
    for (const m of ['claude-haiku-4-5', 'claude-opus-4-7'] as const) {
      const p = MODEL_PRICING[m];
      expect(p.cachedInputCentsPerM * 10).toBe(p.inputCentsPerM);
    }
  });
});

describe('computeCostCents', () => {
  it('Haiku 1M input + 0 cached + 0 output → 80¢', () => {
    expect(
      computeCostCents({
        model: 'claude-haiku-4-5',
        inputTokens: 1_000_000,
        cachedInputTokens: 0,
        outputTokens: 0,
      }),
    ).toBe(80);
  });

  it('Haiku 0 input + 1M output → $4.00 (400¢)', () => {
    expect(
      computeCostCents({
        model: 'claude-haiku-4-5',
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 1_000_000,
      }),
    ).toBe(400);
  });

  it('cached input is billed at the cached rate, NOT charged twice', () => {
    // 1M total input, 800k cached, 200k uncached.
    // Cost = 200k × 80/M (uncached) + 800k × 8/M (cached) = 16 + 6.4 = 22.4 → 23
    const cost = computeCostCents({
      model: 'claude-haiku-4-5',
      inputTokens: 1_000_000,
      cachedInputTokens: 800_000,
      outputTokens: 0,
    });
    expect(cost).toBe(23);
  });

  it('Opus 1M input → 1500¢ ($15)', () => {
    expect(
      computeCostCents({
        model: 'claude-opus-4-7',
        inputTokens: 1_000_000,
        cachedInputTokens: 0,
        outputTokens: 0,
      }),
    ).toBe(1500);
  });

  it('rounds up (Math.ceil) for fractional cents', () => {
    // 1000 Haiku input tokens = 0.08¢ → rounds up to 1.
    expect(
      computeCostCents({
        model: 'claude-haiku-4-5',
        inputTokens: 1000,
        cachedInputTokens: 0,
        outputTokens: 0,
      }),
    ).toBe(1);
  });

  it('cachedInputTokens > inputTokens is clamped to 0 uncached (defensive)', () => {
    expect(
      computeCostCents({
        model: 'claude-haiku-4-5',
        inputTokens: 0,
        cachedInputTokens: 1_000_000, // shouldn't happen but math still safe
        outputTokens: 0,
      }),
    ).toBe(8);
  });
});

describe('estimateTokensFromChars', () => {
  it('roughly chars / 4 rounded up', () => {
    expect(estimateTokensFromChars(0)).toBe(0);
    expect(estimateTokensFromChars(1)).toBe(1);
    expect(estimateTokensFromChars(4)).toBe(1);
    expect(estimateTokensFromChars(5)).toBe(2);
    expect(estimateTokensFromChars(400)).toBe(100);
  });
});
