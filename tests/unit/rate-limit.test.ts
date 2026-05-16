import { describe, expect, it } from 'vitest';

import {
  createRateLimiter,
  InMemoryRateLimitStore,
} from '../../lib/reviews/rate-limit';

/**
 * Rate limiter contract. The in-memory store is the Phase-5
 * implementation; the integration with Upstash in Phase 11 must
 * satisfy the same observable behavior:
 *
 *   - First N hits in a window → `allowed: true`, remaining counts
 *     down.
 *   - Hit N+1 inside the same window → `allowed: false`.
 *   - After the window expires, the counter resets.
 *   - Different (ip, action) keys track independently.
 */

const opts = { limit: 5, windowSeconds: 60 } as const;

describe('createRateLimiter — happy path', () => {
  it('allows the first 5 hits and blocks the 6th', async () => {
    const limiter = createRateLimiter(new InMemoryRateLimitStore(), opts);
    for (let i = 0; i < 5; i++) {
      const v = await limiter.checkRate('1.2.3.4', 'feedback.submit');
      expect(v.allowed).toBe(true);
      expect(v.remaining).toBe(opts.limit - (i + 1));
    }
    const v = await limiter.checkRate('1.2.3.4', 'feedback.submit');
    expect(v.allowed).toBe(false);
    expect(v.remaining).toBe(0);
    expect(v.retryAfterSeconds).toBe(opts.windowSeconds);
  });
});

describe('createRateLimiter — window expiry', () => {
  it('resets the counter once the window elapses', async () => {
    let now = 1_000_000_000_000; // arbitrary fixed start
    const store = new InMemoryRateLimitStore(() => now);
    const limiter = createRateLimiter(store, opts);

    for (let i = 0; i < 5; i++) {
      await limiter.checkRate('1.2.3.4', 'feedback.submit');
    }
    expect((await limiter.checkRate('1.2.3.4', 'feedback.submit')).allowed).toBe(false);

    // Advance past the 60s window.
    now += (opts.windowSeconds + 1) * 1000;
    const v = await limiter.checkRate('1.2.3.4', 'feedback.submit');
    expect(v.allowed).toBe(true);
    expect(v.remaining).toBe(opts.limit - 1);
  });
});

describe('createRateLimiter — key isolation', () => {
  it('different IPs are tracked independently', async () => {
    const limiter = createRateLimiter(new InMemoryRateLimitStore(), opts);
    for (let i = 0; i < 5; i++) {
      await limiter.checkRate('1.2.3.4', 'feedback.submit');
    }
    expect((await limiter.checkRate('1.2.3.4', 'feedback.submit')).allowed).toBe(false);
    // Same action, different IP, fresh budget.
    expect((await limiter.checkRate('5.6.7.8', 'feedback.submit')).allowed).toBe(true);
  });

  it('different actions on the same IP are tracked independently', async () => {
    const limiter = createRateLimiter(new InMemoryRateLimitStore(), opts);
    for (let i = 0; i < 5; i++) {
      await limiter.checkRate('1.2.3.4', 'feedback.submit');
    }
    expect((await limiter.checkRate('1.2.3.4', 'feedback.submit')).allowed).toBe(false);
    // Different action, fresh budget for the same IP.
    expect((await limiter.checkRate('1.2.3.4', 'other.action')).allowed).toBe(true);
  });
});

describe('InMemoryRateLimitStore — reset()', () => {
  it('clears all counters', async () => {
    const store = new InMemoryRateLimitStore();
    const limiter = createRateLimiter(store, opts);
    for (let i = 0; i < 5; i++) {
      await limiter.checkRate('1.2.3.4', 'feedback.submit');
    }
    expect((await limiter.checkRate('1.2.3.4', 'feedback.submit')).allowed).toBe(false);
    await limiter.reset();
    expect((await limiter.checkRate('1.2.3.4', 'feedback.submit')).allowed).toBe(true);
  });
});
