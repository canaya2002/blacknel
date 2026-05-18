import { describe, expect, it } from 'vitest';

import { redact } from '../../lib/observability/redact';

describe('redact — secret keys', () => {
  it('redacts any key matching /password/i', () => {
    const out = redact({ password: 'hunter2', Password: 'XXX', userPassword: 'YYY' });
    expect(out).toEqual({
      password: '[redacted]',
      Password: '[redacted]',
      userPassword: '[redacted]',
    });
  });

  it('redacts api keys, tokens, secrets, authorization, cookies', () => {
    const out = redact({
      api_key: 'sk_test_123',
      api_token: 'xyz',
      bearer_token: 'jwt-string',
      authorization: 'Bearer abc',
      cookie: 'session=foo',
      session_secret: 'foo',
    });
    expect(Object.values(out)).toEqual([
      '[redacted]',
      '[redacted]',
      '[redacted]',
      '[redacted]',
      '[redacted]',
      '[redacted]',
    ]);
  });

  it('hashes PII keys (email, phone, name) to short hash', () => {
    const out = redact({ email: 'foo@bar.com', phone: '555-1234', name: 'Alice' });
    expect(out.email).toMatch(/^hash:[0-9a-f]{8}$/);
    expect(out.phone).toMatch(/^hash:[0-9a-f]{8}$/);
    expect(out.name).toMatch(/^hash:[0-9a-f]{8}$/);
  });

  it('redacts string values that LOOK like API keys regardless of key name', () => {
    // sk_test_... is a Stripe-style API key.
    expect(redact('sk_test_abcdefghijklmnop')).toBe('[redacted]');
    // Long base64 segment triple = JWT.
    expect(redact('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signaturepart')).toBe('[redacted]');
  });

  it('preserves non-secret strings untouched', () => {
    expect(redact({ message: 'hello world', count: 42, active: true })).toEqual({
      message: 'hello world',
      count: 42,
      active: true,
    });
  });

  it('recurses into nested objects', () => {
    const out = redact({
      user: { name: 'Alice', password: 'hunter2' },
      safe: { count: 1 },
    });
    const u = out.user as { name: string; password: string };
    expect(u.password).toBe('[redacted]');
    expect(u.name).toMatch(/^hash:/);
    expect(out.safe).toEqual({ count: 1 });
  });

  it('recurses into arrays of non-secret content', () => {
    const out = redact({
      items: [{ id: 'a', count: 1 }, { id: 'b', count: 2 }],
    });
    expect(out.items).toEqual([
      { id: 'a', count: 1 },
      { id: 'b', count: 2 },
    ]);
  });

  it('redacts the whole array when its key matches a secret pattern', () => {
    // `tokens` matches /token/i → the value (the array) is redacted,
    // NOT recursed. Documented behavior — a key called `tokens` is
    // treated as a secret container regardless of element shape.
    const out = redact({
      tokens: [{ value: 'sk_live_xyz123abc456' }],
    });
    expect(out.tokens).toBe('[redacted]');
  });

  it('handles null + undefined gracefully', () => {
    expect(redact(null)).toBeNull();
    expect(redact(undefined)).toBeUndefined();
  });

  it('caps recursion depth so cyclic-ish payloads do not blow stack', () => {
    type Recursive = { next?: Recursive };
    const obj: Recursive = {};
    let cur = obj;
    for (let i = 0; i < 20; i += 1) {
      cur.next = {};
      cur = cur.next;
    }
    const out = redact(obj);
    // Should not throw; depth >8 returns the [redacted] sentinel.
    expect(out).toBeDefined();
  });
});
