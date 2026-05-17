import {
  complianceCheck as legacyComplianceCheck,
  type ComplianceContext,
  type ComplianceResult,
} from '../compliance-stub';

/**
 * Mock body for the `compliance` skill (Commit 22).
 *
 * Re-uses the byte-equal logic from the Phase-4 stub
 * (`lib/ai/compliance-stub.ts`). The body lives there for now;
 * Phase 11 / final cleanup will collapse the stub file into this
 * one once every caller has migrated to the async path through
 * `lib/ai/skills/compliance.ts`.
 *
 * Determinism guarantee: same `(text, context)` → same output.
 * The existing test suite (`tests/unit/compliance-stub.test.ts`)
 * locks the behaviour.
 */

export interface ComplianceMockInput {
  readonly text: string;
  readonly context?: ComplianceContext;
}

export function mockCompliance(input: ComplianceMockInput): ComplianceResult {
  return legacyComplianceCheck(input.text, input.context);
}
