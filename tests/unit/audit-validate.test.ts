import { describe, expect, it } from 'vitest';

import {
  createRetentionPolicySchema,
  dismissAnomalySchema,
} from '../../lib/audit-advanced/validate';

/**
 * Phase 10 / Commit 37 — Zod validation.
 */

describe('createRetentionPolicySchema', () => {
  it('accepts "all" pattern', () => {
    expect(
      createRetentionPolicySchema.safeParse({
        appliesTo: 'all',
        retentionDays: 30,
      }).success,
    ).toBe(true);
  });

  it('accepts prefix and exact action patterns', () => {
    expect(
      createRetentionPolicySchema.safeParse({
        appliesTo: 'billing.*',
        retentionDays: 365,
      }).success,
    ).toBe(true);
    expect(
      createRetentionPolicySchema.safeParse({
        appliesTo: 'billing.charge',
        retentionDays: 730,
      }).success,
    ).toBe(true);
  });

  it('rejects malformed patterns', () => {
    expect(
      createRetentionPolicySchema.safeParse({
        appliesTo: 'Billing.Charge',
        retentionDays: 30,
      }).success,
    ).toBe(false);
    expect(
      createRetentionPolicySchema.safeParse({
        appliesTo: 'foo bar',
        retentionDays: 30,
      }).success,
    ).toBe(false);
  });
});

describe('dismissAnomalySchema (Ajuste 1)', () => {
  it('rejects reason shorter than 10 chars', () => {
    expect(
      dismissAnomalySchema.safeParse({
        anomalyId: '00000000-0000-4000-8000-c3700c3700c0',
        action: 'dismiss',
        reason: 'short',
      }).success,
    ).toBe(false);
  });

  it('rejects whitespace-padded reason that trims to <10', () => {
    expect(
      dismissAnomalySchema.safeParse({
        anomalyId: '00000000-0000-4000-8000-c3700c3700c0',
        action: 'dismiss',
        reason: '   nope   ', // trims to 'nope' = 4 chars
      }).success,
    ).toBe(false);
  });

  it('accepts reason exactly ≥10 chars after trim', () => {
    expect(
      dismissAnomalySchema.safeParse({
        anomalyId: '00000000-0000-4000-8000-c3700c3700c0',
        action: 'dismiss',
        reason: 'reviewed and verified ok',
      }).success,
    ).toBe(true);
  });

  it('accepts both dismiss and accept', () => {
    const a = dismissAnomalySchema.safeParse({
      anomalyId: '00000000-0000-4000-8000-c3700c3700c0',
      action: 'accept',
      reason: 'confirmed real incident',
    });
    expect(a.success).toBe(true);
  });
});
