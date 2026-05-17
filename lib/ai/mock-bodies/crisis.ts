/**
 * Mock body for the `crisis` skill (Commit 22). Deterministic
 * threshold-based detector. Phase 11 swaps with Opus pattern
 * detection per `prompts.CRISIS_SYSTEM_PROMPT_V1`.
 *
 * Trigger rules (any of):
 *   - `lowRatingCount >= 3` (3+ reviews ≤ 2★ in window).
 *   - `lowRatingRatio >= 0.4` (40%+ of recent reviews ≤ 2★).
 *   - `negativeMessageCount >= 5` (5+ inbox messages classified
 *     negative in window).
 *
 * Severity:
 *   - critical: lowRatingCount >= 7 OR ratio >= 0.7
 *   - high:     lowRatingCount >= 5 OR ratio >= 0.5
 *   - medium:   any trigger met but below high
 *   - low:      no trigger met (crisis=false)
 *
 * Output mirrors the schema in `prompts.CRISIS_SYSTEM_PROMPT_V1`.
 */

export interface CrisisMockInputReview {
  readonly id: string;
  readonly rating: number;
  readonly createdAtIso: string;
}

export interface CrisisMockInputMessage {
  readonly id: string;
  readonly sentiment: 'positive' | 'neutral' | 'negative';
  readonly createdAtIso: string;
}

export interface CrisisMockInput {
  readonly brandName: string;
  readonly windowStartIso: string;
  readonly windowEndIso: string;
  readonly reviews: ReadonlyArray<CrisisMockInputReview>;
  readonly messages: ReadonlyArray<CrisisMockInputMessage>;
}

export interface CrisisMockOutput {
  readonly crisis: boolean;
  readonly severity: 'low' | 'medium' | 'high' | 'critical';
  readonly title: string;
  readonly summary: string;
  readonly evidence: {
    readonly reviewIds: ReadonlyArray<string>;
    readonly messageIds: ReadonlyArray<string>;
  };
  readonly recommendedAction: string;
}

const LOW_RATING_COUNT_TRIGGER = 3;
const LOW_RATING_RATIO_TRIGGER = 0.4;
const NEGATIVE_MESSAGE_COUNT_TRIGGER = 5;

const HIGH_RATING_COUNT = 5;
const HIGH_RATING_RATIO = 0.5;
const CRITICAL_RATING_COUNT = 7;
const CRITICAL_RATING_RATIO = 0.7;

export function mockCrisis(input: CrisisMockInput): CrisisMockOutput {
  const totalReviews = input.reviews.length;
  const lowReviews = input.reviews.filter((r) => r.rating <= 2);
  const lowCount = lowReviews.length;
  const lowRatio = totalReviews > 0 ? lowCount / totalReviews : 0;
  const negativeMessages = input.messages.filter((m) => m.sentiment === 'negative');
  const negativeMessageCount = negativeMessages.length;

  const triggered =
    lowCount >= LOW_RATING_COUNT_TRIGGER ||
    lowRatio >= LOW_RATING_RATIO_TRIGGER ||
    negativeMessageCount >= NEGATIVE_MESSAGE_COUNT_TRIGGER;

  if (!triggered) {
    return {
      crisis: false,
      severity: 'low',
      title: '',
      summary: 'No actionable pattern.',
      evidence: { reviewIds: [], messageIds: [] },
      recommendedAction: '',
    };
  }

  let severity: CrisisMockOutput['severity'] = 'medium';
  if (lowCount >= CRITICAL_RATING_COUNT || lowRatio >= CRITICAL_RATING_RATIO) {
    severity = 'critical';
  } else if (lowCount >= HIGH_RATING_COUNT || lowRatio >= HIGH_RATING_RATIO) {
    severity = 'high';
  }

  const title = `${input.brandName}: ${lowCount} low-rating reviews + ${negativeMessageCount} negative messages`;
  const summary = `Detected ${lowCount}/${totalReviews} reviews ≤ 2★ (${(lowRatio * 100).toFixed(0)}%) AND ${negativeMessageCount} negative inbox messages in window. Pattern warrants escalation.`;
  const recommendedAction =
    severity === 'critical'
      ? 'Escalate to manager immediately. Audit affected locations.'
      : severity === 'high'
        ? 'Notify brand manager today. Draft public response plan.'
        : 'Review thread + reach out to dissatisfied customers within 24h.';

  return {
    crisis: true,
    severity,
    title: title.slice(0, 80),
    summary,
    evidence: {
      reviewIds: lowReviews.map((r) => r.id),
      messageIds: negativeMessages.map((m) => m.id),
    },
    recommendedAction: recommendedAction.slice(0, 120),
  };
}
