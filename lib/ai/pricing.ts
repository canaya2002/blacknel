import type { AiModel } from './types';

/**
 * Per-model token pricing (Phase 7 / Commit 22).
 *
 * Values in **cents per million tokens** (so int math stays
 * lossless). Read by the adapter at the end of every
 * `.generate()` call to fill `ai_generations.cost_cents`.
 *
 * Source: Anthropic public pricing — Haiku 4.5 + Opus 4.7. Update
 * this table when prices change; the adapter never reads
 * pricing from anywhere else.
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
  // Haiku 4.5 — the workhorse. ~3× cheaper than Opus on both
  // input and output. Default for ~80% of skills.
  'claude-haiku-4-5': {
    inputCentsPerM: 80, // $0.80 / Mtok
    cachedInputCentsPerM: 8, // $0.08 / Mtok (90% discount)
    outputCentsPerM: 400, // $4.00 / Mtok
  },
  // Opus 4.7 — reserved for compliance cascade + crisis detection
  // where misjudgment cost exceeds the token premium.
  'claude-opus-4-7': {
    inputCentsPerM: 1500, // $15 / Mtok
    cachedInputCentsPerM: 150, // $1.50 / Mtok
    outputCentsPerM: 7500, // $75 / Mtok
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
