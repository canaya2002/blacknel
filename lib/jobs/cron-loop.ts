import 'server-only';

import { env } from '@/lib/env';
import { log } from '@/lib/log';

import { runPublishTick } from './publish-post';

/**
 * In-process cron singleton for the publish-job (Commit 20a).
 *
 * # Single instance per process
 *
 * `started` is a module-level flag. `startPublishCron()` is
 * idempotent — a second call while running is a no-op. The
 * pattern matches Phase 11 Inngest registration: register once
 * per process, the runtime handles scheduling.
 *
 * # When the cron actually runs
 *
 * Three gates:
 *
 *   1. `env.BLACKNEL_PUBLISH_JOB_ENABLED` — defaults to true,
 *      flipped to false by the vitest setup so no test ever
 *      arranca el loop por accidente.
 *   2. `env.NODE_ENV === 'development'` — production (Phase 12
 *      with Inngest Cloud) does not need the in-process loop.
 *      Build time also fails this gate.
 *   3. `started === false` — idempotency guard.
 *
 * # Errors never crash the loop
 *
 * `runPublishTick` returns a `Result`; failures inside surface
 * via `log.error` and the next tick simply tries again. The
 * `setInterval` handler `await`s the tick but catches any
 * unhandled throws so a runaway error doesn't kill the timer.
 */

const TICK_INTERVAL_MS = 60_000;

let started = false;
let timer: ReturnType<typeof setInterval> | null = null;
let tickInFlight = false;

export function startPublishCron(): void {
  if (started) {
    log.debug({ tickIntervalMs: TICK_INTERVAL_MS }, 'publish cron — already running');
    return;
  }
  if (!env.BLACKNEL_PUBLISH_JOB_ENABLED) {
    log.info('publish cron — disabled via BLACKNEL_PUBLISH_JOB_ENABLED=false');
    return;
  }
  if (env.NODE_ENV !== 'development') {
    log.info(
      { nodeEnv: env.NODE_ENV },
      'publish cron — non-development env, skipping in-process loop',
    );
    return;
  }

  started = true;
  log.info(
    { tickIntervalMs: TICK_INTERVAL_MS },
    'publish cron — started',
  );

  // Fire once immediately so the first scheduled post doesn't
  // wait a full interval. The handler swallows errors via the
  // try/catch around `runPublishTick`.
  void tickSafe();
  timer = setInterval(() => {
    void tickSafe();
  }, TICK_INTERVAL_MS);

  // Allow the Node process to exit even when the timer is
  // pending. Without `unref()`, vitest workers hang on teardown
  // if any test accidentally invokes `startPublishCron()`.
  if (timer && typeof (timer as unknown as { unref?: () => void }).unref === 'function') {
    (timer as unknown as { unref: () => void }).unref();
  }
}

/**
 * Test-only. Stops the singleton, clears the interval, resets
 * the `started` flag so a subsequent test can spin up a fresh
 * loop if it needs to. The vitest setup calls this implicitly
 * by keeping `BLACKNEL_PUBLISH_JOB_ENABLED=false` — explicit
 * stop is for tests that want to verify the lifecycle.
 */
export function stopPublishCron(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  started = false;
  tickInFlight = false;
}

/** True when the singleton is currently running. Used by tests. */
export function isPublishCronRunning(): boolean {
  return started;
}

async function tickSafe(): Promise<void> {
  if (tickInFlight) {
    // Defensive: the previous tick is still working. Skip this
    // turn rather than queueing concurrent ticks against the
    // same row set.
    log.debug('publish cron — tick still in-flight, skipping turn');
    return;
  }
  tickInFlight = true;
  try {
    const result = await runPublishTick();
    if (!result.ok) {
      log.error({ err: result.error.message }, 'publish cron — tick failed');
    }
  } catch (cause) {
    log.error(
      {
        err: (cause as Error).message,
        stack: (cause as Error).stack,
      },
      'publish cron — tick threw',
    );
  } finally {
    tickInFlight = false;
  }
}
