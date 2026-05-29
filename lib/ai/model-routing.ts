import type { AiModel, AiSkillKey } from './types';

/**
 * Skill → model routing (C43a). Single source of truth for which Anthropic
 * model each skill runs on. Most of the volume stays on Haiku (cheap); only
 * customer-facing copy uses Sonnet and only the compliance escalation uses
 * Opus.
 *
 * Tiers:
 *   - Haiku 4.5  → language_detect, sentiment, intent, thread_summary,
 *                  review_summary, crisis (+ prompt cache), and the
 *                  compliance BASELINE screen.
 *   - Sonnet 4.6 → caption (post copy), review_response.
 *   - Opus 4.8   → compliance CASCADE only (high/critical baselines escalate;
 *                  see COMPLIANCE_CASCADE_MODEL). The compliance baseline
 *                  stays on Haiku as a cheap first pass — escalation to Opus
 *                  fires only when the baseline flags high/critical risk.
 */

export const DEFAULT_MODEL: AiModel = 'claude-haiku-4-5';

export const MODEL_FOR_SKILL: Readonly<Record<AiSkillKey, AiModel>> = {
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
export const COMPLIANCE_CASCADE_MODEL: AiModel = 'claude-opus-4-8';

/**
 * Anthropic SDK model id for an `AiModel`. Haiku uses the dated snapshot id
 * because the bare alias is not always accepted; the others use the alias.
 */
export const SDK_MODEL_ID: Readonly<Record<AiModel, string>> = {
  'claude-haiku-4-5': 'claude-haiku-4-5-20251001',
  'claude-sonnet-4-6': 'claude-sonnet-4-6',
  'claude-opus-4-8': 'claude-opus-4-8',
};
