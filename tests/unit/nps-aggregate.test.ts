import { describe, expect, it } from 'vitest';

import { computeNps } from '../../lib/nps/queries';

/**
 * Phase 9 / Commit 32 — pure aggregation correctness.
 *
 * `computeNps` is a TS-pure function so the unit test can drive it
 * with synthetic data and verify the math directly. The DB-side
 * `category` bucket is verified separately in
 * `nps-score-category.test.ts`.
 */

describe('computeNps', () => {
  it('zero responses → zero NPS, zero rates', () => {
    const out = computeNps([], 0);
    expect(out.nps).toBe(0);
    expect(out.responseCount).toBe(0);
    expect(out.invitationCount).toBe(0);
    expect(out.responseRate).toBe(0);
    expect(out.promoterPct).toBe(0);
    expect(out.detractorPct).toBe(0);
  });

  it('all promoters → NPS 100', () => {
    const out = computeNps(
      [
        { category: 'promoter' },
        { category: 'promoter' },
        { category: 'promoter' },
        { category: 'promoter' },
      ],
      4,
    );
    expect(out.nps).toBe(100);
    expect(out.promoterPct).toBe(100);
    expect(out.responseRate).toBe(100);
  });

  it('classic 50/25/25 mix → NPS 25', () => {
    // 4 promoter / 2 passive / 2 detractor = 50/25/25
    // NPS = 50% promoter - 25% detractor = 25
    const out = computeNps(
      [
        { category: 'promoter' },
        { category: 'promoter' },
        { category: 'promoter' },
        { category: 'promoter' },
        { category: 'passive' },
        { category: 'passive' },
        { category: 'detractor' },
        { category: 'detractor' },
      ],
      10,
    );
    expect(out.nps).toBe(25);
    expect(out.promoterPct).toBe(50);
    expect(out.passivePct).toBe(25);
    expect(out.detractorPct).toBe(25);
    expect(out.responseRate).toBe(80);
  });
});
