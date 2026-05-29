import type { AiModel, AiSkillKey, AnthropicModel, OpenAiModel } from './types';

/**
 * Skill → model routing (C43a) + Anthropic → OpenAI fallback mapping (C43c).
 * Single source of truth for which model each skill runs on, and which OpenAI
 * model stands in when the Anthropic primary fails transiently.
 *
 * Tiers (primary, Anthropic):
 *   - Haiku 4.5  → language_detect, sentiment, intent, thread_summary,
 *                  review_summary, crisis (+ cache), compliance BASELINE.
 *   - Sonnet 4.6 → caption, review_response.
 *   - Opus 4.8   → compliance CASCADE only (COMPLIANCE_CASCADE_MODEL).
 */

export const DEFAULT_MODEL: AnthropicModel = 'claude-haiku-4-5';

export const MODEL_FOR_SKILL: Readonly<Record<AiSkillKey, AnthropicModel>> = {
  language_detect: 'claude-haiku-4-5',
  sentiment: 'claude-haiku-4-5',
  intent: 'claude-haiku-4-5',
  thread_summary: 'claude-haiku-4-5',
  review_summary: 'claude-haiku-4-5',
  crisis: 'claude-haiku-4-5',
  caption: 'claude-sonnet-4-6',
  review_response: 'claude-sonnet-4-6',
  // Baseline screen only — high/critical baselines escalate to
  // COMPLIANCE_CASCADE_MODEL (Opus 4.8) via lib/ai/skills/compliance.ts.
  compliance: 'claude-haiku-4-5',
};

/** Compliance dual-model cascade: the authoritative second pass on Opus 4.8. */
export const COMPLIANCE_CASCADE_MODEL: AnthropicModel = 'claude-opus-4-8';

/**
 * Anthropic → OpenAI fallback, same tier (C43c). Opus maps to gpt-5.4 (the
 * workhorse) on purpose — more predictable than a larger reasoning model for a
 * fallback path.
 */
export const ANTHROPIC_TO_OPENAI: Readonly<Record<AnthropicModel, OpenAiModel>> = {
  'claude-haiku-4-5': 'gpt-5.4-mini',
  'claude-sonnet-4-6': 'gpt-5.4',
  'claude-opus-4-8': 'gpt-5.4',
};

/**
 * Provider SDK model id for an `AiModel`. Anthropic Haiku uses the dated
 * snapshot id (the bare alias is not always accepted); the rest use their
 * alias. The OpenAI ids equal the model strings (confirm exact ids in
 * platform.openai.com/docs/models).
 */
export const SDK_MODEL_ID: Readonly<Record<AiModel, string>> = {
  'claude-haiku-4-5': 'claude-haiku-4-5-20251001',
  'claude-sonnet-4-6': 'claude-sonnet-4-6',
  'claude-opus-4-8': 'claude-opus-4-8',
  'gpt-5.4-mini': 'gpt-5.4-mini',
  'gpt-5.4': 'gpt-5.4',
};
