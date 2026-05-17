import 'server-only';

import { log } from '@/lib/log';
import { runPostResolutionTick } from '@/lib/nps/triggers';
import { ok, type Result } from '@/lib/types/result';

/**
 * NPS post-resolution scan tick (Phase 9 / Commit 32).
 *
 * The cron loop in `lib/jobs/cron-loop.ts` calls this every 30
 * minutes. Idempotency comes from `nps_invitations_one_per_day` +
 * `min_days_between_sends` — re-running the same window is a no-op
 * for already-invited contacts (the throttled branch returns
 * cleanly).
 */
export async function runNpsScanTick(): Promise<Result<{
  threadsConsidered: number;
  invitationsSent: number;
  throttled: number;
  skipped: number;
}>> {
  const result = await runPostResolutionTick();
  if (!result.ok) {
    log.error(
      { err: result.error.message },
      'nps cron — tick failed',
    );
    return result;
  }
  return ok(result.data);
}
