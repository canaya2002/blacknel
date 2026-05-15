/**
 * Calendar-month periods for usage counters. Period boundaries use the
 * organization's timezone where relevant (added later); for Phase 2 we
 * align everyone to UTC — simple, easy to test, fine for limit gating.
 */

export interface MonthPeriod {
  /** Inclusive — first instant of the month. */
  start: Date;
  /** Exclusive — first instant of the next month. */
  end: Date;
}

export function currentMonthPeriod(now: Date = new Date()): MonthPeriod {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start, end };
}

/**
 * Sentinel "covers any plausible moment" window for point-in-time
 * counters (total brands, users, locations, social accounts). Uses
 * timestamps that round-trip cleanly through Postgres timestamptz
 * via Drizzle — Postgres-true `'infinity'` / `'-infinity'` literals
 * aren't portable through every driver / WASM build.
 */
export const INFINITY_PERIOD: MonthPeriod = {
  start: new Date('1900-01-01T00:00:00.000Z'),
  end: new Date('9999-12-31T23:59:59.999Z'),
};

/**
 * True when a counter row's `(period_start, period_end)` covers
 * `at`. Used by the read helper to detect a stale month-counter and
 * roll it forward.
 */
export function periodContains(
  periodStart: Date,
  periodEnd: Date,
  at: Date = new Date(),
): boolean {
  return at.getTime() >= periodStart.getTime() && at.getTime() < periodEnd.getTime();
}
