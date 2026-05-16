import { randomBytes } from 'node:crypto';

/**
 * Review-request tokens. The public landing at `/feedback/[token]`
 * uses this string as the ONLY connection from URL to org — no
 * cookie, no session, no per-org subdomain. The token must therefore
 * carry enough entropy that brute-force enumeration is unviable AND
 * a verifiable prefix so the landing can reject obvious garbage
 * before touching the DB.
 *
 * # Format
 *
 *     bnf_ + base64url(randomBytes(24))
 *
 *   - Prefix `bnf_` (4 chars) — sentinel that lets the landing
 *     short-circuit on malformed input. 32 chars of base64url follow
 *     (24 bytes × 4/3, no padding) → ~144 bits of entropy. Birthday
 *     collision odds across 10⁹ tokens are ~6 × 10⁻²⁹.
 *   - Total length is exactly 36 chars. The validator enforces both
 *     prefix and length so a 37-char input (e.g. trailing space from
 *     a copy-paste) doesn't waste a DB round-trip.
 *
 * # Why this shape
 *
 *   - **Prefix.** Phase 11 wires this into a real HTTP path on a
 *     shared domain. The prefix lets routing middleware (and
 *     observability dashboards) tell review tokens apart from any
 *     future public-token surfaces without parsing them.
 *   - **base64url, not hex.** Half the characters per byte — 24 bytes
 *     fit in 32 url-safe chars instead of 48 hex chars. The URL stays
 *     shareable; emails, QR codes, and SMS all win.
 *   - **Pure module.** No DB import, no env. The validator is the
 *     ONLY guard the public landing trusts before reaching for the
 *     dbAdmin-aware resolver in `lib/reviews/public-feedback.ts`.
 *
 * Phase 7+ may rotate the prefix when adding a second token kind
 * (NPS surveys, signed action links). The validator's prefix check
 * makes that a one-line change here, not in twelve callers.
 */

export const REVIEW_REQUEST_TOKEN_PREFIX = 'bnf_';
const RANDOM_BYTES = 24;
/** Length of the base64url-encoded random portion (no padding). */
const ENCODED_LEN = 32;
const FULL_TOKEN_LEN = REVIEW_REQUEST_TOKEN_PREFIX.length + ENCODED_LEN;

const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

/**
 * Generate a fresh review-request token. Returns a 36-char string.
 *
 * Uses Node's `crypto.randomBytes` — CSPRNG-backed. The encoded slice
 * never includes `=` padding because base64url encoding of 24 bytes
 * lands on a multiple of 4 chars (32) cleanly.
 */
export function generateRequestToken(): string {
  const encoded = randomBytes(RANDOM_BYTES).toString('base64url');
  return `${REVIEW_REQUEST_TOKEN_PREFIX}${encoded}`;
}

/**
 * Cheap, pre-DB validation of a token's shape. Returns `false` on
 * any of:
 *
 *   - Not a string / empty.
 *   - Doesn't start with `bnf_`.
 *   - Total length isn't exactly 36 chars.
 *   - The random tail contains characters outside the base64url
 *     alphabet.
 *
 * The caller (`lib/reviews/public-feedback.ts`) uses this BEFORE any
 * query so malformed input cannot leak timing information about
 * which tokens exist. Returning `false` here means "don't even try
 * the DB". The validator alone doesn't prove a token is valid — only
 * that it's worth a lookup.
 */
export function validateTokenFormat(token: unknown): token is string {
  if (typeof token !== 'string') return false;
  if (token.length !== FULL_TOKEN_LEN) return false;
  if (!token.startsWith(REVIEW_REQUEST_TOKEN_PREFIX)) return false;
  const tail = token.slice(REVIEW_REQUEST_TOKEN_PREFIX.length);
  return BASE64URL_RE.test(tail);
}

/**
 * Constants for tests that need to mint a deterministic
 * known-malformed token without re-encoding rules. Exporting these
 * keeps the test surface tight.
 */
export const TOKEN_TEST_HELPERS = {
  FULL_LEN: FULL_TOKEN_LEN,
  PREFIX: REVIEW_REQUEST_TOKEN_PREFIX,
  ENCODED_LEN,
  RANDOM_BYTES,
} as const;
