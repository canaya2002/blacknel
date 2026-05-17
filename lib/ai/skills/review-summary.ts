import 'server-only';

import { z } from 'zod';

import { aiClient } from '../client';
import type {
  ReviewSummaryMockInput,
  ReviewSummaryMockOutput,
} from '../mock-bodies/review-summary';
import {
  REVIEW_SUMMARY_PROMPT_VERSION,
  REVIEW_SUMMARY_SYSTEM_PROMPT_V1,
  REVIEW_SUMMARY_USER_TEMPLATE_V1,
} from '../prompts';
import type { AiContext } from '../types';

const REVIEW_SUMMARY_OUTPUT_SCHEMA = z.object({
  summary: z.string(),
  topPraise: z.array(z.string()),
  topConcerns: z.array(z.string()),
  sentimentBreakdown: z.object({
    positive: z.number().min(0).max(1),
    neutral: z.number().min(0).max(1),
    negative: z.number().min(0).max(1),
  }),
});

export interface SummarizeReviewsParams {
  readonly input: ReviewSummaryMockInput;
  readonly context: AiContext;
}

export async function summarizeReviews(
  params: SummarizeReviewsParams,
): Promise<ReviewSummaryMockOutput> {
  const result = await aiClient.generate({
    skill: 'review_summary',
    model: 'claude-haiku-4-5',
    systemPrompt: REVIEW_SUMMARY_SYSTEM_PROMPT_V1,
    userPrompt: REVIEW_SUMMARY_USER_TEMPLATE_V1.replace(
      '{reviewsJson}',
      JSON.stringify(params.input.reviews).slice(0, 6000),
    ),
    input: params.input,
    outputSchema: REVIEW_SUMMARY_OUTPUT_SCHEMA,
    context: params.context,
    cachingHint: 'always',
    promptVersion: REVIEW_SUMMARY_PROMPT_VERSION,
  });
  return result.output;
}
