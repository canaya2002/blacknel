import { describe, expect, it } from 'vitest';

import { decodeThreadCursor, encodeThreadCursor } from '../../lib/inbox/cursor';

describe('thread cursor', () => {
  it('round-trips a valid (timestamp, uuid) pair', () => {
    const cursor = {
      t: '2026-05-15T16:00:00.000Z',
      i: '77777777-7777-4777-8777-000000000001',
    };
    const encoded = encodeThreadCursor(cursor);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/); // base64url alphabet
    expect(decodeThreadCursor(encoded)).toEqual(cursor);
  });

  it('returns null for empty / nullish input', () => {
    expect(decodeThreadCursor(null)).toBeNull();
    expect(decodeThreadCursor(undefined)).toBeNull();
    expect(decodeThreadCursor('')).toBeNull();
  });

  it('rejects garbage strings', () => {
    expect(decodeThreadCursor('not-a-cursor')).toBeNull();
    expect(decodeThreadCursor('!@#$%^&*()')).toBeNull();
  });

  it('rejects cursors longer than 256 chars (DoS guard)', () => {
    const huge = 'A'.repeat(500);
    expect(decodeThreadCursor(huge)).toBeNull();
  });

  it('rejects a payload with a non-UUID `i`', () => {
    const bad = Buffer.from(
      JSON.stringify({ t: '2026-05-15T16:00:00.000Z', i: 'not-a-uuid' }),
      'utf8',
    ).toString('base64url');
    expect(decodeThreadCursor(bad)).toBeNull();
  });

  it('rejects a payload with an unparseable timestamp', () => {
    const bad = Buffer.from(
      JSON.stringify({ t: 'not-a-date', i: '77777777-7777-4777-8777-000000000001' }),
      'utf8',
    ).toString('base64url');
    expect(decodeThreadCursor(bad)).toBeNull();
  });

  it('rejects payloads missing required fields', () => {
    const bad = Buffer.from(JSON.stringify({ t: '2026-05-15T16:00:00.000Z' }), 'utf8').toString(
      'base64url',
    );
    expect(decodeThreadCursor(bad)).toBeNull();
  });
});
