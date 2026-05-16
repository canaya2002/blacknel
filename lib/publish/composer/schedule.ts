import type { Result } from '@/lib/types/result';

/**
 * Schedule pure helpers for the composer (Commit 19c.2).
 *
 * Two responsibilities:
 *
 *   1. Validate a proposed UTC instant against now (5 min ahead
 *      lower bound, 1 year ahead upper bound).
 *   2. Convert between wall-clock-in-`timezone` and UTC instants
 *      so the date/time inputs render in the user's local time
 *      while the row stores UTC.
 *
 * Reuses `Intl.DateTimeFormat` with `en-CA` for `YYYY-MM-DD`
 * (same pattern as `lib/publish/calendar-grid.ts`). No `date-fns`
 * dep — we got this far without one.
 */

export const MIN_FUTURE_MS = 5 * 60_000;
export const MAX_FUTURE_MS = 365 * 24 * 60 * 60_000;

// ---------------------------------------------------------------------------
// validation
// ---------------------------------------------------------------------------

export type ScheduleValidationCode =
  | 'too_soon'
  | 'too_far'
  | 'in_past'
  | 'invalid_date';

export interface ScheduleValidationError {
  readonly code: ScheduleValidationCode;
  readonly message: string;
}

/**
 * Returns `ok(true)` when `dateUtc` is at least 5 minutes ahead of
 * `nowUtc` and at most 1 year ahead. The 5-minute floor gives the
 * publish-job (Commit 20) a comfortable lead on dispatch — same
 * convention most social platforms enforce.
 */
export function validateScheduledAt(
  dateUtc: Date,
  nowUtc: Date,
): Result<true, ScheduleValidationError> {
  if (Number.isNaN(dateUtc.getTime())) {
    return {
      ok: false,
      error: { code: 'invalid_date', message: 'Fecha inválida.' },
    };
  }
  const deltaMs = dateUtc.getTime() - nowUtc.getTime();
  if (deltaMs < 0) {
    return {
      ok: false,
      error: { code: 'in_past', message: 'La fecha programada está en el pasado.' },
    };
  }
  if (deltaMs < MIN_FUTURE_MS) {
    return {
      ok: false,
      error: {
        code: 'too_soon',
        message: 'Debe ser al menos 5 minutos en el futuro.',
      },
    };
  }
  if (deltaMs > MAX_FUTURE_MS) {
    return {
      ok: false,
      error: { code: 'too_far', message: 'No se puede programar a más de 1 año.' },
    };
  }
  return { ok: true, data: true };
}

// ---------------------------------------------------------------------------
// timezone conversions
// ---------------------------------------------------------------------------

/**
 * Returns the timezone's UTC offset (in ms) for `utcMs`. Positive
 * offsets mean east of UTC (Asia/Tokyo = +9h → `+9*3600_000`).
 *
 * The trick: ask `Intl.DateTimeFormat` to format the UTC instant
 * in the target timezone, then re-compose those parts as if they
 * were UTC. The difference between the reconstructed value and
 * the original instant IS the offset, by definition.
 */
function getTimezoneOffsetMs(utcMs: number, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = dtf.formatToParts(new Date(utcMs));
  const get = (type: string): number =>
    Number(parts.find((p) => p.type === type)?.value ?? '0');
  // `hour` can be '24' in some locales' boundary cases — normalize.
  const hour = get('hour') === 24 ? 0 : get('hour');
  const localUtcMs = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    hour,
    get('minute'),
    get('second'),
  );
  return localUtcMs - utcMs;
}

/**
 * Wall-clock-in-`timezone` → UTC instant.
 *
 * Inputs:
 *   - `localIso` — `'YYYY-MM-DD'` or `'YYYY-MM-DDTHH:MM'`.
 *   - `timeZone` — IANA name (e.g. `'America/Mexico_City'`).
 *
 * Returns the UTC `Date` whose local clock IN that timezone
 * displays the given wall-clock. DST is handled by iterating
 * twice: the offset depends on the instant, so we make a guess
 * assuming offset=0, get the actual offset at that guess, and
 * subtract.
 */
export function localToUtc(localIso: string, timeZone: string): Date {
  const trimmed = localIso.trim();
  // Accept "YYYY-MM-DD" alone (defaults to 00:00) or with "T" sep.
  const m = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?$/);
  if (!m) return new Date(NaN);
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  const day = Number(m[3]);
  const hour = m[4] ? Number(m[4]) : 0;
  const minute = m[5] ? Number(m[5]) : 0;

  // Initial guess: treat the wall-clock as if it were UTC.
  const guess = Date.UTC(year, month, day, hour, minute);
  // Offset at that instant in the target tz.
  const offset = getTimezoneOffsetMs(guess, timeZone);
  // Apply offset (positive offset = east of UTC, so subtract).
  return new Date(guess - offset);
}

/**
 * UTC instant → wall-clock parts in `timezone`.
 *
 * Returned shape mirrors what HTML `<input type='date'>` and
 * `<input type='time'>` expect (`YYYY-MM-DD` / `HH:MM`). The
 * caller feeds them straight into form inputs.
 */
export function utcToLocalParts(
  dateUtc: Date,
  timeZone: string,
): { date: string; time: string } {
  if (Number.isNaN(dateUtc.getTime())) return { date: '', time: '' };
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  // `en-CA` formats as 'YYYY-MM-DD, HH:MM'.
  const formatted = dtf.format(dateUtc);
  const [date, time] = formatted.split(', ');
  return {
    date: date ?? '',
    // `hour: '2-digit'` with hour12=false can emit '24:00' at boundary —
    // not a valid `<input type='time'>` value. Clamp to '00:00'.
    time: (time ?? '').replace(/^24:/, '00:'),
  };
}

/**
 * Human label for the schedule confirmation row.
 * `formatScheduledForDisplay(d, 'America/Mexico_City', 'es-MX')`
 * → `'mar 15, 14:30 CST'` (locale + tz dependent).
 */
export function formatScheduledForDisplay(
  dateUtc: Date,
  timeZone: string,
  locale: string,
): string {
  if (Number.isNaN(dateUtc.getTime())) return '';
  const dtf = new Intl.DateTimeFormat(locale, {
    timeZone,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZoneName: 'short',
  });
  return dtf.format(dateUtc);
}

/**
 * Returns the IANA timezone's short label (e.g. `'CST'`, `'JST'`,
 * `'UTC'`) for `now`. Drives the "Hora local de tu org: …" badge
 * next to the form.
 */
export function timezoneShortLabel(now: Date, timeZone: string, locale: string): string {
  const dtf = new Intl.DateTimeFormat(locale, {
    timeZone,
    timeZoneName: 'short',
  });
  const parts = dtf.formatToParts(now);
  const tz = parts.find((p) => p.type === 'timeZoneName');
  return tz?.value ?? timeZone;
}

