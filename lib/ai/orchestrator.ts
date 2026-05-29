import 'server-only';

import { log } from '@/lib/log';

import { assertWithinBudget, planCodeForOrg, recordGeneration } from './budget';
import { computeRequestHash, getCached, setCached } from './cache';
import { writeGeneration } from './persistence';
import type { GenerationVia } from './provider';
import { assertWithinRateLimit } from './rate-limit';
import { redactPii } from './redact';
import { routeGeneration } from './router';
import {
  AiError,
  type AiGeneration,
  type AiGenerationMeta,
  type AiModel,
  type AiRequest,
} from './types';

/**
 * Real-AI orchestrator (C43c). Owns ALL cross-cutting concerns so each runs
 * EXACTLY ONCE per logical generation, regardless of how many providers the
 * router tries:
 *
 *   dedup (cache hit = free, returns) → rate-limit (consume) → budget (count +
 *   cost ceiling) → redact → router(primary→fallback) → persist metrics +
 *   recordGeneration + cache write.
 *
 * The raw providers (adapter-real / adapter-openai) stay pure — they never see
 * a limit/redaction/persistence concern. `generateReal` IS the real-path
 * `AiClient.generate`; client.ts swaps it in for adapter-mock when the gate is
 * open. Persists METRICS ONLY (no prompt/output content — LFPDPPP/GDPR).
 */
export async function generateReal<TInput, TOutput>(
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

  const isCascade =
    typeof req.parentGenerationId === 'string' &&
    req.parentGenerationId.length > 0;

  // 1. In-process dedup (free). A cache hit returns BEFORE consuming any
  // rate-limit token or budget — no spend, no count.
  if (!isCascade) {
    const hit = getCached(req.context, requestHash);
    if (hit) {
      const parsed = req.outputSchema.safeParse(hit.output);
      if (parsed.success) {
        return {
          output: parsed.data,
          meta: buildMeta({
            generationId: hit.generationId,
            req,
            requestHash,
            model: req.model,
            via: 'real',
            inputTokens: 0,
            cachedInputTokens: 0,
            outputTokens: 0,
            costCents: 0,
            durationMs: Date.now() - startMs,
            cacheHit: true,
          }),
        };
      }
    }
  }

  // 2. Cross-cutting guards, ONCE, in order: rate-limit → budget → redact.
  const plan = await planCodeForOrg(req.context.orgId);
  await assertWithinRateLimit(req.context.orgId, plan);
  await assertWithinBudget(req.context.orgId, plan);
  const redactedReq: AiRequest<TInput, TOutput> = {
    ...req,
    userPrompt: redactPii(req.userPrompt),
  };

  // 3. Provider router (Anthropic primary → OpenAI fallback).
  let raw;
  try {
    raw = await routeGeneration(redactedReq);
  } catch (err) {
    const aiErr =
      err instanceof AiError ? err : new AiError('server_error', String(err));
    await persistErrorRow(req, requestHash, aiErr, Date.now() - startMs);
    log.error(
      { skill: req.skill, model: req.model, code: aiErr.code },
      'ai.generation.failed',
    );
    throw aiErr;
  }

  // 4. Persist METRICS ONLY with the SERVING provider's model/cost. Then count
  // + cache — each exactly once.
  const persisted = await writeGeneration({
    orgId: req.context.orgId,
    userId: req.context.userId,
    actorType: req.context.actorType,
    skill: req.skill,
    model: raw.model,
    requestHash,
    inputTokens: raw.inputTokens,
    cachedInputTokens: raw.cachedInputTokens,
    outputTokens: raw.outputTokens,
    costCents: raw.costCents,
    durationMs: raw.durationMs,
    cacheHit: false,
    entityType: req.context.entityType,
    entityId: req.context.entityId,
    ...(req.parentGenerationId
      ? { parentGenerationId: req.parentGenerationId }
      : {}),
    input: { promptVersion: req.promptVersion, via: raw.via },
    output: {},
  });

  // Best-effort: a counter-write failure must not fail a successful (paid)
  // generation.
  try {
    await recordGeneration(req.context.orgId);
  } catch (err) {
    log.error(
      { skill: req.skill, err: (err as Error).message },
      'ai.generation.budget_count_failed',
    );
  }

  if (!isCascade) {
    setCached(req.context, requestHash, raw.output, persisted.generationId);
  }

  log.info(
    {
      skill: req.skill,
      model: raw.model,
      via: raw.via,
      inputTokens: raw.inputTokens,
      cachedInputTokens: raw.cachedInputTokens,
      outputTokens: raw.outputTokens,
      costCents: raw.costCents,
      durationMs: raw.durationMs,
    },
    'ai.served',
  );

  return {
    output: raw.output,
    meta: buildMeta({
      generationId: persisted.generationId,
      req,
      requestHash,
      model: raw.model,
      via: raw.via,
      inputTokens: raw.inputTokens,
      cachedInputTokens: raw.cachedInputTokens,
      outputTokens: raw.outputTokens,
      costCents: raw.costCents,
      durationMs: Date.now() - startMs,
      cacheHit: false,
    }),
  };
}

// ---------------------------------------------------------------------------
// Error persistence (metrics only) + meta builder
// ---------------------------------------------------------------------------

async function persistErrorRow<TIn, TOut>(
  req: AiRequest<TIn, TOut>,
  requestHash: string,
  err: AiError,
  durationMs: number,
): Promise<void> {
  try {
    await writeGeneration({
      orgId: req.context.orgId,
      userId: req.context.userId,
      actorType: req.context.actorType,
      skill: req.skill,
      model: req.model,
      requestHash,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      costCents: 0,
      durationMs,
      cacheHit: false,
      entityType: req.context.entityType,
      entityId: req.context.entityId,
      ...(req.parentGenerationId
        ? { parentGenerationId: req.parentGenerationId }
        : {}),
      input: { promptVersion: req.promptVersion, via: 'real' },
      output: {},
      errorCode: err.code,
      errorMessage: err.message.slice(0, 500),
    });
  } catch {
    // An audit-write failure must not mask the original AiError.
  }
}

interface BuildMetaInput<TIn, TOut> {
  readonly generationId: string;
  readonly req: AiRequest<TIn, TOut>;
  readonly requestHash: string;
  readonly model: AiModel;
  readonly via: GenerationVia;
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
    model: b.model,
    inputTokens: b.inputTokens,
    cachedInputTokens: b.cachedInputTokens,
    outputTokens: b.outputTokens,
    costCents: b.costCents,
    durationMs: b.durationMs,
    cacheHit: b.cacheHit,
    via: b.via,
    promptVersion: b.req.promptVersion,
    parentGenerationId: b.req.parentGenerationId ?? null,
  };
}
