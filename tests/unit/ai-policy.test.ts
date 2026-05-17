import { describe, expect, it, vi } from 'vitest';

import { AiError } from '../../lib/ai/types';
import { withFallback, withRetry, withTimeout } from '../../lib/ai/policy';

describe('withTimeout', () => {
  it('resolves the inner promise when it finishes in time', async () => {
    const result = await withTimeout(async () => 42, 100);
    expect(result).toBe(42);
  });

  it('rejects with AiError(timeout) when the inner promise stalls', async () => {
    await expect(
      withTimeout(
        () => new Promise<number>((resolve) => setTimeout(() => resolve(0), 200)),
        50,
      ),
    ).rejects.toThrow(/exceeded 50ms/);
  });

  it('the rejection carries the timeout code', async () => {
    try {
      await withTimeout(
        () => new Promise<number>((resolve) => setTimeout(() => resolve(0), 200)),
        50,
      );
      expect.fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(AiError);
      expect((err as AiError).code).toBe('timeout');
    }
  });
});

describe('withRetry', () => {
  it('returns on first success', async () => {
    const fn = vi.fn(async () => 'ok');
    const result = await withRetry(fn, {
      maxAttempts: 3,
      backoffMs: [10],
      retryableCodes: ['rate_limit'],
    });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on retryable AiError up to maxAttempts', async () => {
    let n = 0;
    const fn = vi.fn(async () => {
      n++;
      if (n < 3) throw new AiError('rate_limit', 'slow down');
      return 'ok';
    });
    const result = await withRetry(fn, {
      maxAttempts: 3,
      backoffMs: [1, 1],
      retryableCodes: ['rate_limit'],
    });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does NOT retry non-retryable AiError codes', async () => {
    const fn = vi.fn(async () => {
      throw new AiError('schema_violation', 'bad output');
    });
    await expect(
      withRetry(fn, {
        maxAttempts: 3,
        backoffMs: [1],
        retryableCodes: ['rate_limit'],
      }),
    ).rejects.toThrow(/bad output/);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('rethrows the last error when maxAttempts exhausted', async () => {
    const fn = vi.fn(async () => {
      throw new AiError('rate_limit', 'still slow');
    });
    await expect(
      withRetry(fn, {
        maxAttempts: 2,
        backoffMs: [1],
        retryableCodes: ['rate_limit'],
      }),
    ).rejects.toThrow(/still slow/);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('withFallback', () => {
  it('returns the primary result when it succeeds', async () => {
    const primary = vi.fn(async () => 'primary');
    const fallback = vi.fn(async () => 'fallback');
    const result = await withFallback(primary, fallback, ['timeout']);
    expect(result).toBe('primary');
    expect(fallback).not.toHaveBeenCalled();
  });

  it('falls back when primary throws a degrade-eligible AiError', async () => {
    const primary = vi.fn(async () => {
      throw new AiError('timeout', 'slow');
    });
    const fallback = vi.fn(async () => 'fallback');
    const result = await withFallback(primary, fallback, ['timeout']);
    expect(result).toBe('fallback');
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it('re-throws when primary fails with a non-degrade code', async () => {
    const primary = vi.fn(async () => {
      throw new AiError('schema_violation', 'bad');
    });
    const fallback = vi.fn(async () => 'fallback');
    await expect(withFallback(primary, fallback, ['timeout'])).rejects.toThrow(
      /bad/,
    );
    expect(fallback).not.toHaveBeenCalled();
  });
});
