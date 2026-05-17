import { describe, expect, it } from 'vitest';

import { resolveRetentionPolicy } from '../../lib/audit-advanced/retention';
import type { AuditRetentionPolicy } from '../../lib/db/schema';

/**
 * Phase 10 / Commit 37 · Ajuste 2 — retention policy precedence.
 *
 * Documented rule:
 *   1. Exact match > prefix > 'all'.
 *   2. On specificity tie, longer retention wins.
 */

function makePolicy(
  appliesTo: string,
  retentionDays: number,
): AuditRetentionPolicy {
  return {
    id: `00000000-0000-4000-8000-${appliesTo.padEnd(12, '0').slice(0, 12)}`,
    organizationId: '11111111-1111-4111-8111-c3700c3700c0',
    appliesTo,
    retentionDays,
    createdBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('resolveRetentionPolicy precedence', () => {
  it('exact match beats prefix beats "all"', () => {
    const policies = [
      makePolicy('all', 30),
      makePolicy('billing.*', 365),
      makePolicy('billing.charge', 730),
    ];
    const resolved = resolveRetentionPolicy('billing.charge', policies);
    expect(resolved?.retentionDays).toBe(730);
  });

  it('prefix beats "all" for non-matching exact', () => {
    const policies = [
      makePolicy('all', 30),
      makePolicy('billing.*', 365),
    ];
    const resolved = resolveRetentionPolicy('billing.charge', policies);
    expect(resolved?.retentionDays).toBe(365);
  });

  it('on tie (same specificity), longer retention wins', () => {
    // Both are exact matches on different patterns — but only one
    // matches the action. Tie only matters when two policies
    // genuinely share the same pattern OR same specificity for the
    // same action; here we test "all" duplicated (org constraint
    // prevents this in DB, but the function must still be safe).
    const policies = [
      makePolicy('all', 30),
      makePolicy('all', 90),
    ];
    const resolved = resolveRetentionPolicy('whatever.action', policies);
    expect(resolved?.retentionDays).toBe(90);
  });

  it('returns null when no policy applies', () => {
    const resolved = resolveRetentionPolicy('foo.bar', []);
    expect(resolved).toBeNull();
  });
});
