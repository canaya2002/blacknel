/**
 * Phase-4 compliance stub — Commit 22 split.
 *
 * As of Commit 22, this file is the source of truth for the
 * synchronous keyword body. Two consumers:
 *
 *   - `lib/ai/compliance-hint.ts` re-exports `complianceCheck`
 *     as `complianceHint` for the sync typing-time pill
 *     (REGLA BLACKNEL AI-FEEDBACK PATTERN — render hot paths
 *     use the sync heuristic; submit boundaries use the async
 *     `lib/ai/skills/compliance.ts` path).
 *
 *   - `lib/ai/mock-bodies/compliance.ts` re-exports it as the
 *     adapter-mock body for `skill: 'compliance'`. Phase 11's
 *     real adapter swaps that mock body with an Anthropic call;
 *     this synchronous file stays as-is.
 *
 * Phase 11 cleanup MAY collapse this file into the mock-bodies
 * directory once every caller has migrated through
 * `lib/ai/compliance-hint.ts` or `lib/ai/skills/compliance.ts`.
 *
 * --- Original notes preserved below ---
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
  | 'sensitive_keyword'
  // ---------- Review-specific flags (Commit 14, Ajuste 2) ----------
  /** rating ≤2 + the response offers refund/discount/compensation/etc. */
  | 'low_rating_monetary_offer'
  /** Response names someone outside the brand/location allowlist. */
  | 'named_person_outside_allowlist'
  /** Response over 800 chars — readers expect short reviews replies. */
  | 'long_response';

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
/** Response-length threshold beyond which a review reply gets a `long_response` flag. */
const LONG_REVIEW_RESPONSE_THRESHOLD = 800;

/**
 * Monetary-offer keywords. When the parent review is ≤2 stars and the
 * response promises any of these, we want a human to approve before
 * the offer goes public — refund promises bypassing manager review
 * are a recurring class of "we shouldn't have said that" incidents.
 * Bilingual; word-boundary matched the same way as the base list.
 */
const MONETARY_OFFER_KEYWORDS: ReadonlyArray<string> = [
  // English
  'refund',
  'discount',
  'compensation',
  'reimbursement',
  'gift card',
  'voucher',
  // Spanish
  'reembolso',
  'descuento',
  'compensación',
  'cupón',
  'cupon',
  'devolución',
  'devolucion',
  'bonificación',
  'bonificacion',
];

/**
 * Optional review-specific signal set. When the caller passes
 * `context.entityType === 'review'`, the stub runs three extra checks
 * on top of the keyword list:
 *
 *   1. **Low-rating monetary offer.** rating ≤2 AND any
 *      `MONETARY_OFFER_KEYWORDS` match → `low_rating_monetary_offer`
 *      + `riskLevel='high'` + `requiresApproval=true`. The base list
 *      already flags `refund_promise` on `refund` / `reembolso`, but
 *      *only when paired with a low rating* do we promote to `high`
 *      and force approval. Phase 7's classifier will absorb both
 *      signals into a single judgment.
 *
 *   2. **Named person outside allowlist.** The response mentions a
 *      capitalized 4+ char word that is NOT in the allowlist (the
 *      brand and location names from `context`). Heuristic — Phase 7
 *      can do real NER. The naive check catches the common failure
 *      mode where an agent name-drops a customer ("Lo sentimos, María")
 *      that the public reply shouldn't expose by name. Risk `medium`.
 *
 *   3. **Long response.** >800 chars → `long_response`, risk `low`,
 *      `requiresApproval=true`. Public review replies that long
 *      almost always benefit from a second pair of eyes.
 *
 * The review flags SUM to the base keyword flags; they don't replace
 * anything. A response can carry both `refund_promise` (base) and
 * `low_rating_monetary_offer` (review) simultaneously — the second
 * just promotes the overall `riskLevel`.
 */
export interface ComplianceContext {
  industry?: string;
  locale?: string;
  entityType?: 'inbox' | 'review';
  /** 1..5; used by the low-rating monetary-offer check. */
  rating?: number;
  /** Brand name; auto-allowlisted in the named-person check. */
  brandName?: string;
  /** Location name; auto-allowlisted in the named-person check. */
  locationName?: string;
}

/**
 * Stub compliance check. Deterministic — same input always returns the
 * same result. Phase 7 replaces the body with a Claude Opus 4.7 call.
 *
 * Phase-4 callers passed only `(text)`. Phase-5 review responses pass
 * `(text, { entityType: 'review', rating, brandName, locationName })`
 * to unlock the three extra checks documented on `ComplianceContext`.
 */
export function complianceCheck(
  text: string,
  context?: ComplianceContext,
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

  // ---------- Review-specific signals (only when entityType='review') ----
  let reviewSignalsApplied = false;
  if (context?.entityType === 'review') {
    // 1. Low rating + monetary offer
    if (typeof context.rating === 'number' && context.rating <= 2) {
      for (const kw of MONETARY_OFFER_KEYWORDS) {
        if (matchesWordBoundary(lower, kw)) {
          flags.add('low_rating_monetary_offer');
          if (!matched.includes(kw)) matched.push(kw);
        }
      }
    }
    // 2. Named person outside allowlist. A "name" here is a capitalized
    //    word of 4+ chars that is neither the brand nor the location.
    if (mentionsForbiddenName(normalized, context)) {
      flags.add('named_person_outside_allowlist');
    }
    // 3. Long response
    if (normalized.length > LONG_REVIEW_RESPONSE_THRESHOLD) {
      flags.add('long_response');
    }
    reviewSignalsApplied =
      flags.has('low_rating_monetary_offer') ||
      flags.has('named_person_outside_allowlist') ||
      flags.has('long_response');
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
    return {
      safe: true,
      riskLevel: 'low',
      flags: [],
      requiresApproval: false,
      reasoning: `Long message (${normalized.length} chars) without keyword matches. Phase-4 stub clears it; Phase-7 IA review will revisit.`,
      matchedKeywords: [],
    };
  }

  const riskLevel = pickRiskLevel(flags);
  const flagList = [...flags];

  return {
    safe: true,
    riskLevel,
    flags: flagList,
    requiresApproval: true,
    reasoning: reviewSignalsApplied
      ? `Stub flagged ${flagList.join(', ')} (review-context signals applied) from keyword(s): ${matched.join(', ') || '—'}.`
      : `Stub flagged ${flagList.join(', ')} from keyword(s): ${matched.join(', ')}.`,
    matchedKeywords: matched,
  };
}

/**
 * Risk-level resolution for a flag set. The Phase-4 rule used to be
 * "legal/medical → high, otherwise medium". With review signals we
 * add two more rungs:
 *
 *   - `low_rating_monetary_offer` joins the `high` set — refund/
 *     discount promises on 1–2★ public reviews are the canonical
 *     case for a human to read before it goes out.
 *   - `long_response` alone keeps the existing `low` baseline (still
 *     bumps `requiresApproval=true` via the flag set being non-empty,
 *     but doesn't escalate risk on its own).
 */
function pickRiskLevel(flags: ReadonlySet<ComplianceFlag>): RiskLevel {
  if (
    flags.has('legal_promise') ||
    flags.has('medical_advice') ||
    flags.has('low_rating_monetary_offer')
  ) {
    return 'high';
  }
  // long_response by itself sits at low; with anything else, the
  // anything-else branches above already settled the risk.
  if (flags.size === 1 && flags.has('long_response')) return 'low';
  if (flags.size === 1 && flags.has('named_person_outside_allowlist')) {
    return 'medium';
  }
  return 'medium';
}

const NAME_TOKEN_RE = /\b[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{3,}\b/gu;

/**
 * Capitalized 4+-char tokens that are common Spanish / English words,
 * sentence-leading greetings, and stock business prose. Anything in
 * this list is NOT considered a "named person" by the heuristic.
 *
 * The list deliberately leans on the side of letting more words
 * through (i.e. the heuristic flags more) — the cost of a false
 * positive here is a human review, and Phase 7's classifier replaces
 * the heuristic entirely with real NER.
 */
const NAME_STOP_WORDS = new Set([
  // Common sentence-leading greetings / closings (ES + EN).
  'hola',
  'gracias',
  'lamento',
  'lamentamos',
  'agradecemos',
  'hello',
  'hi',
  'thanks',
  'thank',
  'sorry',
  'apologies',
  'cordial',
  'cordialmente',
  'saludos',
  'querido',
  'querida',
  'estimado',
  'estimada',
  'good',
  'great',
  'sincerely',
  'best',
  // Common sentence-starters that get capitalized by grammar (not
  // because they're proper nouns).
  'lamentablemente',
  'desafortunadamente',
  'afortunadamente',
  'nuestro',
  'nuestra',
  'nuestros',
  'nuestras',
  'nosotros',
  'nosotras',
  'estamos',
  'vamos',
  'veremos',
  'cuando',
  'donde',
  'mañana',
  'siempre',
  'también',
  'unfortunately',
  'fortunately',
  'however',
  'where',
  'when',
  'tomorrow',
  'always',
  'also',
]);

function mentionsForbiddenName(text: string, ctx: ComplianceContext): boolean {
  const allowed = new Set<string>();
  for (const v of [ctx.brandName, ctx.locationName]) {
    if (typeof v === 'string' && v.length > 0) {
      // Split brand/location names that contain multiple tokens
      // ("La Trattoria — Downtown") into individual allowlist entries.
      v.split(/[\s—–-]+/u)
        .filter((tok) => tok.length >= 4)
        .forEach((tok) => allowed.add(tok.toLowerCase()));
    }
  }
  let m: RegExpExecArray | null;
  NAME_TOKEN_RE.lastIndex = 0;
  while ((m = NAME_TOKEN_RE.exec(text)) !== null) {
    const lower = m[0].toLowerCase();
    if (NAME_STOP_WORDS.has(lower)) continue;
    if (allowed.has(lower)) continue;
    return true;
  }
  return false;
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
