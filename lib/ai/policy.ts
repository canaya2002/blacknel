import { AiError, type AiErrorCode } from './types';

/**
 * Retry / timeout / fallback helpers (Phase 7 / Commit 22).
 *
 * Mock adapter calls these but they're effectively no-ops
 * because the mock body resolves synchronously (no network).
 * The real adapter (Phase 11) composes them around the
 * Anthropic SDK call:
 *
 *   ```ts
 *   const result = await withTimeout(
 *     withRetry(
 *       () => anthropic.messages.create(req),
 *       { maxAttempts: 3, backoffMs: [500, 2000, 6000], retryableCodes: ['rate_limit', 'server_error'] },
 *     ),
 *     15_000,
 *   );
 *   ```
 *
 * Keeping the helpers wired in Phase 7 means the swap to real
 * doesn't have to introduce them — the production code path is
 * exercised in tests today.
 */

// ---------------------------------------------------------------------------
// Timeout
// ---------------------------------------------------------------------------

export async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new AiError(
          'timeout',
          `AI call exceeded ${timeoutMs}ms.`,
          { timeoutMs },
        ),
      );
    }, timeoutMs);
    // unref so vitest workers don't hang on teardown.
    if (timer && typeof (timer as unknown as { unref?: () => void }).unref === 'function') {
      (timer as unknown as { unref: () => void }).unref();
    }
  });
  try {
    return await Promise.race([fn(), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Retry with backoff
// ---------------------------------------------------------------------------

export interface RetryOpts {
  readonly maxAttempts: number;
  readonly backoffMs: ReadonlyArray<number>;
  readonly retryableCodes: ReadonlyArray<AiErrorCode>;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOpts,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const code = err instanceof AiError ? err.code : null;
      const retryable = code !== null && opts.retryableCodes.includes(code);
      const isLastAttempt = attempt === opts.maxAttempts - 1;
      if (!retryable || isLastAttempt) throw err;
      const backoff = opts.backoffMs[attempt] ?? opts.backoffMs.at(-1) ?? 1000;
      await sleep(backoff);
    }
  }
  // Defensive — unreachable.
  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    if (typeof (t as unknown as { unref?: () => void }).unref === 'function') {
      (t as unknown as { unref: () => void }).unref();
    }
  });
}

// ---------------------------------------------------------------------------
// Fallback (used by real adapter Opus → Haiku degrade path)
// ---------------------------------------------------------------------------

/**
 * If `primary()` throws an `AiError` whose code is in
 * `degradeOnCodes`, run `fallback()` instead. Used by the Phase 11
 * adapter to drop Opus to Haiku on timeout/rate-limit when the
 * skill module declares the degrade acceptable.
 */
export async function withFallback<T>(
  primary: () => Promise<T>,
  fallback: () => Promise<T>,
  degradeOnCodes: ReadonlyArray<AiErrorCode>,
): Promise<T> {
  try {
    return await primary();
  } catch (err) {
    if (err instanceof AiError && degradeOnCodes.includes(err.code)) {
      return fallback();
    }
    throw err;
  }
}
