import { describe, expect, it } from 'vitest';

import { evaluateCrisis } from '../../lib/reputation/crisis-rule';

/**
 * CRISIS_TRIGGER rule cases (Ajuste 2):
 *
 *   triggered = (recentCount >= 5) AND (previousCount <= 1)
 *   severity = recentCount >= 10 ? 'high' : 'medium' (only when triggered)
 *
 * The four canonical scenarios from the spec are locked in below plus
 * boundary cases on each threshold.
 */

describe('evaluateCrisis', () => {
  it('Trattoria Downtown spike (5 recent / 0 prior) → triggered medium', () => {
    const r = evaluateCrisis({ recentCount: 5, previousCount: 0 });
    expect(r.triggered).toBe(true);
    expect(r.severity).toBe('medium');
    expect(r.recentCount).toBe(5);
    expect(r.previousCount).toBe(0);
  });

  it('10+ recent / quiet baseline → triggered high', () => {
    const r = evaluateCrisis({ recentCount: 10, previousCount: 1 });
    expect(r.triggered).toBe(true);
    expect(r.severity).toBe('high');
  });

  it('4 recent (below threshold) → NOT triggered', () => {
    const r = evaluateCrisis({ recentCount: 4, previousCount: 0 });
    expect(r.triggered).toBe(false);
    expect(r.severity).toBeNull();
  });

  it('8 recent BUT 7 prior (baseline high, not a spike) → NOT triggered', () => {
    const r = evaluateCrisis({ recentCount: 8, previousCount: 7 });
    expect(r.triggered).toBe(false);
  });

  it('boundary: 5 recent + 1 prior → triggered medium', () => {
    const r = evaluateCrisis({ recentCount: 5, previousCount: 1 });
    expect(r.triggered).toBe(true);
    expect(r.severity).toBe('medium');
  });

  it('boundary: 5 recent + 2 prior → NOT triggered (baseline too noisy)', () => {
    const r = evaluateCrisis({ recentCount: 5, previousCount: 2 });
    expect(r.triggered).toBe(false);
  });

  it('boundary: 9 recent → medium (one below high threshold)', () => {
    const r = evaluateCrisis({ recentCount: 9, previousCount: 0 });
    expect(r.severity).toBe('medium');
  });

  it('boundary: exactly 10 recent → high', () => {
    const r = evaluateCrisis({ recentCount: 10, previousCount: 0 });
    expect(r.severity).toBe('high');
  });

  it('zero on both → NOT triggered', () => {
    const r = evaluateCrisis({ recentCount: 0, previousCount: 0 });
    expect(r.triggered).toBe(false);
  });
});
