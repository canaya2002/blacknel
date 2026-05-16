/**
 * Rate limiter for the public feedback surface and any future
 * unauthenticated entry point. Phase-11-ready abstraction so the
 * cutover to Upstash Redis is one line in `defaultRateLimiter()` —
 * the rest of the codebase consumes `RateLimiter#checkRate(ip,
 * action)` and doesn't know what's behind it.
 *
 * # Why an abstraction now
 *
 * Pure in-memory rate limiting is fine for Phase 5 (single-process
 * dev runtime, no horizontal scale). Once Phase 11 lands Supabase
 * Edge / Vercel multi-region, the in-memory map can't share state
 * across instances and an attacker hitting different regions
 * bypasses the limit. The `RateLimitStore` interface makes the
 * swap cost-free — see the JSDoc above
 * `defaultRateLimitStore()` for the exact cutover path.
 *
 * The cost of adding the interface now is one extra file and the
 * indirection through the store. Worth it: the failure mode at
 * cutover is "rate limit silently no-ops in production" if the
 * abstraction wasn't built up front.
 */

/**
 * The minimum surface a store backing the rate limiter must expose.
 * The default in-memory implementation lives below; the Phase-11
 * Upstash implementation will satisfy the same interface.
 */
export interface RateLimitStore {
  /**
   * Atomically increment the counter for `key` and return the new
   * value. If the key is new (or expired), the counter starts at 1
   * and the TTL is set to `windowSeconds`.
   */
  incrementWithTtl(key: string, windowSeconds: number): Promise<number>;
  /**
   * Clear all stored counters. Test-only escape hatch; never called
   * by production code.
   */
  reset(): Promise<void>;
}

interface InMemoryEntry {
  count: number;
  resetAt: number;
}

/**
 * Phase-5 in-memory store. Single-process. Keys live for `windowSeconds`
 * from the first hit; after that the next hit creates a fresh entry.
 *
 * Uses `Date.now()` only for TTL bookkeeping — the public API is
 * deterministic given an injected `now()` function. Tests inject a
 * fake clock to advance time without `setTimeout`.
 */
export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly entries = new Map<string, InMemoryEntry>();
  private readonly clock: () => number;

  constructor(clock: () => number = () => Date.now()) {
    this.clock = clock;
  }

  async incrementWithTtl(key: string, windowSeconds: number): Promise<number> {
    const now = this.clock();
    const existing = this.entries.get(key);
    if (!existing || existing.resetAt <= now) {
      this.entries.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
      return 1;
    }
    existing.count += 1;
    return existing.count;
  }

  async reset(): Promise<void> {
    this.entries.clear();
  }
}

/**
 * Verdict returned by `checkRate`. `allowed=false` carries the
 * remaining-window seconds so the caller can put it in a
 * `Retry-After` header.
 */
export interface RateLimitVerdict {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly limit: number;
  readonly retryAfterSeconds: number;
}

export interface RateLimitOptions {
  /** Max hits per window for a given `(ip, action)`. */
  readonly limit: number;
  /** Window length in seconds. */
  readonly windowSeconds: number;
}

export interface RateLimiter {
  /**
   * Record a hit and report the verdict. Both `ip` and `action` are
   * concatenated into the key — the same IP hitting two different
   * actions has independent budgets.
   */
  checkRate(ip: string, action: string): Promise<RateLimitVerdict>;
  /** Test escape hatch — reset all counters in the underlying store. */
  reset(): Promise<void>;
}

export function createRateLimiter(
  store: RateLimitStore,
  opts: RateLimitOptions,
): RateLimiter {
  return {
    async checkRate(ip: string, action: string): Promise<RateLimitVerdict> {
      const key = `${action}:${ip}`;
      const count = await store.incrementWithTtl(key, opts.windowSeconds);
      const allowed = count <= opts.limit;
      const remaining = Math.max(0, opts.limit - count);
      // For the Phase-5 store the precise retry-after is the window
      // length minus the elapsed time of THIS entry — pulling that
      // out cleanly would require exposing the entry's resetAt,
      // which leaks a side channel. Reporting `windowSeconds` is a
      // safe upper bound; Phase 11 with Redis EXPIRE returns the
      // real TTL.
      return {
        allowed,
        remaining,
        limit: opts.limit,
        retryAfterSeconds: allowed ? 0 : opts.windowSeconds,
      };
    },
    async reset(): Promise<void> {
      await store.reset();
    },
  };
}

/**
 * Default rate limiter for the public feedback submit endpoint. 5
 * hits per IP per 60s. The instance is module-singleton so all
 * Server Action invocations in the same Node.js process share state
 * — the cutover to Upstash in Phase 11 replaces ONLY this factory.
 */
let _defaultFeedbackLimiter: RateLimiter | null = null;

export function defaultFeedbackRateLimiter(): RateLimiter {
  if (!_defaultFeedbackLimiter) {
    _defaultFeedbackLimiter = createRateLimiter(new InMemoryRateLimitStore(), {
      limit: 5,
      windowSeconds: 60,
    });
  }
  return _defaultFeedbackLimiter;
}

/** Test-only: reset the singleton between integration tests. */
export async function _resetDefaultFeedbackRateLimiter(): Promise<void> {
  if (_defaultFeedbackLimiter) {
    await _defaultFeedbackLimiter.reset();
  }
}
