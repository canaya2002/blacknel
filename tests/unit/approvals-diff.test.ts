import { describe, expect, it } from 'vitest';

import { buildPayloadDiff, stableStringify } from '../../lib/approvals/diff';

describe('stableStringify', () => {
  it('orders object keys alphabetically', () => {
    expect(stableStringify({ b: 1, a: 2, c: 3 })).toBe('{\n  "a": 2,\n  "b": 1,\n  "c": 3\n}');
  });

  it('preserves array order', () => {
    expect(stableStringify({ list: [3, 1, 2] })).toContain('[\n    3,\n    1,\n    2\n  ]');
  });

  it('renders the same string for objects with permuted key order', () => {
    expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }));
  });
});

describe('buildPayloadDiff', () => {
  it('marks every right-side line as diff when original is null', () => {
    const { left, right } = buildPayloadDiff(null, { a: 1 });
    expect(left).toEqual([{ text: '(sin original — solicitud nueva)', diff: false }]);
    // All proposed lines exist on the right with no counterpart on the left.
    expect(right.every((l) => l.diff)).toBe(true);
  });

  it('does NOT mark lines as diff when payloads are equal', () => {
    const { left, right } = buildPayloadDiff({ a: 1, b: 2 }, { b: 2, a: 1 });
    expect(left.every((l) => !l.diff)).toBe(true);
    expect(right.every((l) => !l.diff)).toBe(true);
  });

  it('marks the differing line on both sides for a single-line edit', () => {
    const { left, right } = buildPayloadDiff(
      { body: 'old' },
      { body: 'new' },
    );
    // Same structure on both sides — `body` line is the only diff.
    const leftDiffs = left.filter((l) => l.diff);
    const rightDiffs = right.filter((l) => l.diff);
    expect(leftDiffs.length).toBe(1);
    expect(rightDiffs.length).toBe(1);
    expect(leftDiffs[0]?.text).toContain('old');
    expect(rightDiffs[0]?.text).toContain('new');
  });

  it('handles unequal length payloads (proposed has more keys)', () => {
    const { left, right } = buildPayloadDiff({ a: 1 }, { a: 1, b: 2 });
    expect(right.length).toBeGreaterThan(left.length);
    // The trailing right-only line must be flagged.
    expect(right[right.length - 1]?.diff).toBe(true);
  });
});
