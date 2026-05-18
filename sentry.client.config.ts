import * as Sentry from '@sentry/nextjs';

/**
 * Phase 11 / Commit 40 — Sentry browser init.
 *
 * Reads DSN from `NEXT_PUBLIC_SENTRY_DSN` (client env var). The
 * server-side `BLACKNEL_USE_REAL_SENTRY` flag does NOT gate this —
 * if a client DSN is present we capture. Browser sampling at 0.5
 * to stay under the Sentry Spike Protection cap during a noisy
 * production incident.
 */

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  enabled: typeof dsn === 'string' && dsn.length > 0,
  dsn,
  tracesSampleRate: 0.05,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
});
