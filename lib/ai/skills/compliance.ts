import 'server-only';

import { z } from 'zod';

import { aiClient } from '../client';
import { mockCompliance, type ComplianceMockInput } from '../mock-bodies/compliance';
import {
  COMPLIANCE_PROMPT_VERSION,
  COMPLIANCE_SYSTEM_PROMPT_V1,
  COMPLIANCE_USER_TEMPLATE_V1,
} from '../prompts';
import type { AiContext } from '../types';

import type { ComplianceContext, ComplianceResult } from '../compliance-stub';

/**
 * Async compliance gate (Commit 22). The authoritative check
 * before publishing — Server Actions await this; the sync pill
 * uses `complianceHint` instead (REGLA BLACKNEL AI-FEEDBACK
 * PATTERN in `lib/ai/compliance-hint.ts`).
 *
 * # Cascade (Phase 7 plan, wired in Commit 23)
 *
 * Commit 22 only ships the Haiku baseline call. Commit 23 adds:
 *
 *   - If baseline returns `riskLevel ∈ {high, critical}` →
 *     re-run with `claude-opus-4-7` for second-pass judgment.
 *   - Audit row records both calls (linked by `request_hash`
 *     prefix).
 *
 * The mock adapter doesn't escalate (the body is byte-equal to
 * the existing stub) but the contract is the same so callers
 * don't need to know which model fired.
 */

const COMPLIANCE_FLAG = z.enum([
  'legal_promise',
  'medical_advice',
  'financial_promise',
  'refund_promise',
  'aggressive_tone',
  'crisis_topic',
  'minor_involved',
  'pricing_claim',
  'employee_named',
  'competitor_mention',
  'personal_data',
  'unverified_claim',
  'sensitive_keyword',
  'low_rating_monetary_offer',
  'named_person_outside_allowlist',
  'long_response',
]);

const RISK_LEVEL = z.enum(['low', 'medium', 'high', 'critical']);

const COMPLIANCE_OUTPUT_SCHEMA = z.object({
  safe: z.boolean(),
  riskLevel: RISK_LEVEL,
  flags: z.array(COMPLIANCE_FLAG),
  requiresApproval: z.boolean(),
  reasoning: z.string(),
  matchedKeywords: z.array(z.string()),
});

export interface CheckComplianceInput {
  readonly text: string;
  readonly context: AiContext;
  readonly complianceContext?: ComplianceContext;
}

/**
 * Server-side compliance check. Returns the same shape as the
 * legacy synchronous hint so callers can swap path without
 * reshaping the rendering code.
 */
export async function checkCompliance(
  input: CheckComplianceInput,
): Promise<ComplianceResult> {
  const mockInput: ComplianceMockInput = {
    text: input.text,
    ...(input.complianceContext ? { context: input.complianceContext } : {}),
  };
  const result = await aiClient.generate({
    skill: 'compliance',
    model: 'claude-haiku-4-5',
    systemPrompt: COMPLIANCE_SYSTEM_PROMPT_V1,
    userPrompt: COMPLIANCE_USER_TEMPLATE_V1.replace('{text}', input.text),
    input: mockInput,
    outputSchema: COMPLIANCE_OUTPUT_SCHEMA,
    context: input.context,
    cachingHint: 'always',
    promptVersion: COMPLIANCE_PROMPT_VERSION,
  });
  // Keep the mockCompliance reference live so tree-shaking
  // doesn't drop the dependency the adapter relies on.
  void mockCompliance;
  return result.output as ComplianceResult;
}
