/**
 * Next.js 16 instrumentation hook (Commit 20a, extended C40).
 *
 * Runs once per runtime process start. Two responsibilities:
 *
 *   1. **Sentry init per runtime** (C40) — `sentry.server.config.ts`
 *      for Node, `sentry.edge.config.ts` for middleware/Edge. Inits
 *      are no-ops when `BLACKNEL_USE_REAL_SENTRY=false` or
 *      `SENTRY_DSN` is missing.
 *
 *   2. **Publish-job cron** (C20a) — Node-only. The cron is
 *      `setInterval`-based, so the edge runtime branches out via
 *      the `NEXT_RUNTIME` guard. Cron is retired in C44 when Inngest
 *      Cloud takes over the schedule.
 *
 * Reference: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register(): Promise<void> {
  // Skip during the build phase. `next build` page-data collection spawns
  // one worker per CPU (27 here); each runs this hook, and loading the
  // Sentry/OpenTelemetry Node instrumentation across all of them segfaults
  // the build on Windows (native @opentelemetry/instrumentation patching ×
  // N workers). Instrumentation only matters at runtime — register() runs
  // again on every serverless cold start, where NEXT_PHASE is the server
  // phase, not the build phase. Runtime behavior is unchanged.
  if (process.env.NEXT_PHASE === 'phase-production-build') return;

  // Sentry first so any error during the cron startup itself is
  // captured.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  } else if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }

  // Cron only runs on Node. setInterval requires a long-lived
  // process; the edge runtime is request-scoped.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { startPublishCron } = await import('@/lib/jobs/cron-loop');
  startPublishCron();
}

export { captureRequestError as onRequestError } from '@sentry/nextjs';
