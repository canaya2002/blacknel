import { describe, expect, it } from 'vitest';

import {
  countOverlaps,
  validateLayout,
  type LayoutWidget,
} from '../../lib/custom-reports/layout-validate';

const W = (
  id: string,
  row: number,
  col: number,
  width = 1,
  height = 1,
): LayoutWidget => ({
  id,
  positionRow: row,
  positionCol: col,
  width,
  height,
});

describe('validateLayout', () => {
  it('empty layout fails with empty_layout error', () => {
    const r = validateLayout([]);
    expect(r.ok).toBe(false);
    expect(r.errors[0]?.kind).toBe('empty_layout');
  });

  it('single in-bounds widget passes', () => {
    const r = validateLayout([W('a', 0, 0, 3, 2)]);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('overlap between two widgets fails with overlap error', () => {
    const r = validateLayout([
      W('a', 0, 0, 4, 2),
      W('b', 1, 2, 3, 2), // overlaps row 1, cols 2-3 with 'a'
    ]);
    expect(r.ok).toBe(false);
    const overlaps = r.errors.filter((e) => e.kind === 'overlap');
    expect(overlaps).toHaveLength(1);
    if (overlaps[0]?.kind === 'overlap') {
      expect([overlaps[0].aId, overlaps[0].bId].sort()).toEqual(['a', 'b']);
    }
  });

  it('adjacent (touching, not overlapping) widgets pass', () => {
    const r = validateLayout([W('a', 0, 0, 3, 1), W('b', 0, 3, 3, 1)]);
    expect(r.ok).toBe(true);
  });

  it('widget exceeding column 12 fails with out_of_bounds', () => {
    const r = validateLayout([W('a', 0, 8, 5, 1)]); // 8 + 5 = 13 > 12
    expect(r.ok).toBe(false);
    expect(
      r.errors.some(
        (e) =>
          e.kind === 'out_of_bounds' && e.reason.includes('exceeds grid'),
      ),
    ).toBe(true);
  });
});

describe('countOverlaps', () => {
  it('returns 0 for non-overlapping layout', () => {
    expect(countOverlaps([W('a', 0, 0, 3, 1), W('b', 0, 3, 3, 1)])).toBe(0);
  });

  it('returns the number of overlapping pairs', () => {
    // Three mutually overlapping widgets → C(3,2) = 3 pairs.
    expect(
      countOverlaps([W('a', 0, 0, 4, 2), W('b', 0, 0, 4, 2), W('c', 0, 0, 4, 2)]),
    ).toBe(3);
  });
});
