import { describe, expect, it } from 'vitest';

import { sortBySeverityThenAge } from '../../lib/ai/recommendations';

/**
 * Sort helper — Ajuste 3 (Commit 29).
 *
 * Critical first, then high → medium → low. Within a tier:
 * created_at DESC (newest first).
 */

describe('sortBySeverityThenAge', () => {
  it('critical comes before high regardless of insertion order', () => {
    const high = {
      id: 'h',
      severity: 'high' as const,
      createdAt: new Date('2026-05-15T10:00:00Z'),
    };
    const critical = {
      id: 'c',
      severity: 'critical' as const,
      createdAt: new Date('2026-05-10T10:00:00Z'),
    };
    const out = sortBySeverityThenAge([high, critical]);
    expect(out.map((r) => r.id)).toEqual(['c', 'h']);
  });

  it('inside a tier, newer items come first', () => {
    const older = {
      id: 'older',
      severity: 'medium' as const,
      createdAt: new Date('2026-05-10T10:00:00Z'),
    };
    const newer = {
      id: 'newer',
      severity: 'medium' as const,
      createdAt: new Date('2026-05-15T10:00:00Z'),
    };
    const out = sortBySeverityThenAge([older, newer]);
    expect(out.map((r) => r.id)).toEqual(['newer', 'older']);
  });

  it('mixed: critical+ then high then medium, age within tier', () => {
    const input = [
      {
        id: 'med-old',
        severity: 'medium' as const,
        createdAt: new Date('2026-05-10T10:00:00Z'),
      },
      {
        id: 'high-new',
        severity: 'high' as const,
        createdAt: new Date('2026-05-15T10:00:00Z'),
      },
      {
        id: 'crit-old',
        severity: 'critical' as const,
        createdAt: new Date('2026-05-05T10:00:00Z'),
      },
      {
        id: 'high-old',
        severity: 'high' as const,
        createdAt: new Date('2026-05-08T10:00:00Z'),
      },
      {
        id: 'med-new',
        severity: 'medium' as const,
        createdAt: new Date('2026-05-16T10:00:00Z'),
      },
    ];
    const out = sortBySeverityThenAge(input);
    expect(out.map((r) => r.id)).toEqual([
      'crit-old',
      'high-new',
      'high-old',
      'med-new',
      'med-old',
    ]);
  });

  it('does not mutate the input array', () => {
    const input = [
      {
        id: 'a',
        severity: 'low' as const,
        createdAt: new Date('2026-05-10T10:00:00Z'),
      },
      {
        id: 'b',
        severity: 'high' as const,
        createdAt: new Date('2026-05-12T10:00:00Z'),
      },
    ];
    const copy = [...input];
    sortBySeverityThenAge(input);
    expect(input).toEqual(copy);
  });
});
