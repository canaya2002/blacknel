import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  __isEnabledForTests,
  __resetForTests,
  captureException,
} from '../../lib/observability/sentry';

/**
 * Phase 11 / Commit 40 — Sentry wrapper contract.
 *
 * The wrapper must:
 *   - Be a no-op when `BLACKNEL_USE_REAL_SENTRY` is false (default).
 *   - Be a no-op when `SENTRY_DSN` is missing.
 *   - Not throw if the SDK import fails (production resilience).
 */

afterEach(() => {
  __resetForTests();
  vi.unstubAllEnvs();
});

describe('Sentry wrapper enablement', () => {
  it('disabled by default — env flag off + no DSN', () => {
    // Default env: BLACKNEL_USE_REAL_SENTRY=false, SENTRY_DSN unset.
    expect(__isEnabledForTests()).toBe(false);
  });

  it('captureException is a no-op when disabled (does not throw)', async () => {
    await expect(
      captureException(new Error('synthetic'), { tags: { test: 'true' } }),
    ).resolves.toBeUndefined();
  });
});
