import { describe, expect, it } from 'vitest';

import {
  formatScheduledForDisplay,
  localToUtc,
  MIN_FUTURE_MS,
  utcToLocalParts,
  validateScheduledAt,
} from '../../lib/publish/composer/schedule';

/**
 * Schedule-helpers coverage (Commit 19c.2). Two angles:
 *
 *   1. `validateScheduledAt` rejects past / too-soon / too-far
 *      datetimes and accepts the in-window case.
 *
 *   2. Timezone conversions: a wall-clock entered in
 *      `America/Mexico_City` round-trips correctly through
 *      `localToUtc` → UTC → `utcToLocalParts` in `Asia/Tokyo`,
 *      moving across the international dateline + applying the
 *      +9h offset cleanly.
 */

const FIXED_NOW = new Date('2026-05-15T12:00:00Z');

describe('validateScheduledAt', () => {
  it('rejects a date in the past', () => {
    const result = validateScheduledAt(
      new Date(FIXED_NOW.getTime() - 60_000),
      FIXED_NOW,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('in_past');
  });

  it('rejects a date less than 5 minutes in the future', () => {
    const result = validateScheduledAt(
      new Date(FIXED_NOW.getTime() + 60_000),
      FIXED_NOW,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('too_soon');
  });

  it('accepts a date exactly at the 5-minute boundary', () => {
    const result = validateScheduledAt(
      new Date(FIXED_NOW.getTime() + MIN_FUTURE_MS),
      FIXED_NOW,
    );
    expect(result.ok).toBe(true);
  });

  it('accepts a date inside the 1-year window', () => {
    const result = validateScheduledAt(
      new Date(FIXED_NOW.getTime() + 30 * 24 * 60 * 60_000),
      FIXED_NOW,
    );
    expect(result.ok).toBe(true);
  });

  it('rejects a date more than 1 year in the future', () => {
    const result = validateScheduledAt(
      new Date(FIXED_NOW.getTime() + 400 * 24 * 60 * 60_000),
      FIXED_NOW,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('too_far');
  });

  it('rejects invalid Date (NaN)', () => {
    const result = validateScheduledAt(new Date(NaN), FIXED_NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_date');
  });
});

describe('localToUtc → utcToLocalParts (timezone round-trip)', () => {
  it('MX 14:00 on 2026-05-15 → UTC 20:00', () => {
    // CST (no DST in CDMX as of 2022+) = UTC-6
    const utc = localToUtc('2026-05-15T14:00', 'America/Mexico_City');
    expect(utc.toISOString()).toBe('2026-05-15T20:00:00.000Z');
  });

  it('reading the same UTC instant in Tokyo shows 05:00 the next day', () => {
    // 2026-05-15T20:00Z + 9h Tokyo offset = 2026-05-16T05:00 local
    const utc = new Date('2026-05-15T20:00:00.000Z');
    const parts = utcToLocalParts(utc, 'Asia/Tokyo');
    expect(parts.date).toBe('2026-05-16');
    expect(parts.time).toBe('05:00');
  });

  it('UTC round-trip is the identity', () => {
    const utc = localToUtc('2026-05-15T14:00', 'UTC');
    expect(utc.toISOString()).toBe('2026-05-15T14:00:00.000Z');
    const parts = utcToLocalParts(utc, 'UTC');
    expect(parts.date).toBe('2026-05-15');
    expect(parts.time).toBe('14:00');
  });

  it('returns empty parts for invalid Date inputs', () => {
    const parts = utcToLocalParts(new Date(NaN), 'UTC');
    expect(parts.date).toBe('');
    expect(parts.time).toBe('');
  });

  it('returns NaN Date for malformed local ISO inputs', () => {
    const utc = localToUtc('not-a-date', 'UTC');
    expect(Number.isNaN(utc.getTime())).toBe(true);
  });
});

describe('formatScheduledForDisplay', () => {
  it('produces a human label in the requested timezone + locale', () => {
    const label = formatScheduledForDisplay(
      new Date('2026-05-15T20:00:00.000Z'),
      'America/Mexico_City',
      'en-US',
    );
    // Format is implementation-defined; assert key fragments:
    expect(label).toMatch(/2026/);
    expect(label).toMatch(/14:00/);
  });

  it('returns empty string for invalid date', () => {
    expect(formatScheduledForDisplay(new Date(NaN), 'UTC', 'en-US')).toBe('');
  });
});
