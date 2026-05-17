import 'server-only';

import { env } from '@/lib/env';
import { log } from '@/lib/log';

import { runAdsSyncTick } from './ads-sync';
import { runCrisisScanTick } from './crisis-scan';
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
/**
 * Crisis scan tick interval — 60 minutes (Commit 25 / D-25-1).
 * Crisis pattern detection rarely benefits from sub-hour
 * resolution + Opus dominates the cost; halving Haiku-equivalent
 * cycles per hour is the right tradeoff.
 */
const CRISIS_TICK_INTERVAL_MS = 60 * 60_000;
/**
 * Ads-sync tick interval — 24h (Commit 28). Platform spend
 * reports refresh ~daily; sub-hour polling would just spend on
 * Phase-11 API quota without surfacing new data. The 2d window
 * inside the producer (see `lib/jobs/ads-sync.ts`) handles late
 * attribution revisions.
 */
const ADS_SYNC_TICK_INTERVAL_MS = 24 * 60 * 60_000;

let started = false;
let timer: ReturnType<typeof setInterval> | null = null;
let tickInFlight = false;

let crisisTimer: ReturnType<typeof setInterval> | null = null;
let crisisTickInFlight = false;

let adsSyncTimer: ReturnType<typeof setInterval> | null = null;
let adsSyncTickInFlight = false;

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

  // Phase 7 / Commit 25 — crisis-scan tick. Runs every 60 min
  // alongside the publish tick. Same env gates; same singleton
  // lifecycle.
  void crisisTickSafe();
  crisisTimer = setInterval(() => {
    void crisisTickSafe();
  }, CRISIS_TICK_INTERVAL_MS);
  if (
    crisisTimer &&
    typeof (crisisTimer as unknown as { unref?: () => void }).unref === 'function'
  ) {
    (crisisTimer as unknown as { unref: () => void }).unref();
  }
  log.info(
    { tickIntervalMs: CRISIS_TICK_INTERVAL_MS },
    'crisis cron — started',
  );

  // Phase 8 / Commit 28 — ads-sync tick. Same lifecycle as the
  // other crons; gated on `BLACKNEL_ADS_SYNC_ENABLED` so a dev
  // box can disable just the ads tick if mocks become noisy.
  if (env.BLACKNEL_ADS_SYNC_ENABLED) {
    void adsSyncTickSafe();
    adsSyncTimer = setInterval(() => {
      void adsSyncTickSafe();
    }, ADS_SYNC_TICK_INTERVAL_MS);
    if (
      adsSyncTimer &&
      typeof (adsSyncTimer as unknown as { unref?: () => void }).unref === 'function'
    ) {
      (adsSyncTimer as unknown as { unref: () => void }).unref();
    }
    log.info(
      { tickIntervalMs: ADS_SYNC_TICK_INTERVAL_MS },
      'ads-sync cron — started',
    );
  } else {
    log.info('ads-sync cron — disabled via BLACKNEL_ADS_SYNC_ENABLED=false');
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
  if (crisisTimer) {
    clearInterval(crisisTimer);
    crisisTimer = null;
  }
  if (adsSyncTimer) {
    clearInterval(adsSyncTimer);
    adsSyncTimer = null;
  }
  started = false;
  tickInFlight = false;
  crisisTickInFlight = false;
  adsSyncTickInFlight = false;
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

async function crisisTickSafe(): Promise<void> {
  if (crisisTickInFlight) {
    log.debug('crisis cron — tick still in-flight, skipping turn');
    return;
  }
  crisisTickInFlight = true;
  try {
    const result = await runCrisisScanTick();
    if (!result.ok) {
      log.error({ err: result.error.message }, 'crisis cron — tick failed');
    }
  } catch (cause) {
    log.error(
      {
        err: (cause as Error).message,
        stack: (cause as Error).stack,
      },
      'crisis cron — tick threw',
    );
  } finally {
    crisisTickInFlight = false;
  }
}

async function adsSyncTickSafe(): Promise<void> {
  if (adsSyncTickInFlight) {
    log.debug('ads-sync cron — tick still in-flight, skipping turn');
    return;
  }
  adsSyncTickInFlight = true;
  try {
    const result = await runAdsSyncTick();
    if (!result.ok) {
      log.error({ err: result.error.message }, 'ads-sync cron — tick failed');
    }
  } catch (cause) {
    log.error(
      {
        err: (cause as Error).message,
        stack: (cause as Error).stack,
      },
      'ads-sync cron — tick threw',
    );
  } finally {
    adsSyncTickInFlight = false;
  }
}
