import 'server-only';

import { env } from '@/lib/env';
import { log } from '@/lib/log';

import { runAdsAlertsScanTick } from './ads-alerts-scan';
import { runAdsSyncTick } from './ads-sync';
import { runAuditAnomalyScanTickEntry } from './audit-anomaly-scan';
import { runAuditRetentionPurgeTickEntry } from './audit-retention-purge';
import { runCrisisScanTick } from './crisis-scan';
import { runListeningScanTickEntry } from './listening-scan';
import { runNpsScanTick } from './nps-scan';
import { runPublishTick } from './publish-post';
import { runScheduledReportsTickEntry } from './scheduled-reports-tick';

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
/**
 * Ads-alerts tick — 12h (Commit 29). Producer reads the rollups
 * that `ads-sync` wrote and runs the heuristic in
 * `lib/ads/alerts.ts`. Twice a day is plenty: a CTR drop you
 * miss for 12h isn't materially worse than one you catch in 6,
 * and you avoid alert-flood on volatile accounts.
 */
const ADS_ALERTS_TICK_INTERVAL_MS = 12 * 60 * 60_000;
/**
 * NPS post-resolution tick — 30 minutes (Phase 9 / Commit 32). The
 * producer scans threads closed in the last 24h, so a half-hour
 * cadence catches new closures with at most ~30 min lag — fast
 * enough for the NPS prompt to land while the experience is fresh,
 * slow enough to avoid burning resources on idle orgs.
 */
const NPS_TICK_INTERVAL_MS = 30 * 60_000;
/**
 * Listening scan tick — 60 minutes (Phase 9 / Commit 33). The
 * deterministic mock connector produces a stable mention set per
 * `(org, term, UTC day)`; running every hour shows new mentions
 * trickle in across the day while the per-day uniqueness on the
 * scan key keeps the total stable. Phase 11 swap (Brand24 /
 * Mention.com) keeps the same cadence.
 */
const LISTENING_TICK_INTERVAL_MS = 60 * 60_000;
/**
 * Scheduled-reports tick — 15 minutes (Phase 9 / Commit 34). Short
 * cadence so a schedule defined at "mon 09:00" fires within ~15
 * min of its target across the org's local clock. The cron tick
 * is cheap — a partial index over `(next_run_at) WHERE
 * status='active'` keeps the selector constant-time even for
 * thousands of schedules.
 */
const SCHEDULED_REPORTS_TICK_INTERVAL_MS = 15 * 60_000;
/**
 * Audit anomaly detection tick — 60 minutes (Phase 10 / Commit 37).
 * Scans last 1h audit_events + 90d IP history per org. Heuristic
 * is conservative (3 kinds: off_hours_access, new_ip, mass_export)
 * so the hourly cadence keeps noise low.
 */
const AUDIT_ANOMALY_TICK_INTERVAL_MS = 60 * 60_000;
/**
 * Audit retention purge tick — 24 hours (Phase 10 / Commit 37).
 * Bounded delete (5000 rows/tick) protects against runaway purges.
 * Daily is plenty — retention thresholds are days-to-years, not
 * minutes.
 */
const AUDIT_RETENTION_TICK_INTERVAL_MS = 24 * 60 * 60_000;

let started = false;
let timer: ReturnType<typeof setInterval> | null = null;
let tickInFlight = false;

let crisisTimer: ReturnType<typeof setInterval> | null = null;
let crisisTickInFlight = false;

let adsSyncTimer: ReturnType<typeof setInterval> | null = null;
let adsSyncTickInFlight = false;

let adsAlertsTimer: ReturnType<typeof setInterval> | null = null;
let adsAlertsTickInFlight = false;

let npsTimer: ReturnType<typeof setInterval> | null = null;
let npsTickInFlight = false;

let listeningTimer: ReturnType<typeof setInterval> | null = null;
let listeningTickInFlight = false;

let scheduledReportsTimer: ReturnType<typeof setInterval> | null = null;
let scheduledReportsTickInFlight = false;

let auditAnomalyTimer: ReturnType<typeof setInterval> | null = null;
let auditAnomalyTickInFlight = false;

let auditRetentionTimer: ReturnType<typeof setInterval> | null = null;
let auditRetentionTickInFlight = false;

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

  // Phase 8 / Commit 29 — ads-alerts producer tick. 12h interval;
  // gated independently from ads-sync so a noisy heuristic can be
  // muted without losing the spend rollup.
  if (env.BLACKNEL_ADS_ALERTS_ENABLED) {
    void adsAlertsTickSafe();
    adsAlertsTimer = setInterval(() => {
      void adsAlertsTickSafe();
    }, ADS_ALERTS_TICK_INTERVAL_MS);
    if (
      adsAlertsTimer &&
      typeof (adsAlertsTimer as unknown as { unref?: () => void }).unref === 'function'
    ) {
      (adsAlertsTimer as unknown as { unref: () => void }).unref();
    }
    log.info(
      { tickIntervalMs: ADS_ALERTS_TICK_INTERVAL_MS },
      'ads-alerts cron — started',
    );
  } else {
    log.info('ads-alerts cron — disabled via BLACKNEL_ADS_ALERTS_ENABLED=false');
  }

  // Phase 9 / Commit 32 — NPS post-resolution tick. 30 min cadence;
  // gated by BLACKNEL_NPS_JOB_ENABLED so a noisy test environment
  // can disable just this loop without touching the others.
  if (env.BLACKNEL_NPS_JOB_ENABLED) {
    void npsTickSafe();
    npsTimer = setInterval(() => {
      void npsTickSafe();
    }, NPS_TICK_INTERVAL_MS);
    if (
      npsTimer &&
      typeof (npsTimer as unknown as { unref?: () => void }).unref === 'function'
    ) {
      (npsTimer as unknown as { unref: () => void }).unref();
    }
    log.info(
      { tickIntervalMs: NPS_TICK_INTERVAL_MS },
      'nps cron — started',
    );
  } else {
    log.info('nps cron — disabled via BLACKNEL_NPS_JOB_ENABLED=false');
  }

  // Phase 9 / Commit 33 — listening scan tick. 60 min cadence;
  // gated by BLACKNEL_LISTENING_JOB_ENABLED. The mock connector
  // is deterministic per (org, term, UTC day) so re-firing the
  // tick within the day is a no-op (ON CONFLICT DO NOTHING on
  // listening_mentions_external_unique).
  if (env.BLACKNEL_LISTENING_JOB_ENABLED) {
    void listeningTickSafe();
    listeningTimer = setInterval(() => {
      void listeningTickSafe();
    }, LISTENING_TICK_INTERVAL_MS);
    if (
      listeningTimer &&
      typeof (listeningTimer as unknown as { unref?: () => void }).unref === 'function'
    ) {
      (listeningTimer as unknown as { unref: () => void }).unref();
    }
    log.info(
      { tickIntervalMs: LISTENING_TICK_INTERVAL_MS },
      'listening cron — started',
    );
  } else {
    log.info(
      'listening cron — disabled via BLACKNEL_LISTENING_JOB_ENABLED=false',
    );
  }

  // Phase 9 / Commit 34 — scheduled-reports dispatcher tick.
  // 15-min cadence; gated by BLACKNEL_SCHEDULED_REPORTS_JOB_ENABLED.
  // The selector reads the partial index `scheduled_reports_due_idx`
  // so the cost stays constant even at scale.
  if (env.BLACKNEL_SCHEDULED_REPORTS_JOB_ENABLED) {
    void scheduledReportsTickSafe();
    scheduledReportsTimer = setInterval(() => {
      void scheduledReportsTickSafe();
    }, SCHEDULED_REPORTS_TICK_INTERVAL_MS);
    if (
      scheduledReportsTimer &&
      typeof (scheduledReportsTimer as unknown as { unref?: () => void }).unref === 'function'
    ) {
      (scheduledReportsTimer as unknown as { unref: () => void }).unref();
    }
    log.info(
      { tickIntervalMs: SCHEDULED_REPORTS_TICK_INTERVAL_MS },
      'scheduled-reports cron — started',
    );
  } else {
    log.info(
      'scheduled-reports cron — disabled via BLACKNEL_SCHEDULED_REPORTS_JOB_ENABLED=false',
    );
  }

  // Phase 10 / Commit 37 — audit anomaly detection tick.
  if (env.BLACKNEL_AUDIT_ANOMALY_JOB_ENABLED) {
    void auditAnomalyTickSafe();
    auditAnomalyTimer = setInterval(() => {
      void auditAnomalyTickSafe();
    }, AUDIT_ANOMALY_TICK_INTERVAL_MS);
    if (
      auditAnomalyTimer &&
      typeof (auditAnomalyTimer as unknown as { unref?: () => void }).unref === 'function'
    ) {
      (auditAnomalyTimer as unknown as { unref: () => void }).unref();
    }
    log.info(
      { tickIntervalMs: AUDIT_ANOMALY_TICK_INTERVAL_MS },
      'audit-anomaly cron — started',
    );
  } else {
    log.info(
      'audit-anomaly cron — disabled via BLACKNEL_AUDIT_ANOMALY_JOB_ENABLED=false',
    );
  }

  // Phase 10 / Commit 37 — audit retention purge tick.
  if (env.BLACKNEL_AUDIT_RETENTION_JOB_ENABLED) {
    void auditRetentionTickSafe();
    auditRetentionTimer = setInterval(() => {
      void auditRetentionTickSafe();
    }, AUDIT_RETENTION_TICK_INTERVAL_MS);
    if (
      auditRetentionTimer &&
      typeof (auditRetentionTimer as unknown as { unref?: () => void }).unref === 'function'
    ) {
      (auditRetentionTimer as unknown as { unref: () => void }).unref();
    }
    log.info(
      { tickIntervalMs: AUDIT_RETENTION_TICK_INTERVAL_MS },
      'audit-retention cron — started',
    );
  } else {
    log.info(
      'audit-retention cron — disabled via BLACKNEL_AUDIT_RETENTION_JOB_ENABLED=false',
    );
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
  if (adsAlertsTimer) {
    clearInterval(adsAlertsTimer);
    adsAlertsTimer = null;
  }
  if (npsTimer) {
    clearInterval(npsTimer);
    npsTimer = null;
  }
  if (listeningTimer) {
    clearInterval(listeningTimer);
    listeningTimer = null;
  }
  if (scheduledReportsTimer) {
    clearInterval(scheduledReportsTimer);
    scheduledReportsTimer = null;
  }
  if (auditAnomalyTimer) {
    clearInterval(auditAnomalyTimer);
    auditAnomalyTimer = null;
  }
  if (auditRetentionTimer) {
    clearInterval(auditRetentionTimer);
    auditRetentionTimer = null;
  }
  started = false;
  tickInFlight = false;
  crisisTickInFlight = false;
  adsSyncTickInFlight = false;
  adsAlertsTickInFlight = false;
  npsTickInFlight = false;
  listeningTickInFlight = false;
  scheduledReportsTickInFlight = false;
  auditAnomalyTickInFlight = false;
  auditRetentionTickInFlight = false;
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

async function adsAlertsTickSafe(): Promise<void> {
  if (adsAlertsTickInFlight) {
    log.debug('ads-alerts cron — tick still in-flight, skipping turn');
    return;
  }
  adsAlertsTickInFlight = true;
  try {
    const result = await runAdsAlertsScanTick();
    if (!result.ok) {
      log.error({ err: result.error.message }, 'ads-alerts cron — tick failed');
    }
  } catch (cause) {
    log.error(
      {
        err: (cause as Error).message,
        stack: (cause as Error).stack,
      },
      'ads-alerts cron — tick threw',
    );
  } finally {
    adsAlertsTickInFlight = false;
  }
}

async function npsTickSafe(): Promise<void> {
  if (npsTickInFlight) {
    log.debug('nps cron — tick still in-flight, skipping turn');
    return;
  }
  npsTickInFlight = true;
  try {
    const result = await runNpsScanTick();
    if (!result.ok) {
      log.error({ err: result.error.message }, 'nps cron — tick failed');
    }
  } catch (cause) {
    log.error(
      {
        err: (cause as Error).message,
        stack: (cause as Error).stack,
      },
      'nps cron — tick threw',
    );
  } finally {
    npsTickInFlight = false;
  }
}

async function listeningTickSafe(): Promise<void> {
  if (listeningTickInFlight) {
    log.debug('listening cron — tick still in-flight, skipping turn');
    return;
  }
  listeningTickInFlight = true;
  try {
    const result = await runListeningScanTickEntry();
    if (!result.ok) {
      log.error({ err: result.error.message }, 'listening cron — tick failed');
    }
  } catch (cause) {
    log.error(
      {
        err: (cause as Error).message,
        stack: (cause as Error).stack,
      },
      'listening cron — tick threw',
    );
  } finally {
    listeningTickInFlight = false;
  }
}

async function scheduledReportsTickSafe(): Promise<void> {
  if (scheduledReportsTickInFlight) {
    log.debug('scheduled-reports cron — tick still in-flight, skipping turn');
    return;
  }
  scheduledReportsTickInFlight = true;
  try {
    const result = await runScheduledReportsTickEntry();
    if (!result.ok) {
      log.error(
        { err: result.error.message },
        'scheduled-reports cron — tick failed',
      );
    }
  } catch (cause) {
    log.error(
      {
        err: (cause as Error).message,
        stack: (cause as Error).stack,
      },
      'scheduled-reports cron — tick threw',
    );
  } finally {
    scheduledReportsTickInFlight = false;
  }
}

async function auditAnomalyTickSafe(): Promise<void> {
  if (auditAnomalyTickInFlight) {
    log.debug('audit-anomaly cron — tick still in-flight, skipping turn');
    return;
  }
  auditAnomalyTickInFlight = true;
  try {
    const result = await runAuditAnomalyScanTickEntry();
    if (!result.ok) {
      log.error({ err: result.error.message }, 'audit-anomaly cron — tick failed');
    }
  } catch (cause) {
    log.error(
      {
        err: (cause as Error).message,
        stack: (cause as Error).stack,
      },
      'audit-anomaly cron — tick threw',
    );
  } finally {
    auditAnomalyTickInFlight = false;
  }
}

async function auditRetentionTickSafe(): Promise<void> {
  if (auditRetentionTickInFlight) {
    log.debug('audit-retention cron — tick still in-flight, skipping turn');
    return;
  }
  auditRetentionTickInFlight = true;
  try {
    const result = await runAuditRetentionPurgeTickEntry();
    if (!result.ok) {
      log.error(
        { err: result.error.message },
        'audit-retention cron — tick failed',
      );
    }
  } catch (cause) {
    log.error(
      {
        err: (cause as Error).message,
        stack: (cause as Error).stack,
      },
      'audit-retention cron — tick threw',
    );
  } finally {
    auditRetentionTickInFlight = false;
  }
}
