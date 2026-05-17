import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  _clearReportsCacheForTests,
  _reportsCacheSizeForTests,
  buildKey,
  withReportsCache,
} from '../../lib/reports/cache';

afterEach(() => {
  _clearReportsCacheForTests();
});

describe('buildKey', () => {
  it('is deterministic for the same input', () => {
    const a = buildKey({
      orgId: 'org-a',
      section: 'overview',
      period: '30d',
      brandId: null,
    });
    const b = buildKey({
      orgId: 'org-a',
      section: 'overview',
      period: '30d',
      brandId: null,
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when any field changes', () => {
    const base = {
      orgId: 'org-a',
      section: 'overview',
      period: '30d',
      brandId: null,
    };
    const variants = [
      { ...base, orgId: 'org-b' },
      { ...base, section: 'inbox' },
      { ...base, period: '7d' },
      { ...base, brandId: 'b1' },
    ];
    for (const v of variants) {
      expect(buildKey(v)).not.toBe(buildKey(base));
    }
  });
});

describe('withReportsCache — hit + miss', () => {
  const key = {
    orgId: 'org-a',
    section: 'overview',
    period: '30d',
    brandId: null,
  };

  it('computes on first call + returns cached on second', async () => {
    const compute = vi.fn(async () => ({ value: 42 }));
    const r1 = await withReportsCache(key, false, compute);
    const r2 = await withReportsCache(key, false, compute);
    expect(r1).toEqual({ value: 42 });
    expect(r2).toEqual({ value: 42 });
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('bypass=true skips cache + recomputes', async () => {
    let i = 0;
    const compute = vi.fn(async () => ({ i: i++ }));
    await withReportsCache(key, false, compute);
    const second = await withReportsCache(key, true, compute);
    expect(compute).toHaveBeenCalledTimes(2);
    expect(second.i).toBe(1);
  });

  it('different keys are independent', async () => {
    const compute = vi.fn(async () => ({ x: Math.random() }));
    await withReportsCache(key, false, compute);
    await withReportsCache({ ...key, section: 'inbox' }, false, compute);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it('cap stays bounded under many distinct keys', async () => {
    const compute = vi.fn(async () => 'x');
    for (let i = 0; i < 250; i++) {
      await withReportsCache(
        { orgId: 'org-a', section: 'overview', period: '30d', brandId: `b${i}` },
        false,
        compute,
      );
    }
    expect(_reportsCacheSizeForTests()).toBeLessThanOrEqual(100);
  });
});
