/**
 * Phase-4 compliance stub.
 *
 * `complianceCheck` becomes a real Claude Opus call in Phase 7
 * (`lib/ai/compliance.ts`). Until then, this stub returns deterministic
 * results so the inbox / reviews / publishing flows can wire up the
 * compliance contract today without depending on an LLM:
 *
 *   - safe=true for messages ≤ 200 chars with NO sensitive keyword.
 *   - requiresApproval=true if the message contains any keyword from
 *     `SENSITIVE_KEYWORDS_*` (bilingual EN / ES — the two most common
 *     languages in Blacknel demos).
 *   - safe stays `true` for now (no full-block path); Phase 7 may flip
 *     `safe=false` for the highest-risk classes (PII leak, defamation,
 *     etc.) and add `riskLevel='critical'`.
 *
 * The shape of `ComplianceResult` matches `lib/ai/compliance.ts` from
 * the master prompt — Phase 7 swaps the implementation, not the
 * contract. Callers (`lib/inbox/send-reply.ts`, future review
 * responses, future post compliance) keep working unchanged.
 */

export type ComplianceFlag =
  | 'legal_promise'
  | 'medical_advice'
  | 'financial_promise'
  | 'refund_promise'
  | 'aggressive_tone'
  | 'crisis_topic'
  | 'minor_involved'
  | 'pricing_claim'
  | 'employee_named'
  | 'competitor_mention'
  | 'personal_data'
  | 'unverified_claim'
  | 'sensitive_keyword';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface ComplianceResult {
  readonly safe: boolean;
  readonly riskLevel: RiskLevel;
  readonly flags: ReadonlyArray<ComplianceFlag>;
  readonly requiresApproval: boolean;
  readonly reasoning: string;
  /** Keywords actually matched — surfaced so the UI can highlight them. */
  readonly matchedKeywords: ReadonlyArray<string>;
}

/**
 * Bilingual keyword list. Each keyword maps to a flag so the audit
 * trail and the UI can show which class of risk fired.
 *
 * NB: matches are case-insensitive and word-boundary aware
 * (`refund` matches but `prefundamental` does not). Phase 7's IA
 * classifier replaces these heuristics — keep the list lean so the
 * Phase-4 baseline stays predictable.
 */
const SENSITIVE_KEYWORDS: ReadonlyArray<{ keyword: string; flag: ComplianceFlag }> = [
  // English
  { keyword: 'refund', flag: 'refund_promise' },
  { keyword: 'lawsuit', flag: 'legal_promise' },
  { keyword: 'lawyer', flag: 'legal_promise' },
  { keyword: 'attorney', flag: 'legal_promise' },
  { keyword: 'doctor', flag: 'medical_advice' },
  { keyword: 'medication', flag: 'medical_advice' },
  { keyword: 'prescription', flag: 'medical_advice' },
  { keyword: 'complaint', flag: 'aggressive_tone' },
  // Spanish
  { keyword: 'reembolso', flag: 'refund_promise' },
  { keyword: 'devolución', flag: 'refund_promise' },
  { keyword: 'demanda', flag: 'legal_promise' },
  { keyword: 'abogado', flag: 'legal_promise' },
  { keyword: 'médico', flag: 'medical_advice' },
  { keyword: 'medicamento', flag: 'medical_advice' },
  { keyword: 'receta', flag: 'medical_advice' },
  { keyword: 'queja', flag: 'aggressive_tone' },
];

const SHORT_MESSAGE_THRESHOLD = 200;

/**
 * Stub compliance check. Deterministic — same input always returns the
 * same result. Phase 7 replaces the body with a Claude Opus 4.7 call.
 *
 * The function intentionally accepts a string + minimal context
 * (industry, locale) so Phase 7's richer signature is a strict
 * superset; today we ignore the optional context.
 */
export function complianceCheck(
  text: string,
  _context?: { industry?: string; locale?: string },
): ComplianceResult {
  const normalized = (text ?? '').trim();
  if (normalized.length === 0) {
    return {
      safe: true,
      riskLevel: 'low',
      flags: [],
      requiresApproval: false,
      reasoning: 'Empty body. Nothing to flag.',
      matchedKeywords: [],
    };
  }

  const lower = normalized.toLowerCase();
  const flags = new Set<ComplianceFlag>();
  const matched: string[] = [];

  for (const { keyword, flag } of SENSITIVE_KEYWORDS) {
    if (matchesWordBoundary(lower, keyword)) {
      flags.add(flag);
      matched.push(keyword);
    }
  }

  if (flags.size === 0 && normalized.length <= SHORT_MESSAGE_THRESHOLD) {
    return {
      safe: true,
      riskLevel: 'low',
      flags: [],
      requiresApproval: false,
      reasoning: `Short message (${normalized.length} chars) with no sensitive keywords.`,
      matchedKeywords: [],
    };
  }

  if (flags.size === 0) {
    // Long but clean. Phase 7 likely runs deeper checks here.
    return {
      safe: true,
      riskLevel: 'low',
      flags: [],
      requiresApproval: false,
      reasoning: `Long message (${normalized.length} chars) without keyword matches. Phase-4 stub clears it; Phase-7 IA review will revisit.`,
      matchedKeywords: [],
    };
  }

  const riskLevel: RiskLevel = flags.has('legal_promise') || flags.has('medical_advice')
    ? 'high'
    : 'medium';

  return {
    safe: true,
    riskLevel,
    flags: [...flags],
    requiresApproval: true,
    reasoning: `Stub flagged ${[...flags].join(', ')} from keyword(s): ${matched.join(', ')}.`,
    matchedKeywords: matched,
  };
}

/**
 * Word-boundary-aware substring check. Avoids `refund` matching inside
 * `prefundamental`, and handles Unicode letters so Spanish accents work
 * (`médico` matches but `paramédicos` should NOT — and doesn't because
 * the surrounding letters break the boundary).
 *
 * Uses `\p{L}` (Unicode letter) classes so it doesn't depend on
 * ASCII-only word boundaries.
 */
function matchesWordBoundary(haystack: string, needle: string): boolean {
  // Build a per-keyword regex once per call. The list is short; the
  // overhead is negligible compared to a real IA call (Phase 7).
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?<![\\p{L}])${escaped}(?![\\p{L}])`, 'iu');
  return re.test(haystack);
}
