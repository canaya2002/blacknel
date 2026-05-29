import 'server-only';

import { z } from 'zod';

import { aiClient } from '../client';
import { MODEL_FOR_SKILL } from '../model-routing';
import type { DetectedLanguage } from '../../inbox/detect-language';
import type { LanguageDetectMockInput } from '../mock-bodies/language-detect';
import {
  LANGUAGE_DETECT_PROMPT_VERSION,
  LANGUAGE_DETECT_SYSTEM_PROMPT_V1,
  LANGUAGE_DETECT_USER_TEMPLATE_V1,
} from '../prompts';
import type { AiContext } from '../types';

const LANGUAGE_OUTPUT_SCHEMA = z.object({
  language: z.enum(['es', 'en', 'pt', 'fr', 'unknown']),
  confidence: z.number().min(0).max(1),
});

export interface DetectLanguageParams {
  readonly text: string;
  readonly context: AiContext;
}

export interface DetectLanguageResult {
  readonly language: DetectedLanguage;
  readonly confidence: number;
}

/**
 * Async language classifier (Commit 22). Mock delegates to the
 * Phase-4 stopword classifier + synthesizes a confidence; real
 * adapter (Phase 11) reads Anthropic's calibrated confidence.
 */
export async function detectLanguageAi(
  params: DetectLanguageParams,
): Promise<DetectLanguageResult> {
  const mockInput: LanguageDetectMockInput = { text: params.text };
  const result = await aiClient.generate({
    skill: 'language_detect',
    model: MODEL_FOR_SKILL.language_detect,
    systemPrompt: LANGUAGE_DETECT_SYSTEM_PROMPT_V1,
    userPrompt: LANGUAGE_DETECT_USER_TEMPLATE_V1.replace('{text}', params.text),
    input: mockInput,
    outputSchema: LANGUAGE_OUTPUT_SCHEMA,
    context: params.context,
    cachingHint: 'always',
    promptVersion: LANGUAGE_DETECT_PROMPT_VERSION,
  });
  return result.output;
}
