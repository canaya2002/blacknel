import {
  detectLanguage,
  type DetectedLanguage,
} from '../../inbox/detect-language';

/**
 * Mock body for the `language_detect` skill (Commit 22). Delegates
 * to the Phase-4 stopword classifier. Existing
 * `tests/unit/detect-language.test.ts` locks the behaviour.
 *
 * Output shape matches the schema declared in
 * `lib/ai/prompts.ts` so the adapter / skill layer can pass it
 * straight through.
 */

export interface LanguageDetectMockInput {
  readonly text: string;
}

export interface LanguageDetectMockOutput {
  readonly language: DetectedLanguage;
  readonly confidence: number;
}

export function mockLanguageDetect(
  input: LanguageDetectMockInput,
): LanguageDetectMockOutput {
  const language = detectLanguage(input.text);
  // The stopword classifier returns binary signal — we synthesize
  // a confidence from the absence/presence of the result.
  // Phase 11's real adapter receives Anthropic's calibrated value.
  const confidence = language === 'unknown' ? 0.2 : 0.85;
  return { language, confidence };
}
