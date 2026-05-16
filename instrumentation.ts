/**
 * Next.js 16 instrumentation hook (Commit 20a).
 *
 * Runs once per Node.js process start. We use it to arrancar el
 * publish-job cron — but only in the development runtime where
 * the gates inside `startPublishCron()` open. Production and
 * test never reach the start path; the function is a no-op for
 * them by design.
 *
 * Reference: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register(): Promise<void> {
  // Next.js calls `register` on both the Node.js and edge
  // runtimes. The cron is a `setInterval` (Node.js only). The
  // dynamic import guards against accidental edge-runtime
  // execution AND avoids pulling `server-only` modules into the
  // edge bundle.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { startPublishCron } = await import('@/lib/jobs/cron-loop');
  startPublishCron();
}
