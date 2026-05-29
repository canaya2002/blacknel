import { afterEach, describe, expect, it } from 'vitest';

import {
  _clearLruForTests,
  _lruSizeForTests,
  computeRequestHash,
  getCached,
  setCached,
} from '../../lib/ai/cache';

const baseInput = {
  skill: 'compliance' as const,
  model: 'claude-haiku-4-5' as const,
  systemPrompt: 'You are a gate.',
  userPrompt: 'Classify this draft.',
  input: { text: 'Hola' },
  promptVersion: 'v1',
};

afterEach(() => {
  _clearLruForTests();
});

describe('computeRequestHash', () => {
  it('is deterministic across calls with identical input', () => {
    const a = computeRequestHash(baseInput);
    const b = computeRequestHash({ ...baseInput });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when skill changes', () => {
    const a = computeRequestHash(baseInput);
    const b = computeRequestHash({ ...baseInput, skill: 'caption' });
    expect(a).not.toBe(b);
  });

  it('changes when model changes (Haiku → Opus)', () => {
    const a = computeRequestHash(baseInput);
    const b = computeRequestHash({ ...baseInput, model: 'claude-opus-4-8' });
    expect(a).not.toBe(b);
  });

  it('changes when promptVersion changes (Ajuste 3)', () => {
    const a = computeRequestHash(baseInput);
    const b = computeRequestHash({ ...baseInput, promptVersion: 'v2' });
    expect(a).not.toBe(b);
  });

  it('is stable across key reordering in `input` (canonical JSON)', () => {
    const a = computeRequestHash({ ...baseInput, input: { text: 'Hola', rating: 3 } });
    const b = computeRequestHash({ ...baseInput, input: { rating: 3, text: 'Hola' } });
    expect(a).toBe(b);
  });

  it('changes when systemPrompt body changes by even one char', () => {
    const a = computeRequestHash(baseInput);
    const b = computeRequestHash({ ...baseInput, systemPrompt: 'You are a gate. ' });
    expect(a).not.toBe(b);
  });
});

describe('LRU dedup', () => {
  const ctx = { orgId: '11111111-1111-4111-8111-aa00aa00aa00' };

  it('returns cached output + generationId for the same (orgId, hash)', () => {
    const h = computeRequestHash(baseInput);
    const gid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    setCached(ctx, h, { ok: true }, gid);
    const hit = getCached(ctx, h);
    expect(hit?.output).toEqual({ ok: true });
    expect(hit?.generationId).toBe(gid);
  });

  it('isolates by orgId — orgB cannot see orgA cached value', () => {
    const h = computeRequestHash(baseInput);
    setCached(ctx, h, { ok: true }, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    const ctxB = { orgId: '11111111-1111-4111-8111-bb00bb00bb00' };
    expect(getCached(ctxB, h)).toBeUndefined();
  });

  it('evicts the LRU under the cap (defensive — just smoke test)', () => {
    // Force many entries to exercise the eviction path; we don't
    // pin the exact cap (256) but assert size stays bounded.
    for (let i = 0; i < 1000; i++) {
      const h = computeRequestHash({ ...baseInput, input: { i } });
      setCached(
        ctx,
        h,
        { i },
        `bbbbbbbb-bbbb-4bbb-8bbb-${i.toString(16).padStart(12, '0')}`,
      );
    }
    expect(_lruSizeForTests()).toBeLessThanOrEqual(256);
  });
});
