import { describe, expect, it } from 'vitest';

import { decodeReviewCursor, encodeReviewCursor } from '../../lib/reviews/cursor';

describe('review cursor', () => {
  it('round-trips a valid (timestamp, uuid) pair', () => {
    const cursor = {
      t: '2026-05-15T16:00:00.000Z',
      i: 'bbbbbbbb-bbbb-4bbb-8bbb-900000000001',
    };
    const encoded = encodeReviewCursor(cursor);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeReviewCursor(encoded)).toEqual(cursor);
  });

  it('returns null for empty / nullish input', () => {
    expect(decodeReviewCursor(null)).toBeNull();
    expect(decodeReviewCursor(undefined)).toBeNull();
    expect(decodeReviewCursor('')).toBeNull();
  });

  it('rejects garbage strings', () => {
    expect(decodeReviewCursor('not-a-cursor')).toBeNull();
    expect(decodeReviewCursor('!@#$%^&*()')).toBeNull();
  });

  it('rejects cursors longer than 256 chars (DoS guard)', () => {
    expect(decodeReviewCursor('A'.repeat(500))).toBeNull();
  });

  it('rejects a payload with a non-UUID `i`', () => {
    const bad = Buffer.from(
      JSON.stringify({ t: '2026-05-15T16:00:00.000Z', i: 'not-a-uuid' }),
      'utf8',
    ).toString('base64url');
    expect(decodeReviewCursor(bad)).toBeNull();
  });

  it('rejects a payload with an unparseable timestamp', () => {
    const bad = Buffer.from(
      JSON.stringify({ t: 'never', i: 'bbbbbbbb-bbbb-4bbb-8bbb-900000000001' }),
      'utf8',
    ).toString('base64url');
    expect(decodeReviewCursor(bad)).toBeNull();
  });

  it('rejects payloads missing required fields', () => {
    const bad = Buffer.from(
      JSON.stringify({ i: 'bbbbbbbb-bbbb-4bbb-8bbb-900000000001' }),
      'utf8',
    ).toString('base64url');
    expect(decodeReviewCursor(bad)).toBeNull();
  });
});
