/**
 * Mock body for the `review_summary` skill (Commit 22). Roll-up
 * over N reviews with deterministic theme extraction. Phase 11
 * swaps with Haiku per `prompts.REVIEW_SUMMARY_SYSTEM_PROMPT_V1`.
 *
 * Heuristic:
 *   - sentimentBreakdown: counts by rating bucket (4-5★ positive,
 *     3★ neutral, 1-2★ negative) divided by total.
 *   - topPraise: extract first sentence from up to 3 positive
 *     reviews whose body length ≥ 30 chars.
 *   - topConcerns: same for negative reviews.
 *   - summary: 2-3 sentences cobbled from counts + most-common
 *     theme word.
 */

export interface ReviewSummaryMockReview {
  readonly id: string;
  readonly rating: number;
  readonly body: string;
}

export interface ReviewSummaryMockInput {
  readonly reviews: ReadonlyArray<ReviewSummaryMockReview>;
}

export interface ReviewSummaryMockOutput {
  readonly summary: string;
  readonly topPraise: ReadonlyArray<string>;
  readonly topConcerns: ReadonlyArray<string>;
  readonly sentimentBreakdown: {
    readonly positive: number;
    readonly neutral: number;
    readonly negative: number;
  };
}

const FIRST_SENTENCE_RE = /^[^.?!¡¿]{8,200}[.?!]/;

function firstSentence(body: string): string | null {
  const trimmed = body.trim();
  if (trimmed.length === 0) return null;
  const match = trimmed.match(FIRST_SENTENCE_RE);
  if (match) return match[0].trim();
  // Body has no terminal punctuation — return it truncated.
  return trimmed.length > 30 ? trimmed.slice(0, 160).trim() : null;
}

export function mockReviewSummary(
  input: ReviewSummaryMockInput,
): ReviewSummaryMockOutput {
  const reviews = input.reviews;
  const total = reviews.length;
  if (total === 0) {
    return {
      summary: 'No reviews in window.',
      topPraise: [],
      topConcerns: [],
      sentimentBreakdown: { positive: 0, neutral: 0, negative: 0 },
    };
  }

  let pos = 0;
  let neu = 0;
  let neg = 0;
  const praise: string[] = [];
  const concerns: string[] = [];

  for (const r of reviews) {
    if (r.rating >= 4) {
      pos++;
      if (praise.length < 3) {
        const s = firstSentence(r.body);
        if (s) praise.push(s);
      }
    } else if (r.rating === 3) {
      neu++;
    } else {
      neg++;
      if (concerns.length < 3) {
        const s = firstSentence(r.body);
        if (s) concerns.push(s);
      }
    }
  }

  const avg = reviews.reduce((acc, r) => acc + r.rating, 0) / total;
  const summary =
    `Window covers ${total} review${total === 1 ? '' : 's'}, average ${avg.toFixed(1)}★ (${pos} positive, ${neu} neutral, ${neg} negative).` +
    (praise.length > 0
      ? ` Recurring praise: ${praise[0]!.toLowerCase().slice(0, 80)}.`
      : '') +
    (concerns.length > 0
      ? ` Notable concerns: ${concerns[0]!.toLowerCase().slice(0, 80)}.`
      : '');

  return {
    summary: summary.slice(0, 450),
    topPraise: praise,
    topConcerns: concerns,
    sentimentBreakdown: {
      positive: round2(pos / total),
      neutral: round2(neu / total),
      negative: round2(neg / total),
    },
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
