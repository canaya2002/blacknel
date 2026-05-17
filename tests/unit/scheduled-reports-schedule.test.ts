import { describe, expect, it } from 'vitest';

import {
  computeNextRunAt,
  parseScheduleExpr,
} from '../../lib/scheduled-reports/schedule';

/**
 * Phase 9 / Commit 34 — schedule expression parsing + TZ-aware
 * next-run computation (R-34-1).
 *
 * The TZ test is OBLIGATORY (user requirement). A "mon 09:00"
 * schedule must resolve to 09:00 local time in the target tz, not
 * UTC. We pick `America/Mexico_City` (UTC-6 in non-DST) and verify
 * the UTC firing time lines up.
 */

describe('parseScheduleExpr', () => {
  it('weekly form', () => {
    const s = parseScheduleExpr('mon 09:00');
    expect(s).toEqual({ kind: 'dow', day: 1, hour: 9, minute: 0 });
  });

  it('monthly form', () => {
    const s = parseScheduleExpr('1 09:00');
    expect(s).toEqual({ kind: 'dom', day: 1, hour: 9, minute: 0 });
  });

  it('rejects garbage', () => {
    expect(parseScheduleExpr('not a schedule')).toBeNull();
    expect(parseScheduleExpr('mon 25:00')).toBeNull();
    expect(parseScheduleExpr('99 09:00')).toBeNull(); // day-of-month cap is 28
  });
});

describe('computeNextRunAt — R-34-1 timezone awareness', () => {
  it('weekly "mon 09:00" in America/Mexico_City resolves to UTC-6/UTC-5 local', () => {
    // Sunday 2026-05-17 12:00:00 UTC. Next "mon 09:00" CDMX is
    // Monday 2026-05-18 09:00 CDMX. CDMX is UTC-6 (or -5 in DST —
    // Mexico City stopped DST in 2022, so always -6).
    const from = new Date('2026-05-17T12:00:00Z');
    const next = computeNextRunAt('mon 09:00', from, 'America/Mexico_City');
    expect(next).not.toBeNull();
    // 09:00 CDMX = 15:00 UTC.
    expect(next!.toISOString()).toBe('2026-05-18T15:00:00.000Z');
  });

  it('the same expression in UTC fires 6 hours earlier in UTC', () => {
    const from = new Date('2026-05-17T12:00:00Z');
    const next = computeNextRunAt('mon 09:00', from, 'UTC');
    expect(next).not.toBeNull();
    expect(next!.toISOString()).toBe('2026-05-18T09:00:00.000Z');
  });

  it('weekly schedule rolls forward to next week if already past today', () => {
    // "mon 09:00" — `from` is the same Monday at 14:00 UTC
    // (after the local 09:00 firing time in UTC tz).
    const from = new Date('2026-05-18T14:00:00Z');
    const next = computeNextRunAt('mon 09:00', from, 'UTC');
    expect(next).not.toBeNull();
    // Should land next Monday.
    expect(next!.toISOString()).toBe('2026-05-25T09:00:00.000Z');
  });

  it('monthly "1 09:00" picks next month when today is past day-1', () => {
    const from = new Date('2026-05-17T12:00:00Z');
    const next = computeNextRunAt('1 09:00', from, 'UTC');
    expect(next).not.toBeNull();
    expect(next!.toISOString()).toBe('2026-06-01T09:00:00.000Z');
  });

  it('returns null on garbage expressions', () => {
    expect(
      computeNextRunAt('garbage', new Date(), 'UTC'),
    ).toBeNull();
  });
});
