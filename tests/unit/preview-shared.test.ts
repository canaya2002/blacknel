import { describe, expect, it } from 'vitest';

import {
  arePreviewPropsEqual,
  arrayEqShallow,
  formatRelativeTime,
  initialsFor,
  mediaEq,
  truncateBody,
  type PreviewMedia,
  type PreviewSlice,
} from '../../components/publish/composer/previews/preview-shared';

/**
 * Pure-helpers + memo-comparator coverage for the composer
 * preview stack (Commit 19c.1 — Ajuste perf-typing).
 *
 * `arePreviewPropsEqual` IS the cutoff that lets the typing
 * stay smooth with 4+ previews mounted; `preview-perf.test.tsx`
 * verifies the wiring end-to-end via spy. This file pins the
 * comparator's contract.
 */

describe('truncateBody', () => {
  it('returns body unchanged when limit is null', () => {
    expect(truncateBody('hello world', null)).toBe('hello world');
  });
  it('returns body unchanged when within the limit', () => {
    expect(truncateBody('short', 100)).toBe('short');
  });
  it('truncates and appends ellipsis when over the limit', () => {
    const result = truncateBody('abcdefghij', 5);
    expect(result.length).toBe(5);
    expect(result.endsWith('…')).toBe(true);
  });
  it('produces a string at exactly the limit including the ellipsis', () => {
    const result = truncateBody('a'.repeat(280 + 100), 280);
    expect(result.length).toBe(280);
  });
  it('degrades gracefully when limit ≤ 1', () => {
    expect(truncateBody('hello', 0)).toBe('');
    expect(truncateBody('hello', 1)).toBe('h');
  });
});

describe('initialsFor', () => {
  it('picks the first letter of the first two tokens', () => {
    expect(initialsFor('La Trattoria', null)).toBe('LT');
  });
  it('falls back to handle when displayName is null', () => {
    expect(initialsFor(null, '@trattoria')).toBe('T');
  });
  it('returns ? when both inputs are null', () => {
    expect(initialsFor(null, null)).toBe('?');
  });
  it('strips emojis cleanly', () => {
    expect(initialsFor('🍕 Trattoria Roma', null)).toBe('TR');
  });
  it('handles single-token display names', () => {
    expect(initialsFor('Blacknel', null)).toBe('B');
  });
});

describe('formatRelativeTime', () => {
  const now = new Date('2026-05-15T12:00:00Z');
  it('shows "Justo ahora" within the last minute', () => {
    expect(formatRelativeTime(new Date(now.getTime() - 30_000), now)).toBe('Justo ahora');
  });
  it('returns null-input as "Justo ahora"', () => {
    expect(formatRelativeTime(null, now)).toBe('Justo ahora');
  });
  it('shows minutes for < 1 hour', () => {
    expect(formatRelativeTime(new Date(now.getTime() - 5 * 60_000), now)).toBe('5m');
  });
  it('shows hours for < 1 day', () => {
    expect(formatRelativeTime(new Date(now.getTime() - 3 * 60 * 60_000), now)).toBe('3h');
  });
  it('shows days otherwise', () => {
    expect(formatRelativeTime(new Date(now.getTime() - 4 * 24 * 60 * 60_000), now)).toBe('4d');
  });
});

describe('arrayEqShallow', () => {
  it('returns true for the same reference', () => {
    const ref = ['a', 'b'];
    expect(arrayEqShallow(ref, ref)).toBe(true);
  });
  it('returns true for identical content with different refs', () => {
    expect(arrayEqShallow(['a', 'b'], ['a', 'b'])).toBe(true);
  });
  it('returns false on length mismatch', () => {
    expect(arrayEqShallow(['a'], ['a', 'b'])).toBe(false);
  });
  it('returns false on element diff', () => {
    expect(arrayEqShallow(['a', 'b'], ['a', 'c'])).toBe(false);
  });
});

describe('mediaEq', () => {
  const m = (url: string, kind: PreviewMedia['kind'], name = ''): PreviewMedia => ({
    url,
    kind,
    name,
  });
  it('returns true for empty arrays', () => {
    expect(mediaEq([], [])).toBe(true);
  });
  it('returns true for the same content with different refs', () => {
    expect(mediaEq([m('/a.png', 'image', 'a')], [m('/a.png', 'image', 'a')])).toBe(true);
  });
  it('returns false when any field of any element differs', () => {
    expect(mediaEq([m('/a.png', 'image')], [m('/b.png', 'image')])).toBe(false);
    expect(mediaEq([m('/a.png', 'image')], [m('/a.png', 'video')])).toBe(false);
    expect(mediaEq([m('/a.png', 'image', 'a')], [m('/a.png', 'image', 'b')])).toBe(false);
  });
});

describe('arePreviewPropsEqual — memo comparator contract', () => {
  function makeSlice(overrides: Partial<PreviewSlice> = {}): PreviewSlice {
    return {
      key: 'acc-1',
      platform: 'facebook',
      body: 'hello world',
      hasOverride: false,
      over: false,
      charLimit: 63206,
      length: 11,
      displayName: 'La Trattoria',
      handle: '@trattoria',
      link: null,
      media: [],
      ...overrides,
    };
  }

  it('returns true when both slices reference the same object', () => {
    const slice = makeSlice();
    expect(arePreviewPropsEqual({ slice }, { slice })).toBe(true);
  });

  it('returns true for two slices with identical content', () => {
    expect(arePreviewPropsEqual({ slice: makeSlice() }, { slice: makeSlice() })).toBe(
      true,
    );
  });

  it('returns false when body changes', () => {
    expect(
      arePreviewPropsEqual(
        { slice: makeSlice({ body: 'A' }) },
        { slice: makeSlice({ body: 'B' }) },
      ),
    ).toBe(false);
  });

  it('returns false when hasOverride flips', () => {
    expect(
      arePreviewPropsEqual(
        { slice: makeSlice({ hasOverride: false }) },
        { slice: makeSlice({ hasOverride: true }) },
      ),
    ).toBe(false);
  });

  it('returns false when over-flag flips', () => {
    expect(
      arePreviewPropsEqual(
        { slice: makeSlice({ over: false }) },
        { slice: makeSlice({ over: true }) },
      ),
    ).toBe(false);
  });

  it('returns false when length changes (independent of body)', () => {
    expect(
      arePreviewPropsEqual(
        { slice: makeSlice({ length: 10 }) },
        { slice: makeSlice({ length: 11 }) },
      ),
    ).toBe(false);
  });

  it('returns false when link changes', () => {
    expect(
      arePreviewPropsEqual(
        { slice: makeSlice({ link: null }) },
        { slice: makeSlice({ link: 'https://blacknel.io' }) },
      ),
    ).toBe(false);
  });

  it('returns true when media arrays have same content, different refs', () => {
    expect(
      arePreviewPropsEqual(
        { slice: makeSlice({ media: [{ url: '/a.png', kind: 'image', name: 'a' }] }) },
        { slice: makeSlice({ media: [{ url: '/a.png', kind: 'image', name: 'a' }] }) },
      ),
    ).toBe(true);
  });

  it('returns false when media url changes', () => {
    expect(
      arePreviewPropsEqual(
        { slice: makeSlice({ media: [{ url: '/a.png', kind: 'image', name: 'a' }] }) },
        { slice: makeSlice({ media: [{ url: '/b.png', kind: 'image', name: 'a' }] }) },
      ),
    ).toBe(false);
  });
});
