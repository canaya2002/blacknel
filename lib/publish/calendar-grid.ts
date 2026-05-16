/**
 * Pure helpers for the /publish month calendar.
 *
 * # Timezone discipline (Ajuste A)
 *
 * Every Y/M/D label exposed by these helpers is interpreted in the
 * caller-supplied `timeZone`. Posts whose UTC `scheduledAt` /
 * `publishedAt` falls on the same *local* calendar day are bucketed
 * into the same `dateKey`. That means a post with
 * `scheduledAt='2026-01-01T01:00:00Z'` appears on:
 *
 *   - 2025-12-31 for `America/Mexico_City` (UTC-6 in January)
 *   - 2026-01-01 for `Asia/Tokyo`            (UTC+9)
 *   - 2026-01-01 for `UTC`
 *
 * The grid structure itself (which day is in row N, column M) is
 * computed from abstract Y/M/D labels — Gregorian day-of-week is
 * timezone-independent for an abstract date. Only the *grouping* of
 * posts to grid cells requires the timezone.
 *
 * We use `Intl.DateTimeFormat` with `en-CA` locale (native
 * `YYYY-MM-DD` output) instead of pulling `date-fns-tz`. No new
 * dependency.
 */

import type { CalendarPost } from './queries';

export interface DayCell {
  /** Abstract calendar day this cell represents (Y/M/D in the user's tz). */
  readonly dateKey: string;
  /** UTC-anchored Date constructed from (Y, M, D) for sorting/labels. */
  readonly date: Date;
  /** True when the cell shows a day from the prev/next month (dimmed). */
  readonly isOtherMonth: boolean;
}

// ---------------------------------------------------------------------------
// Grid construction
// ---------------------------------------------------------------------------

/**
 * Builds a 6×7 = 42 cell grid covering the month of `monthDate`. The
 * grid starts on Sunday (column 0) and wraps cells from the previous
 * and next months until full. Day-of-week is computed from the
 * abstract (Y, M, D) label so DST transitions never shift the grid.
 *
 * `timeZone` is accepted for symmetry with `groupPostsByDay` but is
 * not consulted here — see the file-level note.
 */
export function buildMonthGrid(monthDate: Date, timeZone: string): ReadonlyArray<DayCell> {
  void timeZone;
  const year = monthDate.getUTCFullYear();
  const month = monthDate.getUTCMonth();

  const firstOfMonth = new Date(Date.UTC(year, month, 1));
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  // 0 = Sunday … 6 = Saturday.
  const firstWeekday = firstOfMonth.getUTCDay();
  const daysInPrevMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  const cells: DayCell[] = [];

  // Tail of the previous month — fills columns 0..firstWeekday-1 of row 0.
  for (let i = firstWeekday - 1; i >= 0; i--) {
    const day = daysInPrevMonth - i;
    cells.push(makeCell(year, month - 1, day, true));
  }

  // The current month, in order.
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push(makeCell(year, month, day, false));
  }

  // Leading days of the next month — pad to 42 cells (6 weeks). Even
  // a 28-day month starting on a Sunday lands in 35; we always
  // render the same height so the layout doesn't jump month-to-month.
  let nextDay = 1;
  while (cells.length < 42) {
    cells.push(makeCell(year, month + 1, nextDay, true));
    nextDay += 1;
  }

  return cells;
}

function makeCell(year: number, month: number, day: number, isOtherMonth: boolean): DayCell {
  const date = new Date(Date.UTC(year, month, day));
  return {
    date,
    dateKey: dateKeyFromAbstract(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
    isOtherMonth,
  };
}

function dateKeyFromAbstract(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Post → day bucketing
// ---------------------------------------------------------------------------

export interface GroupedDay {
  readonly dateKey: string;
  readonly posts: ReadonlyArray<CalendarPost>;
  /** ≥ 1 post in `failed`. */
  readonly hasFailed: boolean;
  /** ≥ 1 post in `pending_approval`. */
  readonly hasPendingApproval: boolean;
}

/**
 * Groups `posts` into a map keyed by local `YYYY-MM-DD` in `timeZone`.
 * Each bucket is sorted by `scheduledAt` ascending (falling back to
 * `publishedAt` for posts published immediately) — Ajuste 2 rule.
 *
 * Cells in `gridDays` always exist in the returned map (with an
 * empty bucket) so renderers can iterate the grid without null
 * checks.
 */
export function groupPostsByDay(
  posts: ReadonlyArray<CalendarPost>,
  gridDays: ReadonlyArray<DayCell>,
  timeZone: string,
): ReadonlyMap<string, GroupedDay> {
  const byKey = new Map<string, CalendarPost[]>();
  for (const cell of gridDays) byKey.set(cell.dateKey, []);

  const dtf = makeDateKeyFormatter(timeZone);

  for (const post of posts) {
    const utcDate = post.scheduledAt ?? post.publishedAt;
    if (!utcDate) continue;
    const key = dtf.format(utcDate);
    const bucket = byKey.get(key);
    if (bucket) bucket.push(post);
    // If the bucket doesn't exist, the post falls outside the
    // visible grid window — the loader already constrains to the
    // current month, so this happens only for posts on the very
    // edge of an adjacent month that didn't get included.
  }

  const out = new Map<string, GroupedDay>();
  for (const [dateKey, bucket] of byKey) {
    bucket.sort((a, b) => {
      const ta = (a.scheduledAt ?? a.publishedAt)?.getTime() ?? 0;
      const tb = (b.scheduledAt ?? b.publishedAt)?.getTime() ?? 0;
      return ta - tb;
    });
    out.set(dateKey, {
      dateKey,
      posts: bucket,
      hasFailed: bucket.some((p) => p.status === 'failed'),
      hasPendingApproval: bucket.some((p) => p.status === 'pending_approval'),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Day-key for a single UTC date
// ---------------------------------------------------------------------------

/**
 * Returns the `YYYY-MM-DD` label for `utcDate` interpreted in
 * `timeZone`. Useful outside the grid (e.g. the calendar list view
 * groups posts the same way).
 */
export function dateKeyInZone(utcDate: Date, timeZone: string): string {
  return makeDateKeyFormatter(timeZone).format(utcDate);
}

/** Returns today's `YYYY-MM-DD` in the org's timezone. */
export function todayKeyInZone(now: Date, timeZone: string): string {
  return makeDateKeyFormatter(timeZone).format(now);
}

function makeDateKeyFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

// ---------------------------------------------------------------------------
// Month navigation
// ---------------------------------------------------------------------------

/** Returns the first-of-month for the month before `monthDate`. */
export function prevMonth(monthDate: Date): Date {
  return new Date(
    Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth() - 1, 1),
  );
}

/** Returns the first-of-month for the month after `monthDate`. */
export function nextMonth(monthDate: Date): Date {
  return new Date(
    Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth() + 1, 1),
  );
}

/** Returns the first-of-month *containing* `now` in `timeZone`. */
export function thisMonthIn(now: Date, timeZone: string): Date {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
  });
  const parts = dtf.format(now).split('-');
  const y = Number(parts[0]);
  const m = Number(parts[1]) - 1;
  return new Date(Date.UTC(y, m, 1));
}

/** `YYYY-MM` string for the `?month=` URL param. */
export function monthParamValue(monthDate: Date): string {
  const y = monthDate.getUTCFullYear();
  const m = String(monthDate.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/**
 * Display label for the month nav, e.g. "Enero 2026". The label
 * uses `locale`; `timeZone='UTC'` keeps the formatter on the
 * abstract Y/M (the date we pass in is anchored at UTC 00:00).
 */
export function monthLabel(monthDate: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'long',
  }).format(monthDate);
}

// ---------------------------------------------------------------------------
// Weekday header labels — Sunday-first to match buildMonthGrid order
// ---------------------------------------------------------------------------

export function weekdayLabels(locale: string): ReadonlyArray<string> {
  // A known Sunday (2024-01-07) anchors the rotation; locale formats
  // each weekday name in its short form.
  const dtf = new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    weekday: 'short',
  });
  const out: string[] = [];
  for (let i = 0; i < 7; i++) {
    out.push(dtf.format(new Date(Date.UTC(2024, 0, 7 + i))));
  }
  return out;
}
