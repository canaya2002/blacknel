import { describe, expect, it } from 'vitest';

import {
  computeEventHash,
  verifyEventHash,
} from '../../lib/audit-advanced/hash';

/**
 * Phase 10 / Commit 37, D-37-2 (a) — per-row tamper hash tests.
 */

describe('computeEventHash / verifyEventHash', () => {
  const baseInput = {
    organizationId: '11111111-1111-4111-8111-c3700c3700c0',
    userId: '22222222-2222-4222-8222-c3700c3700c0',
    action: 'inbox.replied',
    entityType: 'inbox_message',
    entityId: '33333333-3333-4333-8333-c3700c3700c0',
    before: null,
    after: { body: 'hi' },
    createdAt: new Date('2026-05-17T12:00:00Z'),
  };

  it('same input → same hash (deterministic)', () => {
    const a = computeEventHash(baseInput);
    const b = computeEventHash(baseInput);
    expect(a).toBe(b);
  });

  it('different action → different hash', () => {
    const a = computeEventHash(baseInput);
    const b = computeEventHash({ ...baseInput, action: 'inbox.assigned' });
    expect(a).not.toBe(b);
  });

  it('key-order in `after` does not change hash (stable JSON)', () => {
    const a = computeEventHash({
      ...baseInput,
      after: { body: 'hi', tone: 'friendly' },
    });
    const b = computeEventHash({
      ...baseInput,
      after: { tone: 'friendly', body: 'hi' },
    });
    expect(a).toBe(b);
  });

  it('verifyEventHash returns true for matching, false for tampered', () => {
    const hash = computeEventHash(baseInput);
    expect(verifyEventHash(hash, baseInput)).toBe(true);
    // Tamper after-field
    expect(
      verifyEventHash(hash, { ...baseInput, after: { body: 'tampered' } }),
    ).toBe(false);
  });

  it('verifyEventHash returns true for NULL hash (pre-C37 row exempt)', () => {
    expect(verifyEventHash(null, baseInput)).toBe(true);
  });
});
