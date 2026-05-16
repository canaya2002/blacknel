'use client';

import { useCallback, useEffect, useRef } from 'react';

/**
 * Adaptive polling primitive.
 *
 * Default behaviour matches what /inbox and /approvals need today:
 *
 *   - When the tab is visible, fire `refresh()` every `intervalMs`.
 *   - When the tab is hidden, stop the timer entirely. We do NOT
 *     slow the cadence; we pause. A user with three Blacknel tabs
 *     open shouldn't be paying for two of them.
 *   - When the tab becomes visible again, fire `refresh()` once
 *     immediately and resume the cadence.
 *   - Debounce every `refresh()` invocation to at most one per
 *     second across the lifetime of the hook. Fast-tabbing should
 *     not produce a request storm.
 *
 * Phase 11 cutover replaces the polling body with Supabase Realtime
 * subscriptions — the consumer surface (`router.refresh()` callback)
 * stays the same.
 */

const MIN_REFRESH_INTERVAL_MS = 1000;

export interface UsePollingOptions {
  /** Milliseconds between automatic refreshes when the tab is visible. */
  readonly intervalMs: number;
  /** Set to `false` to disable polling without unmounting the host. */
  readonly enabled?: boolean;
}

export function usePolling(refresh: () => void, options: UsePollingOptions): void {
  const { intervalMs, enabled = true } = options;

  // Keep the latest `refresh` in a ref so the effect doesn't re-bind
  // its listeners every time the caller re-renders with a new closure.
  // React 19 forbids ref writes during render — sync inside an effect.
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  const lastRefreshAt = useRef(0);
  const debouncedRefresh = useCallback(() => {
    const now = Date.now();
    if (now - lastRefreshAt.current < MIN_REFRESH_INTERVAL_MS) return;
    lastRefreshAt.current = now;
    refreshRef.current();
  }, []);

  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return;

    let intervalId: ReturnType<typeof setInterval> | null = null;

    const start = (): void => {
      if (intervalId !== null) return;
      intervalId = setInterval(debouncedRefresh, intervalMs);
    };
    const stop = (): void => {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') {
        debouncedRefresh();
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [intervalMs, enabled, debouncedRefresh]);
}

/**
 * Configuration constants used by the polling hosts. Tuned so the
 * inbox feels reactive and the approvals queue feels stable.
 *
 * Numbers are also referenced by the test that locks in the
 * adaptive-pause behaviour.
 */
export const POLL_INTERVAL_INBOX_LIST_MS = 30_000;
export const POLL_INTERVAL_THREAD_DETAIL_MS = 30_000;
export const POLL_INTERVAL_APPROVALS_MS = 60_000;
