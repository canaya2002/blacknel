import 'server-only';

import { z } from 'zod';

import { aiClient } from '../client';
import { MODEL_FOR_SKILL } from '../model-routing';
import type {
  SentimentMockInput,
  SentimentMockOutput,
} from '../mock-bodies/sentiment';
import {
  SENTIMENT_PROMPT_VERSION,
  SENTIMENT_SYSTEM_PROMPT_V1,
  SENTIMENT_USER_TEMPLATE_V1,
} from '../prompts';
import type { AiContext } from '../types';

const SENTIMENT_OUTPUT_SCHEMA = z.object({
  sentiment: z.enum(['positive', 'neutral', 'negative']),
  confidence: z.number().min(0).max(1),
});

export interface ClassifySentimentParams {
  readonly text: string;
  readonly context: AiContext;
}

export async function classifySentiment(
  params: ClassifySentimentParams,
): Promise<SentimentMockOutput> {
  const mockInput: SentimentMockInput = { text: params.text };
  const result = await aiClient.generate({
    skill: 'sentiment',
    model: MODEL_FOR_SKILL.sentiment,
    systemPrompt: SENTIMENT_SYSTEM_PROMPT_V1,
    userPrompt: SENTIMENT_USER_TEMPLATE_V1.replace('{text}', params.text),
    input: mockInput,
    outputSchema: SENTIMENT_OUTPUT_SCHEMA,
    context: params.context,
    cachingHint: 'always',
    promptVersion: SENTIMENT_PROMPT_VERSION,
  });
  return result.output;
}
