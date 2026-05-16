import { PlatformError } from './errors';
import type { ConnectorAccount, PlatformCode } from './types';

/**
 * Publish-path mock primitives. Pulled out of `mock-connector.ts`
 * so they can be unit-tested directly (the idempotency map cache
 * is the most load-bearing of these — Commit 17 Ajuste 2) and so
 * a future platform connector that overrides only one piece can
 * import it cleanly.
 *
 * Phase 11 replaces this entire module with real per-platform
 * SDK calls. The `MOCK_IDEMPOTENCY_MAP` is the most obvious thing
 * to delete: real platforms (FB `client_token`, IG `creation_id`,
 * X tweet dedup) handle idempotency natively.
 *
 * # Idempotency map TTL caveat
 *
 * The map below is an in-memory `Map` with NO TTL eviction. For
 * Phase 6 in dev / tests this is fine (process lifetime ≈ a few
 * minutes). For long-running dev servers it grows unbounded — but
 * the keys are UUIDs the publish-job mints per dispatch, so even
 * a busy 24h dev session is at most ~10⁴ entries (≈80 bytes each =
 * ~800 KB). Phase 11 deletes this module.
 */

// ---------------------------------------------------------------------------
// Idempotency map (Ajuste 2 — exportable + testable)
// ---------------------------------------------------------------------------

/**
 * `(platform, idempotencyKey) → externalId`. Two calls with the
 * same key on the same platform return the same `externalId`. Two
 * calls with different keys (or the same key on different
 * platforms) get fresh ids.
 *
 * Exported so tests can:
 *   - assert idempotent behavior is actually idempotent (not
 *     accidental because of seeded RNG);
 *   - clear state between tests via `clearMockIdempotency()`.
 */
export const MOCK_IDEMPOTENCY_MAP: Map<string, string> = new Map();

function key(platform: PlatformCode, idempotencyKey: string): string {
  return `${platform}::${idempotencyKey}`;
}

export function mockIdempotencyGet(
  platform: PlatformCode,
  idempotencyKey: string,
): string | null {
  return MOCK_IDEMPOTENCY_MAP.get(key(platform, idempotencyKey)) ?? null;
}

export function mockIdempotencySet(
  platform: PlatformCode,
  idempotencyKey: string,
  externalId: string,
): void {
  MOCK_IDEMPOTENCY_MAP.set(key(platform, idempotencyKey), externalId);
}

/** Test-only. Resets the cache between integration suites. */
export function clearMockIdempotency(): void {
  MOCK_IDEMPOTENCY_MAP.clear();
}

// ---------------------------------------------------------------------------
// Publish delay simulation
// ---------------------------------------------------------------------------

const DELAY_MIN_MS = 500;
const DELAY_MAX_MS = 2000;
const SHORT_DELAY_MIN_MS = 50;
const SHORT_DELAY_MAX_MS = 250;

/**
 * Pseudo-random millisecond delay, seeded so the same
 * `(platform, account, body)` triple returns the same delay
 * across reruns — important for snapshot tests.
 *
 * `BLACKNEL_MOCK_FAST_PUBLISH=true` collapses the delay to 0,
 * useful when integration tests need to drive the publish-job
 * without burning real seconds.
 */
export async function mockPublishDelay(
  platform: PlatformCode,
  account: ConnectorAccount,
  body: string,
): Promise<void> {
  if (process.env.BLACKNEL_MOCK_FAST_PUBLISH === 'true') return;
  const seed = hashString(`${platform}:${account.id}:${body.length}`);
  const ms = DELAY_MIN_MS + ((seed >>> 0) % (DELAY_MAX_MS - DELAY_MIN_MS));
  await sleep(ms);
}

export async function mockShortDelay(
  platform: PlatformCode,
  accountId: string,
): Promise<void> {
  if (process.env.BLACKNEL_MOCK_FAST_PUBLISH === 'true') return;
  const seed = hashString(`${platform}:${accountId}:sched`);
  const ms = SHORT_DELAY_MIN_MS + ((seed >>> 0) % (SHORT_DELAY_MAX_MS - SHORT_DELAY_MIN_MS));
  await sleep(ms);
}

// ---------------------------------------------------------------------------
// Platform-specific error catalog
// ---------------------------------------------------------------------------

/**
 * Errors each platform's real publish API throws, with the same
 * error code surface so the UI can map known codes to friendly
 * copy. Phase 11 replaces these with real SDK error objects; the
 * `code` strings are kept stable.
 */
const PLATFORM_PUBLISH_ERROR_CODES: Partial<Record<PlatformCode, string>> = {
  facebook: 'POST_RATE_LIMIT_EXCEEDED',
  instagram: 'MEDIA_INVALID_FORMAT',
  tiktok: 'VIDEO_PROCESSING_FAILED',
  linkedin: 'CONTENT_POLICY_VIOLATION',
  x: 'DUPLICATE_TWEET',
  pinterest: 'INVALID_PIN_URL',
  youtube: 'VIDEO_PROCESSING_FAILED',
  gbp: 'LOCAL_POST_VALIDATION_FAILED',
};

const PUBLISH_ERROR_RATE = 0.1;

/**
 * Roll the dice. Deterministic per call site so a test can pin
 * which call fails by tweaking `account.id` or the call seed.
 *
 * Gated by `BLACKNEL_MOCK_ERRORS` — when off this is a no-op,
 * matching the production happy path. When on, ~10% of calls
 * raise the platform's signature error code.
 */
export function maybeThrowPublishError(
  platform: PlatformCode,
  account: ConnectorAccount,
  method: string,
  emitErrors: boolean,
): void {
  if (!emitErrors) return;
  const r = deterministicChance(`${platform}:${account.id}:${method}:pub-err`);
  if (r >= PUBLISH_ERROR_RATE) return;
  const code = PLATFORM_PUBLISH_ERROR_CODES[platform] ?? 'PUBLISH_FAILED';
  throw new PlatformError(platform, `${code}: mock-simulated platform failure.`);
}

// ---------------------------------------------------------------------------
// Helpers (small copies of the seeded-rng utilities from
// mock-connector.ts; intentional duplication so this module has no
// circular dependency on its consumer)
// ---------------------------------------------------------------------------

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function deterministicChance(seed: string): number {
  let state = hashString(seed);
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
