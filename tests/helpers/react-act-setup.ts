/**
 * Tell React the test environment supports `act()`. Without this flag,
 * vitest + jsdom prints "The current testing environment is not
 * configured to support act(...)" on every render — annoying noise
 * that hides real issues.
 *
 * React 19 reads `globalThis.IS_REACT_ACT_ENVIRONMENT` once at import
 * time, so it has to be set before the React runtime initializes.
 * Vitest loads `setupFiles` before any test module — perfect spot.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Disable the publish-job cron globally during tests (Commit 20a).
 * `instrumentation.ts` reads `env.BLACKNEL_PUBLISH_JOB_ENABLED` at
 * Next.js startup; tests never run instrumentation, but a unit
 * test that imports `lib/jobs/cron-loop.ts` could accidentally
 * arrancar `setInterval`. Belt-and-suspenders: env says off, the
 * cron-loop module also gates on it.
 */
if (!process.env.BLACKNEL_PUBLISH_JOB_ENABLED) {
  process.env.BLACKNEL_PUBLISH_JOB_ENABLED = 'false';
}
if (!process.env.BLACKNEL_ADS_SYNC_ENABLED) {
  process.env.BLACKNEL_ADS_SYNC_ENABLED = 'false';
}
if (!process.env.BLACKNEL_ADS_ALERTS_ENABLED) {
  process.env.BLACKNEL_ADS_ALERTS_ENABLED = 'false';
}
if (!process.env.BLACKNEL_SEED_WHATSAPP) {
  process.env.BLACKNEL_SEED_WHATSAPP = 'false';
}
if (!process.env.BLACKNEL_NPS_JOB_ENABLED) {
  process.env.BLACKNEL_NPS_JOB_ENABLED = 'false';
}
if (!process.env.BLACKNEL_SEED_NPS) {
  process.env.BLACKNEL_SEED_NPS = 'false';
}
if (!process.env.BLACKNEL_LISTENING_JOB_ENABLED) {
  process.env.BLACKNEL_LISTENING_JOB_ENABLED = 'false';
}
if (!process.env.BLACKNEL_SEED_LISTENING) {
  process.env.BLACKNEL_SEED_LISTENING = 'false';
}
if (!process.env.BLACKNEL_SCHEDULED_REPORTS_JOB_ENABLED) {
  process.env.BLACKNEL_SCHEDULED_REPORTS_JOB_ENABLED = 'false';
}
if (!process.env.BLACKNEL_SEED_COMPETITORS_REPORTS) {
  process.env.BLACKNEL_SEED_COMPETITORS_REPORTS = 'false';
}
if (!process.env.BLACKNEL_AUDIT_ANOMALY_JOB_ENABLED) {
  process.env.BLACKNEL_AUDIT_ANOMALY_JOB_ENABLED = 'false';
}
if (!process.env.BLACKNEL_AUDIT_RETENTION_JOB_ENABLED) {
  process.env.BLACKNEL_AUDIT_RETENTION_JOB_ENABLED = 'false';
}
