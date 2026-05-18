/**
 * Phase 11 / Commit 40 — PII + secret redaction before observability send.
 *
 * Sentry's `beforeSend` and PostHog's `before_capture` route every
 * payload through `redact()` so we never ship credentials or PII
 * to a 3rd party. Two layers:
 *
 *   1. **Key-name match** — any object key matching a secret/PII
 *      pattern has its value replaced with `'[redacted]'`.
 *   2. **String-content match** — values that look like API keys
 *      or JWT tokens are replaced regardless of key.
 *
 * Pure function — no I/O, no observability of its own.
 */

const SECRET_KEY_PATTERNS = [
  /password/i,
  /secret/i,
  /token/i,
  /api[_-]?key/i,
  /authorization/i,
  /cookie/i,
  /session/i,
  /credential/i,
];

const PII_KEY_PATTERNS = [
  /^email$/i,
  /^phone$/i,
  /^name$/i,
  /^address$/i,
  /^ssn$/i,
];

// JWT-ish heuristic: 3 base64url segments separated by dots, total len ≥ 50
const JWT_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
// API key prefixes commonly emitted by providers
const API_KEY_PREFIXES = [
  'sk_',
  'pk_',
  'rk_',
  'whsec_',
  'shp_',
  'AIza',
  'AKIA',
  'ghp_',
  'gho_',
  'eyJ', // JWT
];

const REDACTED = '[redacted]';

function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERNS.some((re) => re.test(key));
}

function isPiiKey(key: string): boolean {
  return PII_KEY_PATTERNS.some((re) => re.test(key));
}

function looksLikeSecret(value: string): boolean {
  if (value.length < 16) return false;
  if (JWT_RE.test(value) && value.length >= 50) return true;
  return API_KEY_PREFIXES.some((p) => value.startsWith(p));
}

export function redact<T>(value: T, depth = 0): T {
  if (depth > 8) return REDACTED as unknown as T;
  if (value == null) return value;
  if (typeof value === 'string') {
    return (looksLikeSecret(value) ? REDACTED : value) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => redact(v, depth + 1)) as unknown as T;
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (isSecretKey(k)) {
        out[k] = REDACTED;
        continue;
      }
      if (isPiiKey(k)) {
        out[k] = typeof v === 'string' ? hashShort(v) : REDACTED;
        continue;
      }
      out[k] = redact(v, depth + 1);
    }
    return out as unknown as T;
  }
  return value;
}

/**
 * Deterministic short hash for PII fields we want to KEEP cardinality
 * of (e.g., correlate user.email across events) but never expose the
 * raw value. NOT cryptographic — collision-resistant enough for
 * analytics buckets.
 */
function hashShort(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return `hash:${(h >>> 0).toString(16).padStart(8, '0')}`;
}
