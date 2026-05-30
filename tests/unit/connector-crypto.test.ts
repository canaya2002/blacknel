import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  decrypt,
  decryptJson,
  encrypt,
  encryptJson,
  isEncryptedEnvelope,
  _setEncryptionKeyForTests,
} from '../../lib/connectors/crypto';

/**
 * C46 connector token encryption (AES-256-GCM). No DB, no env: the key is
 * injected via the test seam. Covers roundtrip, JSON roundtrip, per-call IV
 * uniqueness, tamper detection (auth tag), wrong-key rejection, and the
 * envelope type guard that distinguishes a real blob from the empty `{}`.
 */

beforeAll(() => {
  _setEncryptionKeyForTests('test-connection-encryption-key-32-bytes-min!!');
});

afterAll(() => {
  _setEncryptionKeyForTests(null);
});

describe('connector crypto — AES-256-GCM', () => {
  it('roundtrips a string', () => {
    const env = encrypt('EAAG-page-token-abc123');
    expect(env.alg).toBe('aes-256-gcm');
    expect(decrypt(env)).toBe('EAAG-page-token-abc123');
  });

  it('roundtrips a JSON token object', () => {
    const tokens = { accessToken: 'tok', refreshToken: 'r', expiresAt: '2026-07-01T00:00:00.000Z', scopes: ['a', 'b'] };
    const env = encryptJson(tokens);
    expect(decryptJson(env)).toEqual(tokens);
  });

  it('produces a distinct IV + ciphertext per call (non-deterministic)', () => {
    const a = encrypt('same-plaintext');
    const b = encrypt('same-plaintext');
    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toBe(b.ct);
    expect(decrypt(a)).toBe('same-plaintext');
    expect(decrypt(b)).toBe('same-plaintext');
  });

  it('rejects a tampered ciphertext (auth tag mismatch)', () => {
    const env = encrypt('secret');
    const flipped = Buffer.from(env.ct, 'base64');
    flipped[0] = flipped[0]! ^ 0xff;
    const tampered = { ...env, ct: flipped.toString('base64') };
    expect(() => decrypt(tampered)).toThrow();
  });

  it('rejects decryption with a different key', () => {
    const env = encrypt('secret');
    _setEncryptionKeyForTests('a-totally-different-key-also-32-bytes-min!!');
    expect(() => decrypt(env)).toThrow();
    // restore for remaining tests
    _setEncryptionKeyForTests('test-connection-encryption-key-32-bytes-min!!');
  });

  it('isEncryptedEnvelope distinguishes a real blob from empty {}', () => {
    expect(isEncryptedEnvelope(encrypt('x'))).toBe(true);
    expect(isEncryptedEnvelope({})).toBe(false);
    expect(isEncryptedEnvelope(null)).toBe(false);
    expect(isEncryptedEnvelope({ alg: 'aes-256-gcm' })).toBe(false);
  });
});
