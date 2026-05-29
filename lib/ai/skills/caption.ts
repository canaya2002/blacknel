import 'server-only';

import { z } from 'zod';

import { aiClient } from '../client';
import { MODEL_FOR_SKILL } from '../model-routing';
import type { CaptionMockInput } from '../mock-bodies/caption';
import {
  CAPTION_PROMPT_VERSION,
  CAPTION_SYSTEM_PROMPT_V1,
  CAPTION_USER_TEMPLATE_V1,
} from '../prompts';
import type {
  SuggestCaptionInput,
  SuggestCaptionOutput,
} from '../caption-stub';
import type { AiContext } from '../types';

/**
 * Async caption suggestion (Commit 22). Backed by Haiku (real)
 * or the FNV1a stub bucket (mock). Determinism guarantee comes
 * from the mock body; the real adapter (Phase 11) varies on
 * model nondeterminism but the schema is locked.
 */

const VARIABLE_KEY = z.enum(['brandName', 'locationName', 'productHint']);

const CAPTION_OUTPUT_SCHEMA = z.object({
  body: z.string(),
  variantIndex: z.number().int().nonnegative(),
  bucket: z.string(),
  resolvedVariables: z.array(VARIABLE_KEY),
  unresolvedVariables: z.array(VARIABLE_KEY),
  fellBackToDefault: z.boolean(),
});

export interface SuggestCaptionParams {
  readonly input: SuggestCaptionInput;
  readonly context: AiContext;
}

function fillUserPrompt(input: SuggestCaptionInput): string {
  return CAPTION_USER_TEMPLATE_V1.replace('{goal}', input.goal)
    .replace('{tone}', input.tone)
    .replace('{brandName}', input.brandName ?? '')
    .replace('{locationName}', input.locationName ?? '')
    .replace('{productHint}', input.productHint ?? '')
    .replace('{index}', String(input.index ?? 0));
}

export async function suggestCaption(
  params: SuggestCaptionParams,
): Promise<SuggestCaptionOutput> {
  const mockInput: CaptionMockInput = params.input;
  const result = await aiClient.generate({
    skill: 'caption',
    model: MODEL_FOR_SKILL.caption,
    systemPrompt: CAPTION_SYSTEM_PROMPT_V1,
    userPrompt: fillUserPrompt(params.input),
    input: mockInput,
    outputSchema: CAPTION_OUTPUT_SCHEMA,
    context: params.context,
    cachingHint: 'always',
    promptVersion: CAPTION_PROMPT_VERSION,
  });
  return result.output as SuggestCaptionOutput;
}
