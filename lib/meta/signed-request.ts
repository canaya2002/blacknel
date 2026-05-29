import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Decoded payload of a Meta `signed_request` body.
 *
 * Meta only guarantees `user_id` + `algorithm` + `issued_at` to be
 * present for the data-deletion callback shape. Other fields
 * (`oauth_token`, `expires`, etc.) appear in login flows and are
 * irrelevant here.
 */
export interface MetaSignedRequestPayload {
  readonly algorithm: 'HMAC-SHA256';
  readonly user_id: string;
  readonly issued_at: number;
}

/**
 * Validate + decode a Meta `signed_request` string of the form
 *
 *   <base64url(hmac_sha256(payload_b64))>.<base64url(payload_json)>
 *
 * Returns the decoded payload on success, `null` on any validation
 * failure (malformed shape, wrong algorithm, bad signature, JSON
 * parse error, missing required field). Constant-time signature
 * comparison via `timingSafeEqual`.
 *
 * Spec: https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback/
 */
export function validateSignedRequest(
  signedRequest: string,
  appSecret: string,
): MetaSignedRequestPayload | null {
  if (!signedRequest || !appSecret) return null;

  const parts = signedRequest.split('.');
  if (parts.length !== 2) return null;
  const [encodedSig, encodedPayload] = parts as [string, string];
  if (!encodedSig || !encodedPayload) return null;

  // base64url → Buffer. Meta uses base64url (no `=` padding, `-_` instead of `+/`).
  const sig = b64urlDecode(encodedSig);
  if (!sig) return null;

  const expected = createHmac('sha256', appSecret)
    .update(encodedPayload)
    .digest();

  // Length check is mandatory before timingSafeEqual — it throws on mismatch.
  if (sig.length !== expected.length) return null;
  if (!timingSafeEqual(sig, expected)) return null;

  const payloadBuf = b64urlDecode(encodedPayload);
  if (!payloadBuf) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadBuf.toString('utf8'));
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') return null;
  const p = parsed as Record<string, unknown>;
  if (p['algorithm'] !== 'HMAC-SHA256') return null;
  if (typeof p['user_id'] !== 'string' || p['user_id'].length === 0) return null;
  if (typeof p['issued_at'] !== 'number') return null;

  return {
    algorithm: 'HMAC-SHA256',
    user_id: p['user_id'],
    issued_at: p['issued_at'],
  };
}

/**
 * Encode a payload + secret into the same wire format Meta sends.
 * **Test-only** — production never signs requests outbound. Exported so
 * unit tests can produce fixtures without copy-pasting the encoding.
 */
export function signForTest(
  payload: MetaSignedRequestPayload,
  appSecret: string,
): string {
  const encodedPayload = b64urlEncode(Buffer.from(JSON.stringify(payload), 'utf8'));
  const sig = createHmac('sha256', appSecret).update(encodedPayload).digest();
  return `${b64urlEncode(sig)}.${encodedPayload}`;
}

function b64urlDecode(input: string): Buffer | null {
  try {
    // Re-pad to standard base64 (Node's Buffer.from accepts base64url but
    // older runtimes may not; explicit re-pad is portable).
    const padded = input + '='.repeat((4 - (input.length % 4)) % 4);
    const std = padded.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(std, 'base64');
  } catch {
    return null;
  }
}

function b64urlEncode(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/=+$/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}
