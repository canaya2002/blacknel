import { describe, expect, it } from 'vitest';

import {
  encodePublishFilters,
  hasActiveFilters,
  parsePublishFilters,
  statusForTab,
} from '../../lib/publish/filters';

/**
 * URL contract for /publish. Mirrors the defensive posture of
 * inbox-filters / reviews-filters / reputation-filters: every
 * recognised value must come from an allow-list, a UUID, or a date
 * validator, and a single bad value drops *its* filter — partial
 * acceptance silently hides results.
 */

const FIXED_NOW = new Date('2026-05-15T12:00:00Z');
const BAD_BRAND = 'definitely-not-a-uuid';
const GOOD_BRAND = '11111111-1111-4111-8111-aa000000d001';

describe('parsePublishFilters defaults', () => {
  it("defaults view='calendar' and cal='month' when params are missing", () => {
    const f = parsePublishFilters({}, { now: FIXED_NOW });
    expect(f.view).toBe('calendar');
    expect(f.cal).toBe('month');
    // `monthDate` defaults to the first-of-month of `now`.
    expect(f.monthDate.toISOString().slice(0, 10)).toBe('2026-05-01');
  });

  it('drops an unknown view value and reverts to calendar', () => {
    const f = parsePublishFilters({ view: 'evil' }, { now: FIXED_NOW });
    expect(f.view).toBe('calendar');
  });

  it('drops an unknown cal value and reverts to month', () => {
    const f = parsePublishFilters({ cal: 'evil' }, { now: FIXED_NOW });
    expect(f.cal).toBe('month');
  });
});

describe('parsePublishFilters allow-lists', () => {
  it('parses recognised statuses and dedupes', () => {
    const f = parsePublishFilters(
      new URLSearchParams('status=draft,scheduled,draft'),
      { now: FIXED_NOW },
    );
    expect(f.status).toEqual(['draft', 'scheduled']);
  });

  it('drops the whole status filter when any value is outside the allow-list', () => {
    const f = parsePublishFilters(
      new URLSearchParams('status=draft,evil'),
      { now: FIXED_NOW },
    );
    expect(f.status).toBeUndefined();
  });

  it('drops a malformed brandId and a malformed campaignId', () => {
    const f = parsePublishFilters(
      new URLSearchParams(`brandId=${BAD_BRAND}&campaignId=${BAD_BRAND}`),
      { now: FIXED_NOW },
    );
    expect(f.brandId).toBeUndefined();
    expect(f.campaignId).toBeUndefined();
  });

  it('accepts a valid brandId', () => {
    const f = parsePublishFilters(new URLSearchParams(`brandId=${GOOD_BRAND}`), {
      now: FIXED_NOW,
    });
    expect(f.brandId).toBe(GOOD_BRAND);
  });
});

describe('parsePublishFilters date range', () => {
  it('accepts a valid scheduledFrom/scheduledTo pair', () => {
    const f = parsePublishFilters(
      new URLSearchParams('scheduledFrom=2026-05-01&scheduledTo=2026-05-15'),
      { now: FIXED_NOW },
    );
    expect(f.scheduledFrom).toBe('2026-05-01');
    expect(f.scheduledTo).toBe('2026-05-15');
  });

  it('drops the range when from > to (defensive all-or-nothing)', () => {
    const f = parsePublishFilters(
      new URLSearchParams('scheduledFrom=2026-05-15&scheduledTo=2026-05-01'),
      { now: FIXED_NOW },
    );
    expect(f.scheduledFrom).toBeUndefined();
    expect(f.scheduledTo).toBeUndefined();
  });

  it('drops the range when it exceeds 365 days', () => {
    const f = parsePublishFilters(
      new URLSearchParams('scheduledFrom=2024-01-01&scheduledTo=2026-01-01'),
      { now: FIXED_NOW },
    );
    expect(f.scheduledFrom).toBeUndefined();
    expect(f.scheduledTo).toBeUndefined();
  });

  it('drops a malformed date', () => {
    const f = parsePublishFilters(
      new URLSearchParams('scheduledFrom=2026-13-99&scheduledTo=2026-05-30'),
      { now: FIXED_NOW },
    );
    expect(f.scheduledFrom).toBeUndefined();
    expect(f.scheduledTo).toBeUndefined();
  });
});

describe('parsePublishFilters month', () => {
  it("parses ?month=YYYY-MM", () => {
    const f = parsePublishFilters(new URLSearchParams('month=2026-01'), {
      now: FIXED_NOW,
    });
    expect(f.monthDate.toISOString().slice(0, 10)).toBe('2026-01-01');
  });

  it('drops a malformed month and falls back to now', () => {
    const f = parsePublishFilters(new URLSearchParams('month=2026-13'), {
      now: FIXED_NOW,
    });
    expect(f.monthDate.toISOString().slice(0, 10)).toBe('2026-05-01');
  });
});

describe('statusForTab', () => {
  it('drafts → ["draft","pending_approval"]', () => {
    expect(statusForTab('drafts')).toEqual(['draft', 'pending_approval']);
  });
  it('scheduled → ["scheduled","publishing"]', () => {
    expect(statusForTab('scheduled')).toEqual(['scheduled', 'publishing']);
  });
  it('published → ["published"]', () => {
    expect(statusForTab('published')).toEqual(['published']);
  });
  it('failed → ["failed"]', () => {
    expect(statusForTab('failed')).toEqual(['failed']);
  });
  it('calendar without explicit status returns undefined (all non-cancelled)', () => {
    expect(statusForTab('calendar')).toBeUndefined();
  });
  it('calendar honors the user-supplied status filter when provided', () => {
    expect(statusForTab('calendar', ['published'])).toEqual(['published']);
  });
});

describe('hasActiveFilters', () => {
  it('returns false when only view/cal/month are present', () => {
    const f = parsePublishFilters({}, { now: FIXED_NOW });
    expect(hasActiveFilters(f)).toBe(false);
  });
  it('returns true when status is set', () => {
    const f = parsePublishFilters(new URLSearchParams('status=draft'), {
      now: FIXED_NOW,
    });
    expect(hasActiveFilters(f)).toBe(true);
  });
  it('returns true when a search query is set', () => {
    const f = parsePublishFilters(new URLSearchParams('q=launch'), {
      now: FIXED_NOW,
    });
    expect(hasActiveFilters(f)).toBe(true);
  });
});

describe('encodePublishFilters', () => {
  it("omits view='calendar' (default) but emits view='failed'", () => {
    const f1 = parsePublishFilters({}, { now: FIXED_NOW });
    expect(encodePublishFilters(f1).get('view')).toBeNull();
    const f2 = parsePublishFilters({ view: 'failed' }, { now: FIXED_NOW });
    expect(encodePublishFilters(f2).get('view')).toBe('failed');
  });

  it("omits cal='month' (default) but emits cal='list'", () => {
    const f1 = parsePublishFilters({}, { now: FIXED_NOW });
    expect(encodePublishFilters(f1).get('cal')).toBeNull();
    const f2 = parsePublishFilters({ cal: 'list' }, { now: FIXED_NOW });
    expect(encodePublishFilters(f2).get('cal')).toBe('list');
  });

  it('round-trips status filters', () => {
    const f = parsePublishFilters(
      new URLSearchParams('status=draft,scheduled'),
      { now: FIXED_NOW },
    );
    expect(encodePublishFilters(f).get('status')).toBe('draft,scheduled');
  });
});
