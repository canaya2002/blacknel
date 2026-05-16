import { describe, expect, it } from 'vitest';

import { decodeApprovalCursor, encodeApprovalCursor } from '../../lib/approvals/cursor';

describe('approval cursor', () => {
  it('round-trips a valid (timestamp, uuid) pair', () => {
    const c = {
      t: '2026-05-15T12:00:00.000Z',
      i: '44444444-4444-4444-8444-fb0000000001',
    };
    expect(decodeApprovalCursor(encodeApprovalCursor(c))).toEqual(c);
  });

  it('returns null for empty / nullish input', () => {
    expect(decodeApprovalCursor(null)).toBeNull();
    expect(decodeApprovalCursor(undefined)).toBeNull();
    expect(decodeApprovalCursor('')).toBeNull();
  });

  it('rejects strings longer than 256 chars (DoS guard)', () => {
    expect(decodeApprovalCursor('a'.repeat(500))).toBeNull();
  });

  it('rejects payloads missing required keys', () => {
    const bad = Buffer.from(JSON.stringify({ t: '2026-05-15T12:00Z' }), 'utf8').toString(
      'base64url',
    );
    expect(decodeApprovalCursor(bad)).toBeNull();
  });

  it('rejects payloads with a malformed UUID', () => {
    const bad = Buffer.from(
      JSON.stringify({ t: '2026-05-15T12:00:00.000Z', i: 'not-a-uuid' }),
      'utf8',
    ).toString('base64url');
    expect(decodeApprovalCursor(bad)).toBeNull();
  });

  it('rejects payloads with an unparseable timestamp', () => {
    const bad = Buffer.from(
      JSON.stringify({ t: 'never', i: '44444444-4444-4444-8444-fb0000000001' }),
      'utf8',
    ).toString('base64url');
    expect(decodeApprovalCursor(bad)).toBeNull();
  });
});
