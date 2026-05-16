import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { log } from '../../lib/log';
import {
  encodeReviewFilters,
  hasActiveFilters,
  isNarrowSlice,
  narrowSliceLabel,
  parseReviewFilters,
} from '../../lib/reviews/filters';

/**
 * Reviews filter parsing. Mirrors `inbox-filters.test.ts` and adds the
 * two reviews-specific concerns:
 *
 *   - Plan-gated platforms: `?platform=yelp` on Growth must drop the
 *     filter AND log a `reviews.filter.suspicious_input` event with
 *     reason `gated_platform` (Ajuste 4).
 *   - Date range: malformed dates, inverted bounds, future `dateTo`
 *     and overlong ranges drop *both* bounds atomically.
 */

const FIXED_TODAY = new Date('2026-05-15T00:00:00Z');

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(log, 'warn');
});
afterEach(() => {
  warnSpy.mockRestore();
});

describe('parseReviewFilters — basics', () => {
  it('returns empty filters for empty input', () => {
    const out = parseReviewFilters({}, { plan: 'growth', today: FIXED_TODAY });
    expect(out.filters).toEqual({});
    expect(out.cursor).toBeUndefined();
    expect(out.gatedPlatforms).toEqual([]);
  });

  it('parses multi-value allow-listed filters', () => {
    const { filters } = parseReviewFilters(
      new URLSearchParams('status=pending,responded&sentiment=negative'),
      { plan: 'growth', today: FIXED_TODAY },
    );
    expect(filters.status).toEqual(['pending', 'responded']);
    expect(filters.sentiment).toEqual(['negative']);
  });

  it('parses rating as integers, drops the filter on out-of-range values', () => {
    const ok = parseReviewFilters(new URLSearchParams('rating=1,2,5'), {
      plan: 'growth',
      today: FIXED_TODAY,
    });
    expect(ok.filters.rating).toEqual([1, 2, 5]);

    const bad = parseReviewFilters(new URLSearchParams('rating=1,9'), {
      plan: 'growth',
      today: FIXED_TODAY,
    });
    expect(bad.filters.rating).toBeUndefined();
  });

  it('dedupes repeated values', () => {
    const { filters } = parseReviewFilters(
      new URLSearchParams('status=pending,pending&rating=4,4,5'),
      { plan: 'growth', today: FIXED_TODAY },
    );
    expect(filters.status).toEqual(['pending']);
    expect(filters.rating).toEqual([4, 5]);
  });

  it('validates UUIDs on brandId / locationId', () => {
    const out = parseReviewFilters(
      new URLSearchParams('brandId=bogus&locationId=also-bogus'),
      { plan: 'growth', today: FIXED_TODAY },
    );
    expect(out.filters.brandId).toBeUndefined();
    expect(out.filters.locationId).toBeUndefined();
  });

  it('accepts me / unassigned / UUID on assignedTo', () => {
    expect(
      parseReviewFilters(new URLSearchParams('assignedTo=me'), {
        plan: 'growth',
        today: FIXED_TODAY,
      }).filters.assignedTo,
    ).toBe('me');
    expect(
      parseReviewFilters(new URLSearchParams('assignedTo=unassigned'), {
        plan: 'growth',
        today: FIXED_TODAY,
      }).filters.assignedTo,
    ).toBe('unassigned');
    expect(
      parseReviewFilters(
        new URLSearchParams('assignedTo=22222222-2222-4222-8222-220000000001'),
        { plan: 'growth', today: FIXED_TODAY },
      ).filters.assignedTo,
    ).toBe('22222222-2222-4222-8222-220000000001');
    expect(
      parseReviewFilters(new URLSearchParams('assignedTo=nope'), {
        plan: 'growth',
        today: FIXED_TODAY,
      }).filters.assignedTo,
    ).toBeUndefined();
  });

  it('caps q at 200 chars and lowercases', () => {
    const out = parseReviewFilters(new URLSearchParams(`q=${'A'.repeat(500)}`), {
      plan: 'growth',
      today: FIXED_TODAY,
    });
    expect(out.filters.q?.length).toBe(200);
    expect(out.filters.q).toBe(out.filters.q?.toLowerCase());
  });

  it('preserves cursor separately from filters', () => {
    const out = parseReviewFilters(
      new URLSearchParams('status=pending&cursor=abc'),
      { plan: 'growth', today: FIXED_TODAY },
    );
    expect(out.filters.status).toEqual(['pending']);
    expect(out.cursor).toBe('abc');
  });
});

describe('parseReviewFilters — plan gating (Ajuste 1 + 4)', () => {
  it('strips Yelp from filters on Growth and surfaces it in gatedPlatforms', () => {
    const out = parseReviewFilters(new URLSearchParams('platform=yelp'), {
      plan: 'growth',
      today: FIXED_TODAY,
    });
    expect(out.filters.platform).toBeUndefined();
    expect(out.gatedPlatforms).toEqual(['yelp']);
  });

  it('logs reviews.filter.suspicious_input with reason=gated_platform on URL-pasted gated platform', () => {
    parseReviewFilters(new URLSearchParams('platform=yelp'), {
      plan: 'growth',
      today: FIXED_TODAY,
    });
    expect(warnSpy).toHaveBeenCalled();
    // At least one call carries the suspicious_input message and
    // identifies the rejected value + reason. `mock.calls` is loosely
    // typed by Vitest's generic spy — narrow per-call to inspect.
    const match = warnSpy.mock.calls.find(
      (call: unknown[]) => call[1] === 'reviews.filter.suspicious_input',
    );
    expect(match).toBeDefined();
    const ctx = match?.[0] as {
      field: string;
      rejected: string;
      reason: string;
    };
    expect(ctx.field).toBe('platform');
    expect(ctx.rejected).toBe('yelp');
    expect(ctx.reason).toBe('gated_platform');
  });

  it('partitions a mixed list: keeps allowed platforms, gates the rest', () => {
    const out = parseReviewFilters(
      new URLSearchParams('platform=facebook,yelp,gbp,tripadvisor'),
      { plan: 'growth', today: FIXED_TODAY },
    );
    expect(out.filters.platform).toEqual(['facebook', 'gbp']);
    expect(out.gatedPlatforms).toEqual(['yelp', 'tripadvisor']);
  });

  it('keeps Yelp on Enterprise plan', () => {
    const out = parseReviewFilters(new URLSearchParams('platform=yelp'), {
      plan: 'enterprise',
      today: FIXED_TODAY,
    });
    expect(out.filters.platform).toEqual(['yelp']);
    expect(out.gatedPlatforms).toEqual([]);
  });

  it('drops the entire filter (whitelist semantics) when ANY value is unknown', () => {
    // Same all-or-nothing rule as inbox: an unknown value implies the
    // URL is compromised; partial acceptance would mislead the user.
    const out = parseReviewFilters(
      new URLSearchParams('platform=facebook,evil_injection'),
      { plan: 'enterprise', today: FIXED_TODAY },
    );
    expect(out.filters.platform).toBeUndefined();
  });
});

describe('parseReviewFilters — date range (Ajuste 3)', () => {
  it('accepts a valid ISO range within bounds', () => {
    const { filters } = parseReviewFilters(
      new URLSearchParams('dateFrom=2026-05-01&dateTo=2026-05-10'),
      { plan: 'growth', today: FIXED_TODAY },
    );
    expect(filters.dateFrom).toBe('2026-05-01');
    expect(filters.dateTo).toBe('2026-05-10');
  });

  it('drops BOTH bounds when one is malformed', () => {
    const { filters } = parseReviewFilters(
      new URLSearchParams('dateFrom=2026-13-99&dateTo=2026-05-10'),
      { plan: 'growth', today: FIXED_TODAY },
    );
    expect(filters.dateFrom).toBeUndefined();
    expect(filters.dateTo).toBeUndefined();
  });

  it('drops BOTH bounds when from > to', () => {
    const { filters } = parseReviewFilters(
      new URLSearchParams('dateFrom=2026-05-10&dateTo=2026-05-01'),
      { plan: 'growth', today: FIXED_TODAY },
    );
    expect(filters.dateFrom).toBeUndefined();
    expect(filters.dateTo).toBeUndefined();
  });

  it('rejects dateTo > today', () => {
    const { filters } = parseReviewFilters(
      new URLSearchParams('dateFrom=2026-05-01&dateTo=2026-12-31'),
      { plan: 'growth', today: FIXED_TODAY },
    );
    expect(filters.dateFrom).toBeUndefined();
    expect(filters.dateTo).toBeUndefined();
  });

  it('rejects ranges over 365 days', () => {
    const { filters } = parseReviewFilters(
      new URLSearchParams('dateFrom=2025-01-01&dateTo=2026-05-01'),
      { plan: 'growth', today: FIXED_TODAY },
    );
    expect(filters.dateFrom).toBeUndefined();
    expect(filters.dateTo).toBeUndefined();
  });

  it('logs suspicious_input with reason=malformed_date for non-ISO input', () => {
    parseReviewFilters(new URLSearchParams('dateFrom=last-week'), {
      plan: 'growth',
      today: FIXED_TODAY,
    });
    const match = warnSpy.mock.calls.find(
      (c: unknown[]) =>
        c[1] === 'reviews.filter.suspicious_input' &&
        (c[0] as { reason?: string }).reason === 'malformed_date',
    );
    expect(match).toBeDefined();
  });

  it('logs suspicious_input with reason=invalid_range for inverted bounds', () => {
    parseReviewFilters(
      new URLSearchParams('dateFrom=2026-05-10&dateTo=2026-05-01'),
      { plan: 'growth', today: FIXED_TODAY },
    );
    const match = warnSpy.mock.calls.find(
      (c: unknown[]) =>
        c[1] === 'reviews.filter.suspicious_input' &&
        (c[0] as { reason?: string }).reason === 'invalid_range',
    );
    expect(match).toBeDefined();
  });
});

describe('hasActiveFilters', () => {
  it('is false on empty object', () => {
    expect(hasActiveFilters({})).toBe(false);
  });
  it('is true on any single filter', () => {
    expect(hasActiveFilters({ status: ['pending'] })).toBe(true);
    expect(hasActiveFilters({ q: 'foo' })).toBe(true);
    expect(hasActiveFilters({ dateFrom: '2026-05-01' })).toBe(true);
  });
});

describe('isNarrowSlice + narrowSliceLabel', () => {
  it('flags archived / spam only as narrow', () => {
    expect(isNarrowSlice({ status: ['archived'] })).toBe(true);
    expect(narrowSliceLabel({ status: ['archived'] })).toBe('archivadas');
    expect(isNarrowSlice({ status: ['spam'] })).toBe(true);
  });

  it('flags rating=[1] as narrow', () => {
    expect(isNarrowSlice({ rating: [1] })).toBe(true);
    expect(narrowSliceLabel({ rating: [1] })).toBe('de 1 estrella');
  });

  it('does NOT flag rating=[5] as narrow', () => {
    expect(isNarrowSlice({ rating: [5] })).toBe(false);
  });

  it('does NOT flag pending/responded as narrow', () => {
    expect(isNarrowSlice({ status: ['pending'] })).toBe(false);
    expect(isNarrowSlice({ status: ['pending', 'responded'] })).toBe(false);
  });
});

describe('encodeReviewFilters', () => {
  it('round-trips a typical filter set', () => {
    const filters = {
      status: ['pending'] as const,
      rating: [1, 2] as const,
      q: 'mala atención',
      dateFrom: '2026-05-01',
      dateTo: '2026-05-10',
    };
    const encoded = encodeReviewFilters(filters);
    const reparsed = parseReviewFilters(encoded, {
      plan: 'growth',
      today: FIXED_TODAY,
    });
    expect(reparsed.filters.status).toEqual(filters.status);
    expect(reparsed.filters.rating).toEqual(filters.rating);
    expect(reparsed.filters.q).toBe(filters.q);
    expect(reparsed.filters.dateFrom).toBe(filters.dateFrom);
    expect(reparsed.filters.dateTo).toBe(filters.dateTo);
  });

  it('appends the cursor when provided', () => {
    const encoded = encodeReviewFilters({ status: ['pending'] }, { cursor: 'CUR' });
    expect(encoded.get('cursor')).toBe('CUR');
  });

  it('omits empty filter arrays', () => {
    const encoded = encodeReviewFilters({ status: [], rating: [] });
    expect(encoded.toString()).toBe('');
  });
});
