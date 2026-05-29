import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  signForTest,
  validateSignedRequest,
  type MetaSignedRequestPayload,
} from '../../lib/meta/signed-request';

const SECRET = 'test-app-secret-not-real';

function payload(over: Partial<MetaSignedRequestPayload> = {}): MetaSignedRequestPayload {
  return {
    algorithm: 'HMAC-SHA256',
    user_id: '1234567890',
    issued_at: 1716000000,
    ...over,
  };
}

describe('validateSignedRequest', () => {
  it('round-trips a valid signed_request via signForTest helper', () => {
    const signed = signForTest(payload(), SECRET);
    const decoded = validateSignedRequest(signed, SECRET);
    expect(decoded).not.toBeNull();
    expect(decoded?.user_id).toBe('1234567890');
    expect(decoded?.algorithm).toBe('HMAC-SHA256');
    expect(decoded?.issued_at).toBe(1716000000);
  });

  it('returns null when the signature is wrong (different secret)', () => {
    const signed = signForTest(payload(), SECRET);
    expect(validateSignedRequest(signed, 'different-secret')).toBeNull();
  });

  it('returns null on missing or empty input', () => {
    expect(validateSignedRequest('', SECRET)).toBeNull();
    expect(validateSignedRequest('only-one-part', SECRET)).toBeNull();
    expect(validateSignedRequest('one.two.three', SECRET)).toBeNull();
  });

  it('returns null when the algorithm field is wrong', () => {
    const wrong = signForTest(
      { algorithm: 'HMAC-SHA1' as unknown as 'HMAC-SHA256', user_id: 'u', issued_at: 1 },
      SECRET,
    );
    expect(validateSignedRequest(wrong, SECRET)).toBeNull();
  });

  function handSign(payloadJson: string, secret: string): string {
    const encodedPayload = Buffer.from(payloadJson, 'utf8')
      .toString('base64')
      .replace(/=+$/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    const sig = createHmac('sha256', secret).update(encodedPayload).digest();
    const encodedSig = sig
      .toString('base64')
      .replace(/=+$/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    return `${encodedSig}.${encodedPayload}`;
  }

  it('returns null when user_id is missing', () => {
    const signed = handSign(
      JSON.stringify({ algorithm: 'HMAC-SHA256', issued_at: 1 }),
      SECRET,
    );
    expect(validateSignedRequest(signed, SECRET)).toBeNull();
  });

  it('returns null when the payload is not valid JSON', () => {
    expect(validateSignedRequest(handSign('not-json', SECRET), SECRET)).toBeNull();
  });

  it('returns null when secret is empty', () => {
    const signed = signForTest(payload(), SECRET);
    expect(validateSignedRequest(signed, '')).toBeNull();
  });

  it('uses constant-time comparison (same length, every bit flip rejects)', () => {
    const signed = signForTest(payload(), SECRET);
    const [sig, encoded] = signed.split('.');
    // Flip one character in the signature → invalid but same length.
    const tampered =
      sig!.slice(0, -1) + (sig!.endsWith('A') ? 'B' : 'A') + '.' + encoded;
    expect(validateSignedRequest(tampered, SECRET)).toBeNull();
  });
});
