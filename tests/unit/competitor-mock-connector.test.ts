import { describe, expect, it } from 'vitest';

import {
  computeShareOfVoice,
  generateCompetitorMetricForDay,
} from '../../lib/connectors/competitors/mock';

/**
 * Phase 9 / Commit 34 — competitor mock connector + SoV math
 * (Ajuste C documented semantics).
 */

describe('computeShareOfVoice', () => {
  it('returns 0 NULL-safe when both sides are zero', () => {
    expect(computeShareOfVoice(0, 0)).toBe(0);
  });

  it('returns 0.5 at parity', () => {
    expect(computeShareOfVoice(10, 10)).toBe(0.5);
  });

  it('returns 1 when competitor dominates completely', () => {
    expect(computeShareOfVoice(10, 0)).toBe(1);
  });

  it('clamps to [0, 1] even with garbage input', () => {
    expect(computeShareOfVoice(-5, 10)).toBeGreaterThanOrEqual(0);
    expect(computeShareOfVoice(1000, 1)).toBeLessThanOrEqual(1);
  });
});

describe('generateCompetitorMetricForDay determinism', () => {
  const baseInput = {
    orgId: '11111111-1111-4111-8111-c3400c3400c0',
    competitorId: '88888888-8888-4888-8888-c3400c3400c0',
    day: '2026-05-17',
    platform: 'instagram',
    ownPostsCount: 8,
  };

  it('same seed → same metric, every time', () => {
    const a = generateCompetitorMetricForDay(baseInput);
    const b = generateCompetitorMetricForDay(baseInput);
    expect(a.postsCount).toBe(b.postsCount);
    expect(a.engagementTotal).toBe(b.engagementTotal);
    expect(a.sentimentScore).toBe(b.sentimentScore);
    expect(a.shareOfVoice).toBe(b.shareOfVoice);
  });

  it('different days yield different metrics', () => {
    const a = generateCompetitorMetricForDay(baseInput);
    const b = generateCompetitorMetricForDay({
      ...baseInput,
      day: '2026-05-18',
    });
    // At least the posts count or engagement should differ; the
    // chance of full collision across all four fields is negligible.
    const allEqual =
      a.postsCount === b.postsCount &&
      a.engagementTotal === b.engagementTotal &&
      a.sentimentScore === b.sentimentScore;
    expect(allEqual).toBe(false);
  });

  it('respects per-platform volume bands', () => {
    const inst = generateCompetitorMetricForDay(baseInput);
    expect(inst.postsCount).toBeGreaterThanOrEqual(5);
    expect(inst.postsCount).toBeLessThanOrEqual(25);

    const x = generateCompetitorMetricForDay({
      ...baseInput,
      platform: 'x',
    });
    expect(x.postsCount).toBeGreaterThanOrEqual(10);
    expect(x.postsCount).toBeLessThanOrEqual(60);
  });
});
