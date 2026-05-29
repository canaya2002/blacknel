import type { AiModel } from './types';

/**
 * Per-model token pricing (Phase 7 / Commit 22).
 *
 * Values in **cents per million tokens** (so int math stays
 * lossless). Read by the adapter at the end of every
 * `.generate()` call to fill `ai_generations.cost_cents`.
 *
 * Source: Anthropic public pricing (C43a) — Haiku 4.5 + Sonnet 4.6 +
 * Opus 4.8. Update this table when prices change; the adapter never
 * reads pricing from anywhere else.
 *
 * **Cached input** is Anthropic's prompt-cache hit rate: 10% of
 * the regular input price (90% discount).
 *
 * **Cache write** is the first-call surcharge to warm the cache:
 * 125% of regular input. We track it but cost_cents on the row
 * uses `inputTokens × inputCentsPerM + cachedInputTokens ×
 * cachedInputCentsPerM`; the cache-write premium is amortized
 * across the subsequent hits.
 */

export interface ModelPricing {
  /** Cents per 1M input tokens (uncached). */
  readonly inputCentsPerM: number;
  /** Cents per 1M cached input tokens (Anthropic prompt cache hit). */
  readonly cachedInputCentsPerM: number;
  /** Cents per 1M output tokens. */
  readonly outputCentsPerM: number;
}

export const MODEL_PRICING: Readonly<Record<AiModel, ModelPricing>> = {
  // Haiku 4.5 — the workhorse. Default for ~80% of skills
  // (language/sentiment/intent/summaries/crisis + compliance baseline).
  'claude-haiku-4-5': {
    inputCentsPerM: 100, // $1.00 / Mtok
    cachedInputCentsPerM: 10, // $0.10 / Mtok (90% off input)
    outputCentsPerM: 500, // $5.00 / Mtok
  },
  // Sonnet 4.6 — quality tier for customer-facing copy
  // (caption, review_response).
  'claude-sonnet-4-6': {
    inputCentsPerM: 300, // $3.00 / Mtok
    cachedInputCentsPerM: 30, // $0.30 / Mtok
    outputCentsPerM: 1500, // $15.00 / Mtok
  },
  // Opus 4.8 — reserved for the compliance cascade (high/critical
  // baselines escalate) where misjudgment cost exceeds the premium.
  'claude-opus-4-8': {
    inputCentsPerM: 500, // $5.00 / Mtok
    cachedInputCentsPerM: 50, // $0.50 / Mtok
    outputCentsPerM: 2500, // $25.00 / Mtok
  },
  // OpenAI fallback (C43c). Rates may be fractional cents/Mtok — computeCostCents
  // ceils the final amount. cached = 10% of input (90% off).
  'gpt-5.4-mini': {
    inputCentsPerM: 75, // $0.75 / Mtok
    cachedInputCentsPerM: 7.5, // $0.075 / Mtok
    outputCentsPerM: 450, // $4.50 / Mtok
  },
  'gpt-5.4': {
    inputCentsPerM: 250, // $2.50 / Mtok
    cachedInputCentsPerM: 25, // $0.25 / Mtok
    outputCentsPerM: 1500, // $15.00 / Mtok
  },
};

export interface ComputeCostInput {
  readonly model: AiModel;
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly outputTokens: number;
}

/**
 * Cost in cents (integer, rounded up). Half-cent rounds UP so the
 * dashboard tracks a slight conservative upper bound.
 */
export function computeCostCents(input: ComputeCostInput): number {
  const p = MODEL_PRICING[input.model];
  const uncachedInput = Math.max(0, input.inputTokens - input.cachedInputTokens);
  const cost =
    (uncachedInput * p.inputCentsPerM) / 1_000_000 +
    (input.cachedInputTokens * p.cachedInputCentsPerM) / 1_000_000 +
    (input.outputTokens * p.outputCentsPerM) / 1_000_000;
  return Math.ceil(cost);
}

/**
 * Rough char-to-token estimator. Anthropic averages ~4 chars per
 * token for English / Spanish. Used by the mock adapter to
 * populate `inputTokens` / `outputTokens` for the audit row.
 * Phase 11 reads the real values from the API response.
 */
export function estimateTokensFromChars(chars: number): number {
  return Math.ceil(chars / 4);
}
