import { describe, expect, it } from 'vitest';

import {
  computeCostCents,
  estimateTokensFromChars,
  MODEL_PRICING,
} from '../../lib/ai/pricing';

describe('MODEL_PRICING', () => {
  it('Haiku < Sonnet < Opus across the board', () => {
    const haiku = MODEL_PRICING['claude-haiku-4-5'];
    const sonnet = MODEL_PRICING['claude-sonnet-4-6'];
    const opus = MODEL_PRICING['claude-opus-4-8'];
    expect(haiku.inputCentsPerM).toBeLessThan(sonnet.inputCentsPerM);
    expect(sonnet.inputCentsPerM).toBeLessThan(opus.inputCentsPerM);
    expect(haiku.outputCentsPerM).toBeLessThan(sonnet.outputCentsPerM);
    expect(sonnet.outputCentsPerM).toBeLessThan(opus.outputCentsPerM);
  });

  it('cached input is exactly 10% of regular input (90% discount) for all models', () => {
    for (const m of [
      'claude-haiku-4-5',
      'claude-sonnet-4-6',
      'claude-opus-4-8',
      'gpt-5.4-mini',
      'gpt-5.4',
    ] as const) {
      const p = MODEL_PRICING[m];
      expect(p.cachedInputCentsPerM * 10).toBe(p.inputCentsPerM);
    }
  });
});

describe('computeCostCents', () => {
  it('Haiku 1M input + 0 cached + 0 output → 100¢', () => {
    expect(
      computeCostCents({
        model: 'claude-haiku-4-5',
        inputTokens: 1_000_000,
        cachedInputTokens: 0,
        outputTokens: 0,
      }),
    ).toBe(100);
  });

  it('Haiku 0 input + 1M output → $5.00 (500¢)', () => {
    expect(
      computeCostCents({
        model: 'claude-haiku-4-5',
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 1_000_000,
      }),
    ).toBe(500);
  });

  it('cached input is billed at the cached rate, NOT charged twice', () => {
    // 1M total input, 800k cached, 200k uncached.
    // Cost = 200k × 100/M (uncached) + 800k × 10/M (cached) = 20 + 8 = 28
    const cost = computeCostCents({
      model: 'claude-haiku-4-5',
      inputTokens: 1_000_000,
      cachedInputTokens: 800_000,
      outputTokens: 0,
    });
    expect(cost).toBe(28);
  });

  it('Sonnet 1M input → 300¢ ($3)', () => {
    expect(
      computeCostCents({
        model: 'claude-sonnet-4-6',
        inputTokens: 1_000_000,
        cachedInputTokens: 0,
        outputTokens: 0,
      }),
    ).toBe(300);
  });

  it('Opus 1M input → 500¢ ($5)', () => {
    expect(
      computeCostCents({
        model: 'claude-opus-4-8',
        inputTokens: 1_000_000,
        cachedInputTokens: 0,
        outputTokens: 0,
      }),
    ).toBe(500);
  });

  it('rounds up (Math.ceil) for fractional cents', () => {
    // 1000 Haiku input tokens = 0.1¢ → rounds up to 1.
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
    ).toBe(10);
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
