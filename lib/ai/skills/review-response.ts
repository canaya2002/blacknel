import 'server-only';

import { z } from 'zod';

import { aiClient } from '../client';
import type { ReviewResponseMockInput } from '../mock-bodies/review-response';
import {
  REVIEW_RESPONSE_PROMPT_VERSION,
  REVIEW_RESPONSE_SYSTEM_PROMPT_V1,
  REVIEW_RESPONSE_USER_TEMPLATE_V1,
} from '../prompts';
import type {
  SuggestReviewResponseInput,
  SuggestReviewResponseOutput,
} from '../reviews-stub';
import type { AiContext } from '../types';

/**
 * Async review-response suggestion (Commit 22). Backed by Haiku
 * (real, Phase 11) or the FNV1a stub bucket (mock).
 */

const VARIABLE_KEY = z.enum(['firstName', 'locationName', 'businessName']);

const REVIEW_RESPONSE_OUTPUT_SCHEMA = z.object({
  body: z.string(),
  variantIndex: z.number().int().nonnegative(),
  bucket: z.enum(['positive', 'neutral', 'negative']),
  resolvedVariables: z.array(VARIABLE_KEY),
  unresolvedVariables: z.array(VARIABLE_KEY),
});

export interface SuggestReviewResponseParams {
  readonly input: SuggestReviewResponseInput;
  readonly reviewBody: string;
  readonly context: AiContext;
}

function fillUserPrompt(input: SuggestReviewResponseInput, body: string): string {
  return REVIEW_RESPONSE_USER_TEMPLATE_V1.replace('{rating}', String(input.rating))
    .replace('{authorName}', input.authorName ?? '')
    .replace('{locationName}', input.locationName ?? '')
    .replace('{brandName}', input.brandName ?? '')
    .replace('{reviewBody}', body);
}

export async function suggestReviewReply(
  params: SuggestReviewResponseParams,
): Promise<SuggestReviewResponseOutput> {
  const mockInput: ReviewResponseMockInput = params.input;
  const result = await aiClient.generate({
    skill: 'review_response',
    model: 'claude-haiku-4-5',
    systemPrompt: REVIEW_RESPONSE_SYSTEM_PROMPT_V1,
    userPrompt: fillUserPrompt(params.input, params.reviewBody),
    input: mockInput,
    outputSchema: REVIEW_RESPONSE_OUTPUT_SCHEMA,
    context: params.context,
    cachingHint: 'always',
    promptVersion: REVIEW_RESPONSE_PROMPT_VERSION,
  });
  return result.output as SuggestReviewResponseOutput;
}
