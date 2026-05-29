import 'server-only';

import OpenAI from 'openai';

import { env } from '@/lib/env';

import { SDK_MODEL_ID } from './model-routing';
import { withRetry, withTimeout } from './policy';
import { computeCostCents } from './pricing';
import {
  JSON_ONLY_ADDENDUM,
  MAX_OUTPUT_TOKENS,
  RETRY_OPTS,
  TIMEOUT_MS,
  buildSystemText,
  tryParse,
  type RawGeneration,
  type RawProvider,
} from './provider';
import { AiError, type AiRequest } from './types';

/**
 * PURE OpenAI provider (C43c) — the fallback for adapter-real. Same
 * `RawProvider` contract: builds the request, calls OpenAI NON-streaming
 * (withTimeout + withRetry), parses + validates (one strict JSON-only retry,
 * else schema_violation), computes cost, maps errors to the SHARED AiError
 * taxonomy. The router passes a request whose `model` is ALREADY the OpenAI
 * model (mapped from the Anthropic tier) and whose `userPrompt` is ALREADY
 * redacted by the orchestrator. No cross-cutting concerns here.
 */

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!_client) {
    _client = new OpenAI({ apiKey: env.OPENAI_API_KEY ?? '' });
  }
  return _client;
}

/** Test seam — drop the cached client so a fresh SDK mock is picked up. */
export function _resetClientForTests(): void {
  _client = null;
}

/** Map an OpenAI SDK / network error to the shared AiError taxonomy. */
export function mapOpenaiError(err: unknown): AiError {
  if (err instanceof AiError) return err;
  const e = err as { status?: number; name?: string; message?: string };
  const status = e?.status;
  const message = (e?.message ?? 'OpenAI API error').slice(0, 300);

  if (e?.name === 'APIConnectionTimeoutError' || /timeout/i.test(message)) {
    return new AiError('timeout', message);
  }
  if (status === 429) return new AiError('rate_limit', message);
  if (typeof status === 'number' && status >= 500) {
    return new AiError('server_error', message);
  }
  if (status === 400 || status === 401 || status === 403) {
    return new AiError('client_error', message);
  }
  return new AiError('server_error', message);
}

interface OpenAiUsage {
  readonly prompt_tokens?: number;
  readonly completion_tokens?: number;
  readonly prompt_tokens_details?: { readonly cached_tokens?: number } | null;
}

interface InvokeResult {
  readonly text: string;
  readonly usage: OpenAiUsage | null | undefined;
}

export const adapterOpenai: RawProvider = {
  async generate<TInput, TOutput>(
    req: AiRequest<TInput, TOutput>,
  ): Promise<RawGeneration<TOutput>> {
    const startMs = Date.now();

    if (!env.OPENAI_API_KEY) {
      throw new AiError('client_error', 'OPENAI_API_KEY is not set.');
    }

    const baseSystem = buildSystemText(req.systemPrompt);
    const client = getClient();

    const invoke = async (system: string): Promise<InvokeResult> => {
      const resp = await withTimeout(
        () =>
          withRetry(
            () =>
              client.chat.completions
                .create({
                  model: SDK_MODEL_ID[req.model],
                  max_completion_tokens: MAX_OUTPUT_TOKENS,
                  messages: [
                    { role: 'system', content: system },
                    { role: 'user', content: req.userPrompt },
                  ],
                })
                .catch((err: unknown) => {
                  throw mapOpenaiError(err);
                }),
            RETRY_OPTS,
          ),
        TIMEOUT_MS,
      );
      return {
        text: resp.choices[0]?.message?.content ?? '',
        usage: resp.usage,
      };
    };

    let result = await invoke(baseSystem);
    let parsed = tryParse<TOutput>(result.text, req.outputSchema);
    if (!parsed.ok) {
      result = await invoke(`${baseSystem}\n\n${JSON_ONLY_ADDENDUM}`);
      parsed = tryParse<TOutput>(result.text, req.outputSchema);
      if (!parsed.ok) {
        throw new AiError(
          'schema_violation',
          `OpenAI output for skill '${req.skill}' failed schema validation after one strict retry.`,
        );
      }
    }

    const usage = result.usage;
    const cachedInputTokens = usage?.prompt_tokens_details?.cached_tokens ?? 0;
    // OpenAI's prompt_tokens already INCLUDES cached tokens.
    const inputTokens = usage?.prompt_tokens ?? 0;
    const outputTokens = usage?.completion_tokens ?? 0;

    return {
      output: parsed.data,
      model: req.model, // already the OpenAI model — the router mapped it
      via: 'openai',
      inputTokens,
      cachedInputTokens,
      outputTokens,
      costCents: computeCostCents({
        model: req.model,
        inputTokens,
        cachedInputTokens,
        outputTokens,
      }),
      durationMs: Date.now() - startMs,
    };
  },
};
