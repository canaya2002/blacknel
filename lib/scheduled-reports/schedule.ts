/**
 * Schedule expression → next-run computation (Phase 9 / Commit 34).
 *
 * R-34-1: `next_run_at` is computed **respecting the org's
 * timezone** so a "monday 09:00" schedule for an
 * `America/Mexico_City` org fires at 09:00 CDMX, not 09:00 UTC.
 * The output is always a UTC `Date` — Postgres stores in UTC and
 * the cron tick compares against `now()`. The TZ awareness lives
 * only at compute time; everywhere downstream we work in UTC.
 *
 * Implementation choice: hand-rolled, no IANA tz database
 * dependency. We use `Intl.DateTimeFormat({ timeZone })` to
 * resolve the local clock, then probe in 1-minute steps from
 * `from` forward until we hit the target. The cron tick runs at
 * 15-min cadence so the probe is bounded (max ~10080 mins/week =
 * tens of ms). Phase 11 swaps to a real cron library once
 * Inngest is in play.
 */

const DOW: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

interface ScheduleSpec {
  /** 'dow' for weekly, 'dom' for monthly. */
  readonly kind: 'dow' | 'dom';
  /** Day-of-week (0..6) for weekly; day-of-month (1..28) for monthly. */
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

export function parseScheduleExpr(expr: string): ScheduleSpec | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 2) return null;
  const [dayPart, timePart] = parts;
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(timePart!);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (dayPart && dayPart in DOW) {
    return { kind: 'dow', day: DOW[dayPart]!, hour, minute };
  }
  const n = Number(dayPart);
  if (Number.isInteger(n) && n >= 1 && n <= 28) {
    return { kind: 'dom', day: n, hour, minute };
  }
  return null;
}

/**
 * Returns the local clock components (`year, month (0-11), date,
 * dow (0=Sun), hour, minute`) for a UTC instant inside the given
 * IANA timezone. Uses `Intl.DateTimeFormat` which every Node ≥ 16
 * runtime ships.
 */
function clockInTz(
  utcMs: number,
  timeZone: string,
): {
  year: number;
  month: number;
  date: number;
  dow: number;
  hour: number;
  minute: number;
} {
  const d = new Date(utcMs);
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false,
  });
  const parts = dtf.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '0';
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return {
    year: Number(get('year')),
    month: Number(get('month')) - 1,
    date: Number(get('day')),
    dow: weekdayMap[get('weekday')] ?? 0,
    hour: Number(get('hour') === '24' ? '0' : get('hour')),
    minute: Number(get('minute')),
  };
}

/**
 * Compute the next firing time AFTER `from` (exclusive), respecting
 * the org `timeZone`.
 *
 * Probe strategy: step minute-by-minute from `from + 1min` forward,
 * stopping at the first instant whose local clock matches `spec`.
 * Bounded:
 *   - weekly  → max 7×24×60 = 10080 minutes ≈ ~3ms loop
 *   - monthly → max 28×24×60 = 40320 minutes ≈ ~10ms loop
 * Acceptable inside a 15-min cron tick.
 */
export function computeNextRunAt(
  expr: string,
  from: Date,
  timeZone = 'UTC',
): Date | null {
  const spec = parseScheduleExpr(expr);
  if (!spec) return null;
  // Start from the next minute boundary AFTER `from`.
  const startMs =
    Math.floor(from.getTime() / 60_000) * 60_000 + 60_000;
  const maxMins = spec.kind === 'dow' ? 7 * 24 * 60 : 31 * 24 * 60;
  for (let i = 0; i < maxMins; i += 1) {
    const candidate = startMs + i * 60_000;
    const clock = clockInTz(candidate, timeZone);
    if (clock.hour !== spec.hour) continue;
    if (clock.minute !== spec.minute) continue;
    if (spec.kind === 'dow') {
      if (clock.dow === spec.day) return new Date(candidate);
    } else {
      if (clock.date === spec.day) return new Date(candidate);
    }
  }
  return null;
}

/** Same as `computeNextRunAt` but a one-shot helper used by Server
 *  Actions and the cron tick to keep the call sites short. */
export function nextRunAfter(
  expr: string,
  timeZone: string,
  from: Date = new Date(),
): Date | null {
  return computeNextRunAt(expr, from, timeZone);
}
