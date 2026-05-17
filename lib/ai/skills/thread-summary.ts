import 'server-only';

import { z } from 'zod';

import { aiClient } from '../client';
import type {
  ThreadSummaryMockInput,
  ThreadSummaryMockOutput,
} from '../mock-bodies/thread-summary';
import {
  THREAD_SUMMARY_PROMPT_VERSION,
  THREAD_SUMMARY_SYSTEM_PROMPT_V1,
  THREAD_SUMMARY_USER_TEMPLATE_V1,
} from '../prompts';
import type { AiContext } from '../types';

const THREAD_SUMMARY_OUTPUT_SCHEMA = z.object({
  summary: z.string(),
  openQuestions: z.array(z.string()),
});

export interface SummarizeThreadParams {
  readonly input: ThreadSummaryMockInput;
  readonly context: AiContext;
}

export async function summarizeThread(
  params: SummarizeThreadParams,
): Promise<ThreadSummaryMockOutput> {
  const result = await aiClient.generate({
    skill: 'thread_summary',
    model: 'claude-haiku-4-5',
    systemPrompt: THREAD_SUMMARY_SYSTEM_PROMPT_V1,
    userPrompt: THREAD_SUMMARY_USER_TEMPLATE_V1.replace(
      '{messagesJson}',
      JSON.stringify(params.input.messages).slice(0, 6000),
    ),
    input: params.input,
    outputSchema: THREAD_SUMMARY_OUTPUT_SCHEMA,
    context: params.context,
    cachingHint: 'always',
    promptVersion: THREAD_SUMMARY_PROMPT_VERSION,
  });
  return result.output;
}
