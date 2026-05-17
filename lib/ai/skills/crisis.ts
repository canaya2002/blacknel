import 'server-only';

import { z } from 'zod';

import { aiClient } from '../client';
import type {
  CrisisMockInput,
  CrisisMockOutput,
} from '../mock-bodies/crisis';
import {
  CRISIS_PROMPT_VERSION,
  CRISIS_SYSTEM_PROMPT_V1,
  CRISIS_USER_TEMPLATE_V1,
} from '../prompts';
import type { AiContext } from '../types';

/**
 * Crisis detection (Commit 22). Uses Opus per the cost rule —
 * pattern detection over a signal window is the kind of
 * subtle reasoning where misjudgment cost dominates token cost.
 */

const CRISIS_OUTPUT_SCHEMA = z.object({
  crisis: z.boolean(),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  title: z.string(),
  summary: z.string(),
  evidence: z.object({
    reviewIds: z.array(z.string()),
    messageIds: z.array(z.string()),
  }),
  recommendedAction: z.string(),
});

export interface DetectCrisisParams {
  readonly input: CrisisMockInput;
  readonly context: AiContext;
}

function fillUserPrompt(input: CrisisMockInput): string {
  return CRISIS_USER_TEMPLATE_V1.replace('{brandName}', input.brandName)
    .replace('{windowStart}', input.windowStartIso)
    .replace('{windowEnd}', input.windowEndIso)
    .replace('{reviewsJson}', JSON.stringify(input.reviews).slice(0, 4000))
    .replace('{messagesJson}', JSON.stringify(input.messages).slice(0, 4000));
}

export async function detectCrisis(
  params: DetectCrisisParams,
): Promise<CrisisMockOutput> {
  const result = await aiClient.generate({
    skill: 'crisis',
    model: 'claude-opus-4-7',
    systemPrompt: CRISIS_SYSTEM_PROMPT_V1,
    userPrompt: fillUserPrompt(params.input),
    input: params.input,
    outputSchema: CRISIS_OUTPUT_SCHEMA,
    context: params.context,
    cachingHint: 'always',
    promptVersion: CRISIS_PROMPT_VERSION,
  });
  return result.output;
}
