import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Validate the `x-hub-signature-256` header Meta sends with every
 * webhook POST. Meta computes `HMAC-SHA256(app_secret, raw_body)`
 * and sends it hex-encoded with a `sha256=` prefix.
 *
 *   x-hub-signature-256: sha256=2c4f...
 *
 * The signature covers the **exact raw bytes** of the JSON body, so
 * the route handler must read the body via `request.text()` (or
 * equivalent) **before** any JSON.parse rewrites whitespace / key
 * ordering. We do constant-time comparison via `timingSafeEqual` to
 * neutralise timing attacks.
 *
 * Returns `true` only when:
 *   - body, header, and secret are all non-empty
 *   - header starts with the literal `sha256=` prefix
 *   - the hex payload decodes to the same byte length as the HMAC
 *   - `timingSafeEqual` returns true
 *
 * Spec: https://developers.facebook.com/docs/messenger-platform/webhooks#security
 */
export function validateWebhookSignature(
  rawBody: string,
  signatureHeader: string,
  appSecret: string,
): boolean {
  if (!rawBody || !signatureHeader || !appSecret) return false;

  const PREFIX = 'sha256=';
  if (!signatureHeader.startsWith(PREFIX)) return false;
  const providedHex = signatureHeader.slice(PREFIX.length);

  // Strict hex character set — guards against malformed headers that
  // would coerce to a partial Buffer via `Buffer.from(..., 'hex')`'s
  // silent truncation behaviour on invalid input.
  if (providedHex.length === 0) return false;
  if (!/^[0-9a-f]+$/i.test(providedHex)) return false;
  if (providedHex.length % 2 !== 0) return false;

  const providedBuf = Buffer.from(providedHex, 'hex');
  const expectedBuf = createHmac('sha256', appSecret).update(rawBody).digest();

  if (providedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(providedBuf, expectedBuf);
}

/**
 * Test-only helper — produce the exact `x-hub-signature-256` header
 * value Meta would send for a given body + secret. Exported so unit
 * tests can build fixtures without copy-pasting the encoding.
 */
export function signWebhookBodyForTest(
  rawBody: string,
  appSecret: string,
): string {
  const hex = createHmac('sha256', appSecret).update(rawBody).digest('hex');
  return `sha256=${hex}`;
}
