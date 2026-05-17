import 'server-only';

import { z } from 'zod';

import {
  _clearLruForTests,
  computeRequestHash,
  getCached,
  setCached,
} from './cache';
import { mockCaption, type CaptionMockInput } from './mock-bodies/caption';
import { mockCompliance, type ComplianceMockInput } from './mock-bodies/compliance';
import { mockCrisis, type CrisisMockInput } from './mock-bodies/crisis';
import {
  mockIntent,
  type IntentMockInput,
} from './mock-bodies/intent';
import {
  mockLanguageDetect,
  type LanguageDetectMockInput,
} from './mock-bodies/language-detect';
import {
  mockReviewResponse,
  type ReviewResponseMockInput,
} from './mock-bodies/review-response';
import {
  mockReviewSummary,
  type ReviewSummaryMockInput,
} from './mock-bodies/review-summary';
import {
  mockSentiment,
  type SentimentMockInput,
} from './mock-bodies/sentiment';
import {
  mockThreadSummary,
  type ThreadSummaryMockInput,
} from './mock-bodies/thread-summary';
import { findRecentByHash, writeGeneration } from './persistence';
import { computeCostCents, estimateTokensFromChars } from './pricing';
import { PROMPT_REGISTRY } from './prompts';
import {
  AiError,
  type AiClient,
  type AiGeneration,
  type AiGenerationMeta,
  type AiRequest,
  type AiSkillKey,
} from './types';

/**
 * Mock implementation of `AiClient` (Phase 7 / Commit 22).
 *
 * Branches on `skill` and runs the matching mock body. Every call:
 *
 *   1. Computes the canonical request hash.
 *   2. Checks the in-process LRU for a dedup hit (synchronous).
 *   3. Falls back to a DB lookup via `findRecentByHash` (5-min
 *      window) for cross-process dedup.
 *   4. On miss: runs the mock body, parses output through the
 *      schema, writes an `ai_generations` row.
 *   5. Caches the output in the LRU for the next call.
 *
 * **Token accounting** is heuristic in mock — char/4 estimate.
 * **Cost** is computed via `pricing.ts` and recorded honestly
 * (even though the dev system never actually pays).
 *
 * **The 9 skill switch is exhaustive** — adding a new skill
 * MUST land here OR TypeScript will refuse to build.
 */

const SCHEMA_ERROR_PATH_MAX = 80;

export const adapterMock: AiClient = {
  async generate<TInput, TOutput>(
    req: AiRequest<TInput, TOutput>,
  ): Promise<AiGeneration<TOutput>> {
    const startMs = Date.now();
    const requestHash = computeRequestHash({
      skill: req.skill,
      model: req.model,
      systemPrompt: req.systemPrompt,
      userPrompt: req.userPrompt,
      input: req.input,
      promptVersion: req.promptVersion,
    });

    // 1. In-process dedup.
    const lruHit = getCached(req.context, requestHash);
    if (lruHit !== undefined) {
      const parsed = req.outputSchema.safeParse(lruHit);
      if (parsed.success) {
        return {
          output: parsed.data,
          meta: buildMeta({
            generationId: 'lru-cache',
            req,
            requestHash,
            inputTokens: 0,
            cachedInputTokens: 0,
            outputTokens: 0,
            costCents: 0,
            durationMs: Date.now() - startMs,
            cacheHit: true,
          }),
        };
      }
      // Stale schema in LRU — fall through to DB lookup + fresh body.
    }

    // 2. DB dedup (handles cross-process / restart cases).
    const dbHit = await findRecentByHash(req.context.orgId, requestHash);
    if (dbHit) {
      const parsed = req.outputSchema.safeParse(dbHit.output);
      if (parsed.success) {
        setCached(req.context, requestHash, parsed.data);
        return {
          output: parsed.data,
          meta: {
            ...dbHit.meta,
            durationMs: Date.now() - startMs,
            cacheHit: true,
            via: 'mock',
          },
        };
      }
      // Stale row — fall through.
    }

    // 3. Fresh body call. Switch on skill.
    let output: unknown;
    try {
      output = runMockBody(req.skill, req.input);
    } catch (cause) {
      throw new AiError(
        'server_error',
        `Mock body for skill '${req.skill}' threw.`,
        { cause: (cause as Error).message },
      );
    }

    // 4. Validate against the caller's schema. A mismatch is a
    //    bug in the mock body or in the schema — surface loudly.
    const parsed = req.outputSchema.safeParse(output);
    if (!parsed.success) {
      const flat = parsed.error.flatten();
      throw new AiError(
        'schema_violation',
        `Mock body output for skill '${req.skill}' violates the declared output schema.`,
        { issues: flat, sample: shortStringify(output) },
      );
    }

    // 5. Token / cost accounting. Mock is heuristic.
    const inputTokens = estimateTokensFromChars(
      req.systemPrompt.length + req.userPrompt.length,
    );
    // Prompt cache: mock assumes the system prompt is cached if
    // `cachingHint !== 'never'` AND the prompt is ≥1024 chars
    // AND we've seen this hash within the dedup window. The DB
    // lookup above already handled that case — so on cache miss
    // we report 0 cached tokens. Phase 11's real adapter reads
    // the actual count from the API response.
    const cachedInputTokens = 0;
    const outputTokens = estimateTokensFromChars(JSON.stringify(parsed.data).length);
    const costCents = computeCostCents({
      model: req.model,
      inputTokens,
      cachedInputTokens,
      outputTokens,
    });

    const persisted = await writeGeneration({
      orgId: req.context.orgId,
      userId: req.context.userId,
      actorType: req.context.actorType,
      skill: req.skill,
      model: req.model,
      requestHash,
      inputTokens,
      cachedInputTokens,
      outputTokens,
      costCents,
      durationMs: Date.now() - startMs,
      cacheHit: false,
      entityType: req.context.entityType,
      entityId: req.context.entityId,
      // Record promptVersion in the input jsonb (Ajuste 3).
      input: {
        promptVersion: req.promptVersion,
        via: 'mock',
        // The skill-specific input shape goes here too so the
        // dashboard can show what we asked.
        request: stringifySafely(req.input),
      },
      output: parsed.data as unknown as Record<string, unknown>,
    });

    setCached(req.context, requestHash, parsed.data);

    return {
      output: parsed.data,
      meta: buildMeta({
        generationId: persisted.generationId,
        req,
        requestHash,
        inputTokens,
        cachedInputTokens,
        outputTokens,
        costCents,
        durationMs: Date.now() - startMs,
        cacheHit: false,
      }),
    };
  },
};

// ---------------------------------------------------------------------------
// Skill dispatch — exhaustive switch over AiSkillKey
// ---------------------------------------------------------------------------

function runMockBody(skill: AiSkillKey, input: unknown): unknown {
  switch (skill) {
    case 'compliance':
      return mockCompliance(input as ComplianceMockInput);
    case 'caption':
      return mockCaption(input as CaptionMockInput);
    case 'review_response':
      return mockReviewResponse(input as ReviewResponseMockInput);
    case 'language_detect':
      return mockLanguageDetect(input as LanguageDetectMockInput);
    case 'sentiment':
      return mockSentiment(input as SentimentMockInput);
    case 'intent':
      return mockIntent(input as IntentMockInput);
    case 'crisis':
      return mockCrisis(input as CrisisMockInput);
    case 'thread_summary':
      return mockThreadSummary(input as ThreadSummaryMockInput);
    case 'review_summary':
      return mockReviewSummary(input as ReviewSummaryMockInput);
    default: {
      // Exhaustiveness check — TS errors if a new skill is added
      // without a matching case.
      const _exhaustive: never = skill;
      throw new AiError(
        'server_error',
        `Unknown skill in mock dispatch: ${_exhaustive as string}.`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Meta builders
// ---------------------------------------------------------------------------

interface BuildMetaInput<TIn, TOut> {
  readonly generationId: string;
  readonly req: AiRequest<TIn, TOut>;
  readonly requestHash: string;
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly outputTokens: number;
  readonly costCents: number;
  readonly durationMs: number;
  readonly cacheHit: boolean;
}

function buildMeta<TIn, TOut>(b: BuildMetaInput<TIn, TOut>): AiGenerationMeta {
  return {
    generationId: b.generationId,
    requestHash: b.requestHash,
    skill: b.req.skill,
    model: b.req.model,
    inputTokens: b.inputTokens,
    cachedInputTokens: b.cachedInputTokens,
    outputTokens: b.outputTokens,
    costCents: b.costCents,
    durationMs: b.durationMs,
    cacheHit: b.cacheHit,
    via: 'mock',
    promptVersion: b.req.promptVersion,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stringifySafely(v: unknown): Record<string, unknown> {
  try {
    if (v === null || typeof v !== 'object') return { value: v };
    return v as Record<string, unknown>;
  } catch {
    return { value: '<unserializable>' };
  }
}

function shortStringify(v: unknown): string {
  try {
    return JSON.stringify(v).slice(0, SCHEMA_ERROR_PATH_MAX);
  } catch {
    return '<unserializable>';
  }
}

// Touch unused imports to keep them live for downstream skills.
void z;
void PROMPT_REGISTRY;

// Re-export the test seam so tests can clear cache between runs.
export { _clearLruForTests };
