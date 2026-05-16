import { describe, expect, it } from 'vitest';

import {
  encodeReputationFilters,
  parseReputationFilters,
  previousWindow,
} from '../../lib/reputation/filters';

/**
 * URL parsing for /reputation. Smaller surface than /reviews:
 * brandId, locationId, platform, dateRange (preset OR custom).
 *
 * Default when nothing is provided: last 30 days. Custom range
 * (both bounds) beats preset. Single-bound custom falls back to
 * preset / default.
 */

const FIXED_NOW = new Date('2026-05-15T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

describe('parseReputationFilters', () => {
  it('defaults to preset=30 when nothing is provided', () => {
    const f = parseReputationFilters({}, { now: FIXED_NOW });
    expect(f.preset).toBe(30);
    expect(f.windowDays).toBe(30);
    expect(f.dateTo.getTime()).toBe(FIXED_NOW.getTime());
    expect(f.dateFrom.getTime()).toBe(FIXED_NOW.getTime() - 30 * DAY);
  });

  it('parses preset=90', () => {
    const f = parseReputationFilters(new URLSearchParams('preset=90'), {
      now: FIXED_NOW,
    });
    expect(f.preset).toBe(90);
    expect(f.windowDays).toBe(90);
  });

  it('drops preset=15 (not in allow-list) and falls back to default 30', () => {
    const f = parseReputationFilters(new URLSearchParams('preset=15'), {
      now: FIXED_NOW,
    });
    expect(f.preset).toBe(30);
  });

  it('parses a valid custom range', () => {
    const f = parseReputationFilters(
      new URLSearchParams('dateFrom=2026-04-01&dateTo=2026-04-30'),
      { now: FIXED_NOW },
    );
    expect(f.preset).toBe('custom');
    expect(f.dateFrom.toISOString().slice(0, 10)).toBe('2026-04-01');
    expect(f.dateTo.toISOString().slice(0, 10)).toBe('2026-04-30');
  });

  it('rejects malformed custom dates and falls back to default', () => {
    const f = parseReputationFilters(
      new URLSearchParams('dateFrom=2026-13-99&dateTo=2026-04-30'),
      { now: FIXED_NOW },
    );
    expect(f.preset).toBe(30);
  });

  it('rejects custom from > to and falls back to default', () => {
    const f = parseReputationFilters(
      new URLSearchParams('dateFrom=2026-04-30&dateTo=2026-04-01'),
      { now: FIXED_NOW },
    );
    expect(f.preset).toBe(30);
  });

  it('rejects custom dateTo in the future and falls back to default', () => {
    const f = parseReputationFilters(
      new URLSearchParams('dateFrom=2026-04-01&dateTo=2027-01-01'),
      { now: FIXED_NOW },
    );
    expect(f.preset).toBe(30);
  });

  it('falls back to preset when only one custom bound is provided', () => {
    const f = parseReputationFilters(
      new URLSearchParams('dateFrom=2026-04-01&preset=90'),
      { now: FIXED_NOW },
    );
    expect(f.preset).toBe(90);
  });

  it('validates brandId / locationId as UUIDs', () => {
    const f = parseReputationFilters(
      new URLSearchParams('brandId=bogus&locationId=bogus'),
      { now: FIXED_NOW },
    );
    expect(f.brandId).toBeUndefined();
    expect(f.locationId).toBeUndefined();
  });

  it('validates platform against the allow-list', () => {
    const f = parseReputationFilters(new URLSearchParams('platform=evil'), {
      now: FIXED_NOW,
    });
    expect(f.platform).toBeUndefined();
  });

  it('accepts valid platform', () => {
    const f = parseReputationFilters(new URLSearchParams('platform=gbp'), {
      now: FIXED_NOW,
    });
    expect(f.platform).toBe('gbp');
  });
});

describe('previousWindow', () => {
  it('mirrors the current window size immediately before dateFrom', () => {
    const f = parseReputationFilters(new URLSearchParams('preset=30'), {
      now: FIXED_NOW,
    });
    const { prevFrom, prevTo } = previousWindow(f);
    expect(prevTo.getTime()).toBe(f.dateFrom.getTime());
    expect(f.dateFrom.getTime() - prevFrom.getTime()).toBe(
      f.dateTo.getTime() - f.dateFrom.getTime(),
    );
  });
});

describe('encodeReputationFilters', () => {
  it('round-trips a preset', () => {
    const f = parseReputationFilters(new URLSearchParams('preset=90'), {
      now: FIXED_NOW,
    });
    const enc = encodeReputationFilters(f);
    expect(enc.get('preset')).toBe('90');
    expect(enc.get('dateFrom')).toBeNull();
  });

  it('round-trips a custom range', () => {
    const f = parseReputationFilters(
      new URLSearchParams('dateFrom=2026-04-01&dateTo=2026-04-30'),
      { now: FIXED_NOW },
    );
    const enc = encodeReputationFilters(f);
    expect(enc.get('preset')).toBeNull();
    expect(enc.get('dateFrom')).toBe('2026-04-01');
    expect(enc.get('dateTo')).toBe('2026-04-30');
  });
});
