import { describe, expect, it } from 'vitest';

import {
  computeAccountUsages,
  isWithinAllLimits,
  strictestMaxLength,
} from '../../lib/publish/composer/character-limits';

/**
 * Unit coverage for `lib/publish/composer/character-limits.ts`.
 *
 * The helpers read the canonical platform limits via
 * `getCapabilities(platform).publishLimits.maxTextLength` — same
 * source `tests/unit/capabilities.test.ts` pins. We use a small
 * subset of the declared platforms (x: 280, pinterest: 500,
 * facebook: 63206) as fixed reference points; if a connector
 * changes its declared `maxTextLength`, the capability contract
 * test catches it before this one does.
 */

const X_MAX = 280;
const PINTEREST_MAX = 500;
const FACEBOOK_MAX = 63206;

describe('strictestMaxLength', () => {
  it('returns null for an empty account list', () => {
    expect(strictestMaxLength([])).toBeNull();
  });

  it('returns the only declared max when one account is selected', () => {
    expect(
      strictestMaxLength([{ accountId: 'a', platform: 'facebook' }]),
    ).toBe(FACEBOOK_MAX);
  });

  it('picks the smallest declared max across mixed accounts', () => {
    const min = strictestMaxLength([
      { accountId: 'fb', platform: 'facebook' },
      { accountId: 'x', platform: 'x' },
      { accountId: 'pin', platform: 'pinterest' },
    ]);
    expect(min).toBe(X_MAX);
  });

  it('ignores platforms that do not declare maxTextLength (mock)', () => {
    // `mock` is a publishing target with no declared text cap.
    // The selector must skip it cleanly; with only `mock` we get null.
    expect(
      strictestMaxLength([{ accountId: 'm', platform: 'mock' }]),
    ).toBeNull();

    // Mixed: mock + x → x's 280 still wins.
    expect(
      strictestMaxLength([
        { accountId: 'm', platform: 'mock' },
        { accountId: 'x', platform: 'x' },
      ]),
    ).toBe(X_MAX);
  });
});

describe('computeAccountUsages', () => {
  it('uses the base text when no variant exists for that account', () => {
    const usages = computeAccountUsages({
      baseText: 'hello world',
      variants: {},
      accounts: [{ accountId: 'fb', platform: 'facebook' }],
    });
    expect(usages.length).toBe(1);
    expect(usages[0]?.length).toBe('hello world'.length);
    expect(usages[0]?.maxLength).toBe(FACEBOOK_MAX);
    expect(usages[0]?.over).toBe(false);
    expect(usages[0]?.remaining).toBe(FACEBOOK_MAX - 'hello world'.length);
  });

  it('uses the variant text when one is set for that account', () => {
    const usages = computeAccountUsages({
      baseText: 'long base text that is way too long for X',
      variants: { x: 'short' },
      accounts: [{ accountId: 'x', platform: 'x' }],
    });
    expect(usages[0]?.length).toBe('short'.length);
    expect(usages[0]?.over).toBe(false);
  });

  it('falls back to base text for empty-string variants', () => {
    const usages = computeAccountUsages({
      baseText: 'base content',
      variants: { x: '' },
      accounts: [{ accountId: 'x', platform: 'x' }],
    });
    expect(usages[0]?.length).toBe('base content'.length);
  });

  it('flags `over=true` when base text exceeds X (280) but stays within Facebook (63206)', () => {
    // X cap is 280; build a 300-char string to overflow it.
    const text = 'a'.repeat(300);
    const usages = computeAccountUsages({
      baseText: text,
      variants: {},
      accounts: [
        { accountId: 'fb', platform: 'facebook' },
        { accountId: 'x', platform: 'x' },
      ],
    });
    const fb = usages.find((u) => u.accountId === 'fb')!;
    const x = usages.find((u) => u.accountId === 'x')!;
    expect(fb.over).toBe(false);
    expect(x.over).toBe(true);
    // `remaining` floors at 0 — never goes negative.
    expect(x.remaining).toBe(0);
  });

  it('preserves the input ordering of `accounts`', () => {
    const usages = computeAccountUsages({
      baseText: 'x',
      variants: {},
      accounts: [
        { accountId: 'pin', platform: 'pinterest' },
        { accountId: 'fb', platform: 'facebook' },
        { accountId: 'x', platform: 'x' },
      ],
    });
    expect(usages.map((u) => u.accountId)).toEqual(['pin', 'fb', 'x']);
  });
});

describe('isWithinAllLimits', () => {
  it('returns true when every selected account fits its declared cap', () => {
    expect(
      isWithinAllLimits({
        baseText: 'small',
        variants: {},
        accounts: [
          { accountId: 'fb', platform: 'facebook' },
          { accountId: 'x', platform: 'x' },
        ],
      }),
    ).toBe(true);
  });

  it('returns false when any account is over its cap', () => {
    expect(
      isWithinAllLimits({
        baseText: 'a'.repeat(PINTEREST_MAX + 1),
        variants: {},
        accounts: [
          { accountId: 'fb', platform: 'facebook' },
          { accountId: 'pin', platform: 'pinterest' },
        ],
      }),
    ).toBe(false);
  });

  it('treats platforms without declared limits (mock) as always-within', () => {
    expect(
      isWithinAllLimits({
        baseText: 'a'.repeat(100_000),
        variants: {},
        accounts: [{ accountId: 'm', platform: 'mock' }],
      }),
    ).toBe(true);
  });

  it('respects variant overrides per account', () => {
    expect(
      isWithinAllLimits({
        baseText: 'a'.repeat(300),
        variants: { x: 'a'.repeat(50) },
        accounts: [
          { accountId: 'fb', platform: 'facebook' },
          { accountId: 'x', platform: 'x' },
        ],
      }),
    ).toBe(true);
  });
});
