import 'server-only';

import { z } from 'zod';

import { aiClient } from '../client';
import { COMPLIANCE_CASCADE_MODEL, MODEL_FOR_SKILL } from '../model-routing';
import { mockCompliance, type ComplianceMockInput } from '../mock-bodies/compliance';
import {
  COMPLIANCE_CASCADE_PROMPT_VERSION,
  COMPLIANCE_CASCADE_SYSTEM_PROMPT_V1,
  COMPLIANCE_CASCADE_USER_TEMPLATE_V1,
  COMPLIANCE_PROMPT_VERSION,
  COMPLIANCE_SYSTEM_PROMPT_V1,
  COMPLIANCE_USER_TEMPLATE_V1,
} from '../prompts';
import type { AiContext } from '../types';

import type { ComplianceContext, ComplianceResult } from '../compliance-stub';

/**
 * Async compliance gate with dual-model cascade (Commit 23).
 *
 * # The cascade
 *
 *   1. Baseline call:  Haiku, COMPLIANCE_SYSTEM_PROMPT_V1.
 *   2. If `result.riskLevel ∈ {'high', 'critical'}` → cascade
 *      call: Opus, COMPLIANCE_CASCADE_SYSTEM_PROMPT_V1,
 *      `parentGenerationId = baseline.generationId`.
 *   3. Cascade output is the authoritative return value.
 *
 * **Mock determinism (D-23-1 Opción A)**: the adapter-mock runs
 * the same keyword body for both calls, so cascade output is
 * byte-equal to baseline. The CAUSAL linkage (parent_generation_id)
 * still lands on the second row — the audit trail captures "we
 * ran a second pass" even when the answer doesn't change.
 *
 * Phase 11's real adapter (Opus) genuinely re-evaluates the
 * draft and may upgrade / downgrade the verdict. The skill
 * signature stays the same.
 *
 * # Why bypass dedup on cascade (cf. adapter-mock.ts)
 *
 * Same `(orgId, requestHash)` inside the 5-min window normally
 * dedups. But cascade rows carry a `parentGenerationId` that
 * MUST reflect the current baseline — returning a row pointing
 * at a stale parent is wrong. The adapter detects the cascade
 * path (`req.parentGenerationId != null`) and skips dedup for
 * those calls.
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

export interface CheckComplianceMeta {
  readonly baselineGenerationId: string;
  readonly cascadeGenerationId: string | null;
  readonly cascadeFired: boolean;
}

export interface CheckComplianceResult {
  readonly result: ComplianceResult;
  readonly meta: CheckComplianceMeta;
}

/**
 * Server-side compliance check with cascade. Returns the
 * authoritative `ComplianceResult` (cascade verdict when it fires,
 * baseline otherwise) plus the `meta` describing whether the
 * cascade ran and the generation ids for both passes.
 */
export async function checkCompliance(
  input: CheckComplianceInput,
): Promise<CheckComplianceResult> {
  const mockInput: ComplianceMockInput = {
    text: input.text,
    ...(input.complianceContext ? { context: input.complianceContext } : {}),
  };

  // 1. Baseline (Haiku).
  const baseline = await aiClient.generate({
    skill: 'compliance',
    model: MODEL_FOR_SKILL.compliance,
    systemPrompt: COMPLIANCE_SYSTEM_PROMPT_V1,
    userPrompt: COMPLIANCE_USER_TEMPLATE_V1.replace('{text}', input.text),
    input: mockInput,
    outputSchema: COMPLIANCE_OUTPUT_SCHEMA,
    context: input.context,
    cachingHint: 'always',
    promptVersion: COMPLIANCE_PROMPT_VERSION,
    parentGenerationId: null,
  });

  const baselineOutput = baseline.output as ComplianceResult;
  const triggersCascade =
    baselineOutput.riskLevel === 'high' || baselineOutput.riskLevel === 'critical';

  if (!triggersCascade) {
    return {
      result: baselineOutput,
      meta: {
        baselineGenerationId: baseline.meta.generationId,
        cascadeGenerationId: null,
        cascadeFired: false,
      },
    };
  }

  // 2. Cascade (Opus) — fires only when baseline flagged high/critical.
  const cascadeUserPrompt = COMPLIANCE_CASCADE_USER_TEMPLATE_V1.replace(
    '{industry}',
    input.complianceContext?.industry ?? '',
  )
    .replace('{locale}', input.complianceContext?.locale ?? '')
    .replace('{entityType}', input.complianceContext?.entityType ?? '')
    .replace('{brandName}', input.complianceContext?.brandName ?? '')
    .replace('{locationName}', input.complianceContext?.locationName ?? '')
    .replace(
      '{rating}',
      input.complianceContext?.rating !== undefined
        ? String(input.complianceContext.rating)
        : '',
    )
    .replace('{baselineRisk}', baselineOutput.riskLevel)
    .replace('{baselineFlags}', baselineOutput.flags.join(','))
    .replace('{text}', input.text);

  const cascade = await aiClient.generate({
    skill: 'compliance',
    model: COMPLIANCE_CASCADE_MODEL,
    systemPrompt: COMPLIANCE_CASCADE_SYSTEM_PROMPT_V1,
    userPrompt: cascadeUserPrompt,
    input: mockInput,
    outputSchema: COMPLIANCE_OUTPUT_SCHEMA,
    context: input.context,
    cachingHint: 'always',
    promptVersion: COMPLIANCE_CASCADE_PROMPT_VERSION,
    parentGenerationId: baseline.meta.generationId,
  });

  // Keep the mockCompliance reference live so tree-shaking
  // doesn't drop the dependency the adapter relies on.
  void mockCompliance;

  return {
    result: cascade.output as ComplianceResult,
    meta: {
      baselineGenerationId: baseline.meta.generationId,
      cascadeGenerationId: cascade.meta.generationId,
      cascadeFired: true,
    },
  };
}
