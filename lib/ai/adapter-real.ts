import 'server-only';

import Anthropic from '@anthropic-ai/sdk';

import { env } from '@/lib/env';

import { SDK_MODEL_ID } from './model-routing';
import { computeCostCents } from './pricing';
import { withRetry, withTimeout } from './policy';
import {
  CACHE_MIN_PROMPT_CHARS,
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
 * PURE Anthropic provider (C43a, refactored in C43c). Same `RawProvider`
 * contract as adapter-openai. Builds the request, calls Anthropic
 * NON-streaming (withTimeout + withRetry), parses + validates against the
 * skill schema (one strict "JSON only" retry, else schema_violation), computes
 * cost from real usage, and returns a `RawGeneration`. No dedup / redaction /
 * rate-limit / budget / persistence — those run once in the orchestrator. The
 * `req.userPrompt` it receives is ALREADY redacted by the orchestrator.
 */

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY ?? '' });
  }
  return _client;
}

/** Test seam — drop the cached client so a fresh SDK mock is picked up. */
export function _resetClientForTests(): void {
  _client = null;
}

/**
 * Map an Anthropic SDK / network error to an `AiError`. Status drives the
 * code; the codes feed `withRetry` and the router's fallback triggers
 * (rate_limit/overloaded/server_error/timeout → fall back; client_error →
 * do not).
 */
export function mapAnthropicError(err: unknown): AiError {
  if (err instanceof AiError) return err;
  const e = err as {
    status?: number;
    name?: string;
    message?: string;
    error?: { type?: string } | null;
  };
  const status = e?.status;
  const type = e?.error?.type;
  const message = (e?.message ?? 'Anthropic API error').slice(0, 300);

  if (e?.name === 'APIConnectionTimeoutError' || /timeout/i.test(message)) {
    return new AiError('timeout', message);
  }
  if (status === 429) return new AiError('rate_limit', message);
  if (status === 529 || type === 'overloaded_error') {
    return new AiError('overloaded', message);
  }
  if (typeof status === 'number' && status >= 500) {
    return new AiError('server_error', message);
  }
  if (status === 400 || status === 401 || status === 403) {
    return new AiError('client_error', message);
  }
  return new AiError('server_error', message);
}

function extractText(resp: Anthropic.Message): string {
  return resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

interface InvokeResult {
  readonly text: string;
  readonly usage: Anthropic.Usage;
}

export const adapterReal: RawProvider = {
  async generate<TInput, TOutput>(
    req: AiRequest<TInput, TOutput>,
  ): Promise<RawGeneration<TOutput>> {
    const startMs = Date.now();

    if (!env.ANTHROPIC_API_KEY) {
      throw new AiError('client_error', 'ANTHROPIC_API_KEY is not set.');
    }

    const systemContent = buildSystemText(req.systemPrompt);
    const cacheable =
      req.cachingHint !== 'never' &&
      systemContent.length >= CACHE_MIN_PROMPT_CHARS;

    const baseSystem: Anthropic.TextBlockParam[] = [
      {
        type: 'text',
        text: systemContent,
        ...(cacheable ? { cache_control: { type: 'ephemeral' } } : {}),
      },
    ];

    const client = getClient();

    const invoke = async (
      system: Anthropic.TextBlockParam[],
    ): Promise<InvokeResult> => {
      const resp = await withTimeout(
        () =>
          withRetry(
            () =>
              client.messages
                .create({
                  model: SDK_MODEL_ID[req.model],
                  max_tokens: MAX_OUTPUT_TOKENS,
                  system,
                  messages: [{ role: 'user', content: req.userPrompt }],
                })
                .catch((err: unknown) => {
                  throw mapAnthropicError(err);
                }),
            RETRY_OPTS,
          ),
        TIMEOUT_MS,
      );
      return { text: extractText(resp), usage: resp.usage };
    };

    let result = await invoke(baseSystem);
    let parsed = tryParse<TOutput>(result.text, req.outputSchema);
    if (!parsed.ok) {
      // One stricter retry; a second failure is a (non-fallback) schema_violation.
      result = await invoke([
        ...baseSystem,
        { type: 'text', text: JSON_ONLY_ADDENDUM },
      ]);
      parsed = tryParse<TOutput>(result.text, req.outputSchema);
      if (!parsed.ok) {
        throw new AiError(
          'schema_violation',
          `Anthropic output for skill '${req.skill}' failed schema validation after one strict retry.`,
        );
      }
    }

    const usage = result.usage;
    const cachedInputTokens = usage.cache_read_input_tokens ?? 0;
    const inputTokens =
      (usage.input_tokens ?? 0) +
      cachedInputTokens +
      (usage.cache_creation_input_tokens ?? 0);
    const outputTokens = usage.output_tokens ?? 0;

    return {
      output: parsed.data,
      model: req.model,
      via: 'real',
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
