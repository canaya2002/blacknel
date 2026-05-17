import { describe, expect, it } from 'vitest';

import {
  computeRange,
  makeDelta,
  parseReportFilters,
} from '../../lib/reports/period';

describe('parseReportFilters — happy path', () => {
  it('returns defaults for empty input', () => {
    const f = parseReportFilters({});
    expect(f.section).toBe('overview');
    expect(f.period).toBe('30d');
    expect(f.brandId).toBeNull();
    expect(f.fresh).toBe(false);
  });

  it('parses valid section + period + brand + fresh', () => {
    const f = parseReportFilters({
      section: 'inbox',
      period: '7d',
      brandId: '00000000-0000-4000-8000-000000000001',
      fresh: '1',
    });
    expect(f.section).toBe('inbox');
    expect(f.period).toBe('7d');
    expect(f.brandId).toBe('00000000-0000-4000-8000-000000000001');
    expect(f.fresh).toBe(true);
  });
});

describe('parseReportFilters — drop-on-suspect', () => {
  it('drops invalid section', () => {
    expect(parseReportFilters({ section: 'evil' }).section).toBe('overview');
  });
  it('drops invalid period', () => {
    expect(parseReportFilters({ period: '14d' }).period).toBe('30d');
  });
  it('drops non-UUID brandId', () => {
    expect(parseReportFilters({ brandId: 'not-uuid' }).brandId).toBeNull();
  });
});

describe('computeRange', () => {
  const now = new Date('2026-05-17T12:00:00Z');

  it('30d: current window is [now-30d, now], previous is [now-60d, now-30d]', () => {
    const r = computeRange('30d', now);
    expect(r.currentEnd.toISOString()).toBe(now.toISOString());
    expect(now.getTime() - r.currentStart.getTime()).toBe(30 * 86_400_000);
    expect(r.currentStart.getTime() - r.previousStart.getTime()).toBe(
      30 * 86_400_000,
    );
    expect(r.previousEnd.toISOString()).toBe(r.currentStart.toISOString());
  });

  it('7d window length is 7 × 86_400_000 ms', () => {
    const r = computeRange('7d', now);
    expect(r.windowMs).toBe(7 * 86_400_000);
  });

  it('90d previous window is 180-90 days before now', () => {
    const r = computeRange('90d', now);
    expect(now.getTime() - r.previousEnd.getTime()).toBe(90 * 86_400_000);
    expect(now.getTime() - r.previousStart.getTime()).toBe(180 * 86_400_000);
  });
});

describe('makeDelta — trend semantics', () => {
  it('null current or previous → flat / delta=null', () => {
    expect(makeDelta(null, 5)).toEqual({
      current: null,
      previous: 5,
      delta: null,
      trend: 'flat',
    });
    expect(makeDelta(5, null).trend).toBe('flat');
  });

  it('both zero → flat', () => {
    expect(makeDelta(0, 0).trend).toBe('flat');
  });

  it('previous=0 + current>0 → up + delta=current', () => {
    const d = makeDelta(10, 0);
    expect(d.trend).toBe('up');
    expect(d.delta).toBe(10);
  });

  it('|relative change| < 5% → flat', () => {
    // 100 → 103 is +3% relative.
    expect(makeDelta(103, 100).trend).toBe('flat');
    // 100 → 97 is -3% relative.
    expect(makeDelta(97, 100).trend).toBe('flat');
  });

  it('|relative change| >= 5% honors the sign', () => {
    expect(makeDelta(110, 100).trend).toBe('up');
    expect(makeDelta(90, 100).trend).toBe('down');
  });
});
