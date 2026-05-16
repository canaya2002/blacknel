import { describe, expect, it } from 'vitest';

import { computeDelta, deltaTone } from '../../lib/reputation/deltas';

/**
 * Delta math (Ajuste 3). The most important invariant: when the prior
 * sample size is < 3 reviews, return `state: 'na'` instead of an
 * inflated percentage. A "+200%" delta off a sample of 1 is theater.
 */

describe('computeDelta', () => {
  it('returns state=ready when prior sample size ≥ 3', () => {
    const r = computeDelta({ current: 4.5, previous: 4.0, previousSampleSize: 10 });
    expect(r.state).toBe('ready');
    expect(r.delta).toBeCloseTo(0.5, 5);
    expect(r.direction).toBe('up');
  });

  it('returns state=na when prior sample size < 3', () => {
    const r = computeDelta({ current: 4.5, previous: 4.0, previousSampleSize: 2 });
    expect(r.state).toBe('na');
    expect(r.delta).toBeNull();
    expect(r.direction).toBeNull();
    expect(r.naReason).toMatch(/insuficientes/i);
  });

  it('boundary: exactly 3 prior reviews → ready', () => {
    const r = computeDelta({ current: 5, previous: 4, previousSampleSize: 3 });
    expect(r.state).toBe('ready');
    expect(r.direction).toBe('up');
  });

  it('direction=down when current is lower', () => {
    const r = computeDelta({ current: 3.0, previous: 4.0, previousSampleSize: 5 });
    expect(r.direction).toBe('down');
  });

  it('direction=flat when current equals previous within EPSILON', () => {
    const r = computeDelta({
      current: 4.0,
      previous: 4.0,
      previousSampleSize: 5,
    });
    expect(r.direction).toBe('flat');
  });

  it('zero-delta floating point: 4.123 - 4.123 still flat', () => {
    const r = computeDelta({
      current: 4.123,
      previous: 4.123,
      previousSampleSize: 5,
    });
    expect(r.direction).toBe('flat');
  });
});

describe('deltaTone', () => {
  it('returns positive when direction matches goodDirection', () => {
    const up = computeDelta({ current: 5, previous: 4, previousSampleSize: 5 });
    expect(deltaTone(up, 'up')).toBe('positive');
  });

  it('returns negative when direction opposes goodDirection', () => {
    const up = computeDelta({ current: 5, previous: 4, previousSampleSize: 5 });
    // For response time, "up" is bad — taking longer to reply.
    expect(deltaTone(up, 'down')).toBe('negative');
  });

  it('returns neutral on flat', () => {
    const flat = computeDelta({ current: 4, previous: 4, previousSampleSize: 5 });
    expect(deltaTone(flat, 'up')).toBe('neutral');
  });

  it('returns neutral on N/A', () => {
    const na = computeDelta({ current: 5, previous: 4, previousSampleSize: 1 });
    expect(deltaTone(na, 'up')).toBe('neutral');
  });
});
