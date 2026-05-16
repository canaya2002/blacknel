/**
 * Crisis detection rule (Commit 15, Ajuste 2).
 *
 * Phase 7 introduces a richer IA-driven detection (`lib/ai/crisis.ts`)
 * with seasonality suppression, multi-source correlation, and cross-
 * platform spread. Phase 5 ships a deterministic, testable predicate
 * so the dashboard can light up the demo seed's Trattoria Downtown
 * spike without depending on the LLM.
 *
 * # The rule
 *
 *     CRISIS_TRIGGER = (
 *       countNegativeIn72h            ≥ 5
 *       AND
 *       countNegativeInPrevious72h    ≤ 1
 *     )
 *
 * "negative" = rating ≤ 2 (1★ or 2★). The two-window comparison
 * defends against locations with a high baseline of negative reviews
 * — they'd cross 5 in any 72h slice but they aren't actually in a
 * crisis. We require the prior window to be near-silent (≤1) so the
 * trigger only fires on a real spike.
 *
 * # Severity
 *
 *   - count ∈ [5, 9]  → severity 'medium' (amber banner)
 *   - count ≥ 10      → severity 'high'   (red banner)
 *
 * # Year-over-year suppression — deferred to Phase 7
 *
 * Some locations have seasonal volume bursts (a holiday-week
 * restaurant spike, an exam-period clinic dip). A real classifier
 * should compare to the same window last year and downgrade the
 * severity by one level when the location's history shows a similar
 * cluster. This commit does NOT implement that; tracked in
 * `TODO.md#crisis-yoy-suppression`.
 */

export type CrisisSeverity = 'medium' | 'high';

export interface CrisisInput {
  /** Number of reviews with rating ≤2 in the last 72h. */
  recentCount: number;
  /** Number of reviews with rating ≤2 in the 72h window before that. */
  previousCount: number;
}

export interface CrisisResult {
  readonly triggered: boolean;
  readonly severity: CrisisSeverity | null;
  /**
   * Same value as `recentCount` — surfaced separately so the UI
   * doesn't have to look up the input. Severity copy reads e.g.
   * "8 reviews negativas en 72h" off this field.
   */
  readonly recentCount: number;
  /** Same as `previousCount`. */
  readonly previousCount: number;
}

const RECENT_THRESHOLD = 5;
const BASELINE_QUIET_THRESHOLD = 1;
const HIGH_SEVERITY_THRESHOLD = 10;

export function evaluateCrisis(input: CrisisInput): CrisisResult {
  const triggered =
    input.recentCount >= RECENT_THRESHOLD &&
    input.previousCount <= BASELINE_QUIET_THRESHOLD;

  if (!triggered) {
    return {
      triggered: false,
      severity: null,
      recentCount: input.recentCount,
      previousCount: input.previousCount,
    };
  }

  return {
    triggered: true,
    severity:
      input.recentCount >= HIGH_SEVERITY_THRESHOLD ? 'high' : 'medium',
    recentCount: input.recentCount,
    previousCount: input.previousCount,
  };
}

/**
 * Window lengths the crisis evaluator operates on. Exported so the
 * SQL query that supplies `recentCount` / `previousCount` and the
 * test that synthesises them stay in lock-step.
 */
export const CRISIS_WINDOW_HOURS = 72;
