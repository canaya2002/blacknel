import { randomBytes } from 'node:crypto';

/**
 * NPS invitation tokens (Phase 9 / Commit 32).
 *
 * Mirror of `lib/reviews/request-tokens.ts` but with a distinct prefix
 * (`bnf_nps_`) so the public landing at `/nps/[token]` can demux from
 * the review landing `/feedback/[token]` without a DB roundtrip. The
 * Phase-11 routing middleware can also tell the surfaces apart for
 * rate-limit pool routing and observability.
 *
 * # Format
 *
 *     bnf_nps_ + base64url(randomBytes(24))
 *
 *   - Prefix `bnf_nps_` (8 chars) — sentinel + namespace.
 *   - 32 chars of base64url follow (24 bytes × 4/3, no padding) →
 *     ~144 bits of entropy. Collision odds across 10⁹ tokens
 *     ~6 × 10⁻²⁹.
 *   - Total length is exactly 40 chars.
 *
 * # Why a distinct prefix
 *
 * Same rationale as the Phase-5 `bnf_` prefix — short-circuit
 * obviously-wrong input before reaching for `dbAdmin`. Adding the
 * `_nps_` namespace lets a Phase-12 router enforce per-surface IP
 * rate-limits or per-surface log signature without parsing the token
 * body.
 */

export const NPS_TOKEN_PREFIX = 'bnf_nps_';
const RANDOM_BYTES = 24;
const ENCODED_LEN = 32;
const FULL_TOKEN_LEN = NPS_TOKEN_PREFIX.length + ENCODED_LEN;

const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

/** Generate a fresh NPS invitation token. Returns a 40-char string. */
export function generateNpsToken(): string {
  const encoded = randomBytes(RANDOM_BYTES).toString('base64url');
  return `${NPS_TOKEN_PREFIX}${encoded}`;
}

/**
 * Cheap, pre-DB validation. Same posture as
 * `lib/reviews/request-tokens.validateTokenFormat` — the validator
 * alone doesn't prove a token is valid, only that it's worth a
 * lookup. Public landing uses this BEFORE any query so malformed
 * input can't leak timing info about which tokens exist.
 */
export function validateNpsTokenFormat(token: unknown): token is string {
  if (typeof token !== 'string') return false;
  if (token.length !== FULL_TOKEN_LEN) return false;
  if (!token.startsWith(NPS_TOKEN_PREFIX)) return false;
  const tail = token.slice(NPS_TOKEN_PREFIX.length);
  return BASE64URL_RE.test(tail);
}

export const NPS_TOKEN_TEST_HELPERS = {
  FULL_LEN: FULL_TOKEN_LEN,
  PREFIX: NPS_TOKEN_PREFIX,
  ENCODED_LEN,
  RANDOM_BYTES,
} as const;
