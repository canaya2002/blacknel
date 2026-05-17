import type { z } from 'zod';

/**
 * Core types for the Claude SDK adapter (Phase 7 / Commit 22).
 *
 * Every AI-backed surface in Blacknel goes through `AiClient.generate`.
 * The interface is the same for the mock (Phase 7) and the real
 * (Phase 11) implementations; switching is `lib/ai/client.ts`
 * swapping which adapter is exported.
 *
 *   Server Action / skill module
 *     → aiClient.generate({ skill, model, systemPrompt, ... })
 *       → adapter-mock | adapter-real
 *         → persistence.writeGeneration({ ...meta })
 *         → DB row in `ai_generations`
 */

// ---------------------------------------------------------------------------
// Enum-mirror unions — these MUST match the pgEnum values in
// `lib/db/schema/_enums.ts` (and the migration). Mismatches surface
// as Drizzle TypeScript errors at compile time.
// ---------------------------------------------------------------------------

export type AiSkillKey =
  | 'compliance'
  | 'caption'
  | 'review_response'
  | 'language_detect'
  | 'sentiment'
  | 'intent'
  | 'crisis'
  | 'thread_summary'
  | 'review_summary';

export type AiActorType = 'user' | 'system';

/**
 * Anthropic model identifiers. Per the Commit 22 / regla-de-costo:
 *
 *   - `claude-haiku-4-5` is the default for ~80% of skills
 *     (~3× cheaper, ~2× faster than Opus).
 *   - `claude-opus-4-7` is reserved for skills where the risk of
 *     misclassification exceeds the marginal token cost:
 *     compliance (cascade pass), crisis detection.
 *
 * The model is selected per-skill by the skill module; callers
 * don't get to override (keeps cost predictable).
 */
export type AiModel = 'claude-haiku-4-5' | 'claude-opus-4-7';

// ---------------------------------------------------------------------------
// Request / response contract
// ---------------------------------------------------------------------------

/**
 * Per-call context the adapter records on `ai_generations` for
 * audit, billing, and entity-scoped queries. Every field that
 * helps identify "who / where / why" lives here.
 */
export interface AiContext {
  readonly orgId: string;
  /** Null for the system path (cron-driven scans). */
  readonly userId: string | null;
  readonly actorType: AiActorType;
  /** What the generation is about — drives the entity_type column. */
  readonly entityType:
    | 'inbox_message'
    | 'inbox_thread'
    | 'review'
    | 'post'
    | 'org'
    | 'brand';
  /** Null when the entity is the org itself. */
  readonly entityId: string | null;
  readonly brandId?: string | null;
  /** BCP-47 locale, e.g. `'es-MX'`. Surfaces in the system prompt. */
  readonly locale?: string;
}

/**
 * Hint to the adapter about whether the request is worth caching.
 *
 *   - `'always'`  — system prompt is stable and reused often; mark
 *                   it cacheable. Default for skill modules.
 *   - `'never'`   — one-off / sensitive content; skip the cache.
 *   - `'auto'`    — adapter decides based on system prompt length
 *                   (≥1024 chars → mark cacheable).
 */
export type CachingHint = 'always' | 'never' | 'auto';

export interface AiRequest<TInput, TOutput> {
  readonly skill: AiSkillKey;
  readonly model: AiModel;
  /**
   * The cacheable system prompt body. Constant per skill; the
   * adapter records its byte length for token estimation and
   * marks it with Anthropic `cache_control` when the cache hint
   * permits.
   */
  readonly systemPrompt: string;
  /**
   * Per-call user prompt. May reference `input` fields via plain
   * string interpolation done by the skill module before passing.
   */
  readonly userPrompt: string;
  /**
   * Structured input. Stored verbatim in `ai_generations.input`
   * (jsonb) so the audit trail captures exactly what we asked.
   * Sensitive fields should be redacted by the skill module
   * before passing.
   */
  readonly input: TInput;
  /**
   * Zod schema the adapter parses the response with. Real
   * adapter (Phase 11) loops up to 2× on `schema_violation`
   * errors before surfacing the failure.
   */
  readonly outputSchema: z.ZodType<TOutput>;
  readonly context: AiContext;
  readonly cachingHint?: CachingHint;
  /**
   * Explicit prompt version (e.g. `'v1'`, `'v2'`). Per the
   * Commit 22 / Ajuste 3 rule, every system prompt carries a
   * version constant; the adapter records it in
   * `input.promptVersion` for A/B testing and rollback.
   */
  readonly promptVersion: string;
}

export interface AiGenerationMeta {
  readonly generationId: string;
  readonly requestHash: string;
  readonly skill: AiSkillKey;
  readonly model: AiModel;
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly outputTokens: number;
  readonly costCents: number;
  readonly durationMs: number;
  /** True when adapter returned a previously-cached output. */
  readonly cacheHit: boolean;
  readonly via: 'mock' | 'real';
  readonly promptVersion: string;
}

export interface AiGeneration<TOutput> {
  readonly output: TOutput;
  readonly meta: AiGenerationMeta;
}

// ---------------------------------------------------------------------------
// Error contract
// ---------------------------------------------------------------------------

export type AiErrorCode =
  | 'rate_limit'
  | 'timeout'
  | 'server_error'
  | 'invalid_response'
  | 'schema_violation'
  | 'not_implemented';

export class AiError extends Error {
  readonly code: AiErrorCode;
  readonly meta?: Record<string, unknown>;
  constructor(code: AiErrorCode, message: string, meta?: Record<string, unknown>) {
    super(message);
    this.name = 'AiError';
    this.code = code;
    if (meta) this.meta = meta;
  }
}

// ---------------------------------------------------------------------------
// Adapter interface
// ---------------------------------------------------------------------------

export interface AiClient {
  generate<TInput, TOutput>(
    req: AiRequest<TInput, TOutput>,
  ): Promise<AiGeneration<TOutput>>;
}
