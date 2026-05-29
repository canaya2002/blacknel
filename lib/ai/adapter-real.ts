import 'server-only';

import {
  AiError,
  type AiClient,
  type AiGeneration,
  type AiRequest,
} from './types';

/**
 * Real Anthropic adapter — placeholder until Phase 11.
 *
 * The body is intentionally `throw new AiError('not_implemented', ...)`
 * so a Phase-7-through-10 accidental swap of `client.ts` surfaces
 * loudly instead of going silently wrong.
 *
 * # Phase 11 cutover (~50-80 LOC body)
 *
 *   1. Add the SDK dependency:
 *        `pnpm add @anthropic-ai/sdk`
 *
 *   2. Import + instantiate the client (server-only, never
 *      exposed to the browser bundle):
 *
 *        ```ts
 *        import Anthropic from '@anthropic-ai/sdk';
 *        import { env } from '@/lib/env';
 *        const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
 *        ```
 *
 *   3. Implement `.generate()`:
 *
 *        - Build the messages array:
 *            `[{ role: 'system', content: [{ type: 'text', text: req.systemPrompt, cache_control: ... }] },
 *              { role: 'user',   content: req.userPrompt }]`
 *        - When `req.cachingHint !== 'never'` AND
 *          `req.systemPrompt.length >= 1024 * 4` chars (≈1024 tokens),
 *          attach `cache_control: { type: 'ephemeral' }` to the
 *          system message. 5-min TTL, 90% discount on hits.
 *        - Compose with `withTimeout(15_000)` + `withRetry({ max: 3,
 *          backoffMs: [500, 2000, 6000] })` from `./policy`.
 *        - Parse the response via `req.outputSchema.safeParse()` —
 *          on failure, retry once with a stricter "return JSON only"
 *          system addendum; second failure → AiError 'schema_violation'.
 *        - Compute tokens + cost via `lib/ai/pricing.ts`.
 *        - Persist via `lib/ai/persistence.ts.writeGeneration`.
 *
 *   4. Add `ANTHROPIC_API_KEY` to `lib/env.ts` (required in
 *      production, optional in dev — falls back to mock when
 *      missing).
 *
 *   5. Update `client.ts` to export this adapter.
 *
 *   6. Run the test in `tests/integration/ai-adapter-real-swap.test.ts`
 *      (already exists — exercises the swap by stubbing the
 *      Anthropic client). All Phase-7 callers should keep
 *      passing without modification.
 *
 * # Fallback chain (Phase 11)
 *
 * Per `lib/ai/policy.ts`:
 *   - `rate_limit`         → exponential backoff (500ms / 2s / 6s).
 *   - `timeout` (Opus)     → degrade to Haiku with the same prompt.
 *   - `invalid_response`   → 1 retry with strict JSON addendum.
 *   - 3 failures           → surface AiError; caller decides UX
 *                            (typical: fall back to the heuristic
 *                            stub equivalent).
 */
export const adapterReal: AiClient = {
  async generate<TInput, TOutput>(
    _req: AiRequest<TInput, TOutput>,
  ): Promise<AiGeneration<TOutput>> {
    throw new AiError(
      'not_implemented',
      'Real Anthropic adapter lands in Phase 11 — see lib/ai/adapter-real.ts JSDoc for the migration steps.',
      { phase: 11 },
    );
  },
};
