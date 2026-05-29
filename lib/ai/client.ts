import 'server-only';

import { env } from '../env';

import { adapterMock } from './adapter-mock';
import { adapterReal } from './adapter-real';
import { isRealAiEnabled } from './runtime-flag';
import type { AiClient, AiGeneration, AiRequest } from './types';

/**
 * AI adapter selection (Phase 11 / C43a).
 *
 * The exported `aiClient` keeps the SAME `AiClient` shape, so the ~9 skill
 * modules that call `aiClient.generate(...)` are unchanged. Selection happens
 * per call (the AI API latency dwarfs the one indexed flag SELECT):
 *
 *   real Anthropic  ⟺  env.BLACKNEL_USE_REAL_AI === true
 *                   AND env.ANTHROPIC_API_KEY is set
 *                   AND app_settings.use_real_ai === 'on'
 *   otherwise       →  deterministic mock (adapter-mock)
 *
 * Default-OFF on every axis: this merges dark and does NOT change behaviour
 * until an operator both deploys with the env vars AND runs `pnpm db:ai on`.
 * Rollback is `pnpm db:ai off` (<1s, no redeploy) — see
 * doc/runbooks/ai-rollback.md. The env gate is checked first so a deploy with
 * the flag off never even reads the DB.
 */
export async function resolveAiAdapter(): Promise<AiClient> {
  if (!env.BLACKNEL_USE_REAL_AI) return adapterMock;
  if (!env.ANTHROPIC_API_KEY) return adapterMock;
  return (await isRealAiEnabled()) ? adapterReal : adapterMock;
}

export const aiClient: AiClient = {
  async generate<TInput, TOutput>(
    req: AiRequest<TInput, TOutput>,
  ): Promise<AiGeneration<TOutput>> {
    const adapter = await resolveAiAdapter();
    return adapter.generate(req);
  },
};
