import 'server-only';

import { env } from '@/lib/env';
import { log } from '@/lib/log';

import { adapterOpenai } from './adapter-openai';
import { adapterReal } from './adapter-real';
import { ANTHROPIC_TO_OPENAI } from './model-routing';
import type { RawGeneration } from './provider';
import {
  AiError,
  type AiErrorCode,
  type AiRequest,
  type AnthropicModel,
} from './types';

/**
 * Primary (Anthropic) + fallback (OpenAI) router (C43c). Cross-cutting concerns
 * (dedup / rate-limit / budget / redaction / persistence) already ran ONCE in
 * the orchestrator before this is called — the router only picks a provider.
 *
 * Fallback fires ONLY on transient triggers, AFTER the primary has exhausted
 * its own retries: timeout / rate_limit / server_error / overloaded. It NEVER
 * fires on client_error (4xx) or a persistent schema_violation — switching
 * providers can't fix those. If both fail, the PRIMARY error propagates (the
 * original trigger / root cause; the fallback failure is logged).
 */

const FALLBACK_TRIGGERS: ReadonlyArray<AiErrorCode> = [
  'timeout',
  'rate_limit',
  'server_error',
  'overloaded',
];

function asAiError(err: unknown): AiError {
  return err instanceof AiError
    ? err
    : new AiError('server_error', String((err as Error)?.message ?? err));
}

export async function routeGeneration<TInput, TOutput>(
  req: AiRequest<TInput, TOutput>,
): Promise<RawGeneration<TOutput>> {
  try {
    return await adapterReal.generate(req);
  } catch (primaryErr) {
    const primary = asAiError(primaryErr);

    if (!FALLBACK_TRIGGERS.includes(primary.code)) {
      throw primary; // client_error / schema_violation → provider swap won't help
    }
    if (!env.OPENAI_API_KEY) {
      log.warn(
        { skill: req.skill, code: primary.code },
        'ai.fallback.skipped_no_openai_key',
      );
      throw primary;
    }

    // req.model is always an AnthropicModel on the primary path (skills only
    // pick Anthropic); map it to the OpenAI tier.
    const openaiModel =
      ANTHROPIC_TO_OPENAI[req.model as AnthropicModel] ?? 'gpt-5.4';
    log.warn(
      { skill: req.skill, primaryCode: primary.code, from: req.model, to: openaiModel },
      'ai.fallback.triggered',
    );

    try {
      const result = await adapterOpenai.generate({ ...req, model: openaiModel });
      log.info(
        { skill: req.skill, via: 'openai', model: openaiModel },
        'ai.fallback.served',
      );
      return result;
    } catch (fallbackErr) {
      const fb = asAiError(fallbackErr);
      log.error(
        { skill: req.skill, primaryCode: primary.code, fallbackCode: fb.code },
        'ai.fallback.failed',
      );
      // Both providers failed — surface the primary (root-cause) error.
      throw primary;
    }
  }
}
