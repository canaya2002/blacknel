import { describe, expect, it } from 'vitest';

import {
  currentMonthPeriod,
  INFINITY_PERIOD,
  periodContains,
} from '../../lib/usage/period';

describe('currentMonthPeriod', () => {
  it('returns the UTC first-of-month for `now`', () => {
    const now = new Date('2026-05-15T13:00:00.000Z');
    const p = currentMonthPeriod(now);
    expect(p.start.toISOString()).toBe('2026-05-01T00:00:00.000Z');
    expect(p.end.toISOString()).toBe('2026-06-01T00:00:00.000Z');
  });

  it('crosses the year boundary cleanly', () => {
    const dec = new Date('2026-12-20T00:00:00.000Z');
    const p = currentMonthPeriod(dec);
    expect(p.start.toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(p.end.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });
});

describe('periodContains', () => {
  const start = new Date('2026-05-01T00:00:00.000Z');
  const end = new Date('2026-06-01T00:00:00.000Z');

  it('is true inside the period', () => {
    expect(periodContains(start, end, new Date('2026-05-15T12:00:00.000Z'))).toBe(true);
  });

  it('is true at the inclusive start', () => {
    expect(periodContains(start, end, start)).toBe(true);
  });

  it('is false at the exclusive end', () => {
    expect(periodContains(start, end, end)).toBe(false);
  });

  it('is false before the period', () => {
    expect(periodContains(start, end, new Date('2026-04-30T23:59:59.999Z'))).toBe(false);
  });
});

describe('INFINITY_PERIOD', () => {
  it('contains the current moment', () => {
    expect(
      periodContains(INFINITY_PERIOD.start, INFINITY_PERIOD.end, new Date()),
    ).toBe(true);
  });
});
