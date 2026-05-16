import type { CalendarPost } from '@/lib/publish/queries';

/**
 * Helpers for the month-grid layout. The grid always renders 6
 * weeks × 7 days = 42 cells; days that belong to the previous /
 * next month are dimmed (Ajuste 2). 6 rows fits every month
 * configuration including the worst-case 31-day month that starts
 * on Saturday.
 */

export interface CalendarCell {
  /** UTC date at 00:00 — anchor for keying. */
  readonly date: Date;
  /** `true` when this cell is inside the viewing month. */
  readonly inMonth: boolean;
  /** `true` when this cell is the *current* UTC date (today subtle). */
  readonly isToday: boolean;
  /** Posts that fall on this cell, sorted by displayTime asc. */
  readonly posts: ReadonlyArray<CellPost>;
}

export interface CellPost {
  readonly id: string;
  readonly text: string;
  readonly status: CalendarPost['status'];
  /**
   * The time the post should show on this cell. For scheduled posts
   * that haven't published yet, this is `scheduled_at`. For
   * published posts, this is `published_at` — if the publish
   * happened on a different day from the original schedule, the post
   * appears on the publish day instead of the schedule day.
   */
  readonly displayTime: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDayUtc(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

function isSameUtcDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

/**
 * Convert a UTC weekday index (0=Sun…6=Sat) to a Monday-first
 * column index (0=Mon…6=Sun) — the locale Blacknel uses across
 * the product.
 */
function mondayFirst(weekday: number): number {
  return (weekday + 6) % 7;
}

/**
 * Build the 42-cell grid for the month containing `monthDate`.
 * `now` lets tests pin "today" deterministically.
 */
export function buildMonthGrid(
  monthDate: Date,
  posts: ReadonlyArray<CalendarPost>,
  now: Date,
): ReadonlyArray<CalendarCell> {
  const firstOfMonth = new Date(
    Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth(), 1),
  );
  const leadOffset = mondayFirst(firstOfMonth.getUTCDay());
  const gridStart = new Date(firstOfMonth.getTime() - leadOffset * DAY_MS);
  const today = startOfDayUtc(now);

  // Index posts by the day they should appear on. A post can
  // produce up to 2 cell-entries because `published_at` and
  // `scheduled_at` may fall on different days — the calendar
  // query already returned them; here we pick the right time per
  // status so the cell shows the relevant moment.
  const byDay = new Map<number, CellPost[]>();
  for (const p of posts) {
    const displayTime =
      p.status === 'published' && p.publishedAt
        ? p.publishedAt
        : p.scheduledAt ?? p.publishedAt ?? null;
    if (!displayTime) continue; // drafts without a date don't appear
    const dayKey = startOfDayUtc(displayTime).getTime();
    let arr = byDay.get(dayKey);
    if (!arr) {
      arr = [];
      byDay.set(dayKey, arr);
    }
    arr.push({
      id: p.id,
      text: p.text,
      status: p.status,
      displayTime,
    });
  }
  for (const arr of byDay.values()) {
    arr.sort((a, b) => a.displayTime.getTime() - b.displayTime.getTime());
  }

  const cells: CalendarCell[] = [];
  for (let i = 0; i < 42; i++) {
    const date = new Date(gridStart.getTime() + i * DAY_MS);
    const dayKey = startOfDayUtc(date).getTime();
    cells.push({
      date,
      inMonth: date.getUTCMonth() === monthDate.getUTCMonth(),
      isToday: isSameUtcDay(date, today),
      posts: byDay.get(dayKey) ?? [],
    });
  }
  return cells;
}

/**
 * Total number of posts inside the viewing month. Excludes the
 * dimmed leading/trailing days so the header count matches what
 * the user "sees" inside the month boundary.
 */
export function countPostsInMonth(
  grid: ReadonlyArray<CalendarCell>,
): number {
  let n = 0;
  for (const c of grid) {
    if (c.inMonth) n += c.posts.length;
  }
  return n;
}

/**
 * The 7 weekday labels rendered atop the grid.
 */
export const WEEKDAY_LABELS_ES_SHORT = [
  'lun',
  'mar',
  'mié',
  'jue',
  'vie',
  'sáb',
  'dom',
] as const;

export function formatHourEs(d: Date): string {
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
