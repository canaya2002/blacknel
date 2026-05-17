import 'server-only';

import { z } from 'zod';

import { aiClient } from '../client';
import type {
  IntentMockInput,
  IntentMockOutput,
} from '../mock-bodies/intent';
import {
  INTENT_PROMPT_VERSION,
  INTENT_SYSTEM_PROMPT_V1,
  INTENT_USER_TEMPLATE_V1,
} from '../prompts';
import type { AiContext } from '../types';

const INTENT_LABEL = z.enum([
  'support_request',
  'complaint',
  'compliment',
  'info_request',
  'sales_inquiry',
  'spam',
  'other',
]);

const INTENT_OUTPUT_SCHEMA = z.object({
  intents: z.array(INTENT_LABEL).min(1),
  primaryIntent: INTENT_LABEL,
});

export interface ClassifyIntentParams {
  readonly text: string;
  readonly context: AiContext;
}

export async function classifyIntent(
  params: ClassifyIntentParams,
): Promise<IntentMockOutput> {
  const mockInput: IntentMockInput = { text: params.text };
  const result = await aiClient.generate({
    skill: 'intent',
    model: 'claude-haiku-4-5',
    systemPrompt: INTENT_SYSTEM_PROMPT_V1,
    userPrompt: INTENT_USER_TEMPLATE_V1.replace('{text}', params.text),
    input: mockInput,
    outputSchema: INTENT_OUTPUT_SCHEMA,
    context: params.context,
    cachingHint: 'always',
    promptVersion: INTENT_PROMPT_VERSION,
  });
  return result.output;
}
