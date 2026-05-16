import { describe, expect, it } from 'vitest';

import {
  generateRequestToken,
  TOKEN_TEST_HELPERS,
  validateTokenFormat,
} from '../../lib/reviews/request-tokens';

/**
 * Token primitives. The format contract is load-bearing because
 * `validateTokenFormat` is the only pre-DB guard the public landing
 * uses; if the format check accepts too loosely OR rejects too
 * tightly, the timing-oracle defense weakens. The collision test
 * pins the entropy: 10k random tokens with zero collisions is well
 * below 144 bits of entropy birthday-paradox bound but a good smoke.
 */

describe('generateRequestToken', () => {
  it('returns a string of the documented length and prefix', () => {
    const token = generateRequestToken();
    expect(token).toHaveLength(TOKEN_TEST_HELPERS.FULL_LEN);
    expect(token.startsWith(TOKEN_TEST_HELPERS.PREFIX)).toBe(true);
  });

  it('returns base64url chars only after the prefix', () => {
    const token = generateRequestToken();
    const tail = token.slice(TOKEN_TEST_HELPERS.PREFIX.length);
    expect(tail).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(tail).toHaveLength(TOKEN_TEST_HELPERS.ENCODED_LEN);
  });

  it('does not collide in 10,000 fresh tokens', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const t = generateRequestToken();
      expect(seen.has(t)).toBe(false);
      seen.add(t);
    }
    expect(seen.size).toBe(10_000);
  });
});

describe('validateTokenFormat', () => {
  it('accepts a freshly generated token', () => {
    expect(validateTokenFormat(generateRequestToken())).toBe(true);
  });

  it('rejects non-strings', () => {
    expect(validateTokenFormat(null)).toBe(false);
    expect(validateTokenFormat(undefined)).toBe(false);
    expect(validateTokenFormat(42 as unknown)).toBe(false);
    expect(validateTokenFormat({} as unknown)).toBe(false);
  });

  it('rejects tokens missing the bnf_ prefix', () => {
    const t = generateRequestToken().replace(TOKEN_TEST_HELPERS.PREFIX, 'aaa_');
    expect(validateTokenFormat(t)).toBe(false);
  });

  it('rejects tokens with wrong length (too short)', () => {
    const t = generateRequestToken().slice(0, -1);
    expect(validateTokenFormat(t)).toBe(false);
  });

  it('rejects tokens with wrong length (too long, trailing space)', () => {
    const t = generateRequestToken() + ' ';
    expect(validateTokenFormat(t)).toBe(false);
  });

  it('rejects tokens with non-base64url chars in the tail', () => {
    // Replace one character of the tail with '!', which is not in
    // [A-Za-z0-9_-].
    const t = generateRequestToken();
    const tampered =
      t.slice(0, TOKEN_TEST_HELPERS.PREFIX.length + 5) +
      '!' +
      t.slice(TOKEN_TEST_HELPERS.PREFIX.length + 6);
    expect(validateTokenFormat(tampered)).toBe(false);
  });

  it('rejects empty strings', () => {
    expect(validateTokenFormat('')).toBe(false);
  });
});
