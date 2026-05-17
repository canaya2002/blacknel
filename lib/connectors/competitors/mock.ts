import { createHash } from 'node:crypto';

/**
 * Competitors mock connector (Phase 9 / Commit 34).
 *
 * Deterministic per `(orgId, competitorId, day, platform)` — same
 * seed yields the same daily rollup. Phase 11 swap candidates:
 *
 *   - **Brand24** — full-platform listening + competitor coverage.
 *   - **SimilarWeb** — share-of-voice industry benchmark.
 *
 * The mock generates:
 *
 *   - `posts_count` per (competitor, platform, day) within
 *     realistic ranges (3-30 depending on platform).
 *   - `engagement_total` proportional to posts_count + noise.
 *   - `sentiment_score` ∈ [-1, 1], drawn from a roughly normal
 *     distribution biased toward neutral (mean ≈ 0.2).
 *   - `own_posts_count` — caller passes the org's own brand
 *     post volume for the same day/platform; the helper computes
 *     SoV from there. Ajuste C: vol-only ratio,
 *     SoV = competitor / (competitor + own).
 */

export interface CompetitorMockMetricInput {
  readonly orgId: string;
  readonly competitorId: string;
  readonly day: string; // ISO date `YYYY-MM-DD`
  readonly platform: string;
  /** Your-brand post volume on the same `(platform, day)` — for SoV. */
  readonly ownPostsCount: number;
}

export interface CompetitorMockMetric {
  readonly postsCount: number;
  readonly engagementTotal: number;
  /** Range [-1, 1]. Aggregate mean sentiment of the competitor's day. */
  readonly sentimentScore: number;
  /** Range [0, 1]. NULL-safe when both sides are zero (→ 0). */
  readonly shareOfVoice: number;
}

function hashUint(input: string, offset: number): number {
  const h = createHash('sha256');
  h.update(`${input}|${offset}`);
  return h.digest().readUInt32LE(0);
}

function pickRange(seed: string, offset: number, min: number, max: number): number {
  const span = max - min + 1;
  return min + (hashUint(seed, offset) % span);
}

function signedUnit(seed: string, offset: number): number {
  // Two-byte spread → ~[-0.5, 0.5]. Centered around 0.
  const raw = hashUint(seed, offset) % 1000;
  return (raw - 500) / 1000;
}

/**
 * Compute share of voice. Ajuste C semantics — vol-only ratio.
 * NULL-safe when both inputs are zero.
 */
export function computeShareOfVoice(
  competitorPosts: number,
  ownPosts: number,
): number {
  const total = competitorPosts + ownPosts;
  if (total === 0) return 0;
  return Math.min(1, Math.max(0, competitorPosts / total));
}

const PLATFORM_VOLUME_RANGES: Record<string, [number, number]> = {
  instagram: [5, 25],
  facebook: [3, 18],
  x: [10, 60],
  tiktok: [4, 20],
  linkedin: [2, 12],
  reddit: [1, 8],
};

export function generateCompetitorMetricForDay(
  input: CompetitorMockMetricInput,
): CompetitorMockMetric {
  const seed = `${input.orgId}|${input.competitorId}|${input.platform}|${input.day}`;
  const range = PLATFORM_VOLUME_RANGES[input.platform] ?? [3, 18];
  const postsCount = pickRange(seed, 0, range[0], range[1]);
  const engagementPerPost = pickRange(seed, 1, 20, 1500);
  const engagementTotal = postsCount * engagementPerPost;
  // Sentiment biased slightly positive (mean ≈ 0.15). Clamped.
  const raw = 0.15 + signedUnit(seed, 2);
  const sentimentScore = Math.min(1, Math.max(-1, Math.round(raw * 100) / 100));
  const shareOfVoice = computeShareOfVoice(postsCount, input.ownPostsCount);
  return {
    postsCount,
    engagementTotal,
    sentimentScore,
    shareOfVoice: Math.round(shareOfVoice * 1000) / 1000,
  };
}
