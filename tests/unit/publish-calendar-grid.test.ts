import { describe, expect, it } from 'vitest';

import {
  buildMonthGrid,
  dateKeyInZone,
  groupPostsByDay,
  monthLabel,
  monthParamValue,
  nextMonth,
  prevMonth,
  thisMonthIn,
  weekdayLabels,
} from '../../lib/publish/calendar-grid';
import type { CalendarPost } from '../../lib/publish/queries';

const ANY_TZ = 'UTC';

function post(
  partial: Partial<CalendarPost> & { id: string; scheduledAt?: Date | null },
): CalendarPost {
  return {
    id: partial.id,
    status: partial.status ?? 'scheduled',
    text: partial.text ?? 'Sample',
    scheduledAt: partial.scheduledAt ?? null,
    publishedAt: partial.publishedAt ?? null,
    brandId: partial.brandId ?? null,
    campaignId: partial.campaignId ?? null,
  };
}

describe('buildMonthGrid', () => {
  it('returns exactly 42 cells (6 weeks)', () => {
    const monthDate = new Date(Date.UTC(2026, 4, 1)); // May 2026
    const grid = buildMonthGrid(monthDate, ANY_TZ);
    expect(grid.length).toBe(42);
  });

  it('marks days outside the target month as isOtherMonth', () => {
    const monthDate = new Date(Date.UTC(2026, 4, 1)); // May 2026 starts on Friday
    const grid = buildMonthGrid(monthDate, ANY_TZ);
    // The first cell should be a "previous month" day (April 26).
    expect(grid[0]?.isOtherMonth).toBe(true);
    expect(grid[0]?.dateKey).toBe('2026-04-26');
    // Cell 5 = May 1 (Friday). Cell index 5 is column 5 in row 0 (Sun..Sat).
    expect(grid[5]?.isOtherMonth).toBe(false);
    expect(grid[5]?.dateKey).toBe('2026-05-01');
  });

  it('always starts on Sunday', () => {
    // January 2026 starts on Thursday. The grid should still begin
    // with the Sunday of that week (Dec 28, 2025).
    const monthDate = new Date(Date.UTC(2026, 0, 1));
    const grid = buildMonthGrid(monthDate, ANY_TZ);
    expect(grid[0]?.dateKey).toBe('2025-12-28');
  });

  it('handles December → January boundary in trailing cells', () => {
    const monthDate = new Date(Date.UTC(2025, 11, 1)); // Dec 2025
    const grid = buildMonthGrid(monthDate, ANY_TZ);
    // The last cell of a 42-cell December grid should be in January 2026.
    expect(grid[41]?.dateKey.startsWith('2026-01')).toBe(true);
  });
});

describe('groupPostsByDay — timezone boundary (Ajuste A)', () => {
  // Anchor case from the master prompt: 2026-01-01T01:00Z falls on
  // different calendar days depending on the user's timezone.
  const earlyJan = post({
    id: 'p1',
    scheduledAt: new Date('2026-01-01T01:00:00Z'),
  });

  it('America/Mexico_City buckets the post into 2025-12-31', () => {
    const tz = 'America/Mexico_City';
    const grid = buildMonthGrid(new Date(Date.UTC(2025, 11, 1)), tz);
    const groups = groupPostsByDay([earlyJan], grid, tz);
    const bucket = groups.get('2025-12-31');
    expect(bucket?.posts.length).toBe(1);
    expect(bucket?.posts[0]?.id).toBe('p1');
  });

  it('Asia/Tokyo buckets the same post into 2026-01-01', () => {
    const tz = 'Asia/Tokyo';
    const grid = buildMonthGrid(new Date(Date.UTC(2026, 0, 1)), tz);
    const groups = groupPostsByDay([earlyJan], grid, tz);
    const bucket = groups.get('2026-01-01');
    expect(bucket?.posts.length).toBe(1);
  });

  it('UTC buckets the post into 2026-01-01', () => {
    const tz = 'UTC';
    const grid = buildMonthGrid(new Date(Date.UTC(2026, 0, 1)), tz);
    const groups = groupPostsByDay([earlyJan], grid, tz);
    const bucket = groups.get('2026-01-01');
    expect(bucket?.posts.length).toBe(1);
  });
});

describe('groupPostsByDay sorting + flags', () => {
  it('sorts posts in a day by scheduledAt ascending (Ajuste 2)', () => {
    const tz = 'UTC';
    const a = post({ id: 'a', scheduledAt: new Date('2026-05-10T14:00:00Z') });
    const b = post({ id: 'b', scheduledAt: new Date('2026-05-10T09:00:00Z') });
    const c = post({ id: 'c', scheduledAt: new Date('2026-05-10T19:00:00Z') });
    const grid = buildMonthGrid(new Date(Date.UTC(2026, 4, 1)), tz);
    const groups = groupPostsByDay([a, b, c], grid, tz);
    const bucket = groups.get('2026-05-10');
    expect(bucket?.posts.map((p) => p.id)).toEqual(['b', 'a', 'c']);
  });

  it('flags hasFailed and hasPendingApproval on the day', () => {
    const tz = 'UTC';
    const f = post({
      id: 'f',
      scheduledAt: new Date('2026-05-10T09:00:00Z'),
      status: 'failed',
    });
    const p = post({
      id: 'p',
      scheduledAt: new Date('2026-05-10T10:00:00Z'),
      status: 'pending_approval',
    });
    const grid = buildMonthGrid(new Date(Date.UTC(2026, 4, 1)), tz);
    const groups = groupPostsByDay([f, p], grid, tz);
    const bucket = groups.get('2026-05-10');
    expect(bucket?.hasFailed).toBe(true);
    expect(bucket?.hasPendingApproval).toBe(true);
  });

  it('falls back to publishedAt when scheduledAt is null', () => {
    const tz = 'UTC';
    const published = post({
      id: 'pub',
      scheduledAt: null,
      publishedAt: new Date('2026-05-10T11:00:00Z'),
      status: 'published',
    });
    const grid = buildMonthGrid(new Date(Date.UTC(2026, 4, 1)), tz);
    const groups = groupPostsByDay([published], grid, tz);
    const bucket = groups.get('2026-05-10');
    expect(bucket?.posts.length).toBe(1);
  });
});

describe('dateKeyInZone', () => {
  it('returns the local date in YYYY-MM-DD', () => {
    const d = new Date('2026-01-01T01:00:00Z');
    expect(dateKeyInZone(d, 'America/Mexico_City')).toBe('2025-12-31');
    expect(dateKeyInZone(d, 'Asia/Tokyo')).toBe('2026-01-01');
    expect(dateKeyInZone(d, 'UTC')).toBe('2026-01-01');
  });
});

describe('month navigation', () => {
  it('prevMonth crosses January → December', () => {
    expect(prevMonth(new Date(Date.UTC(2026, 0, 1))).toISOString().slice(0, 7))
      .toBe('2025-12');
  });
  it('nextMonth crosses December → January', () => {
    expect(nextMonth(new Date(Date.UTC(2025, 11, 1))).toISOString().slice(0, 7))
      .toBe('2026-01');
  });
  it('thisMonthIn resolves "now" in the requested timezone', () => {
    const now = new Date('2026-01-01T01:00:00Z');
    expect(monthParamValue(thisMonthIn(now, 'UTC'))).toBe('2026-01');
    expect(monthParamValue(thisMonthIn(now, 'America/Mexico_City')))
      .toBe('2025-12');
  });
});

describe('label helpers', () => {
  it('monthLabel respects locale', () => {
    const m = new Date(Date.UTC(2026, 0, 1));
    expect(monthLabel(m, 'en-US').toLowerCase()).toContain('january');
    expect(monthLabel(m, 'es-MX').toLowerCase()).toContain('enero');
  });

  it('weekdayLabels returns 7 short weekday strings starting Sunday-ish', () => {
    const labels = weekdayLabels('en-US');
    expect(labels.length).toBe(7);
    // Sunday-first: the first label should be Sunday's short name.
    expect(labels[0]?.toLowerCase().startsWith('s')).toBe(true);
  });
});
