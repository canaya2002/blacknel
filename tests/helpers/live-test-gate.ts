import { env } from '../../lib/env';

/**
 * Shared gate for the `*.live.test.ts` suites — replaces the condition that
 * was copy-pasted into all five files. Live suites connect to the real
 * `DATABASE_URL`, so they default-skip and only run when ALL hold:
 *
 *   1. `BLACKNEL_LIVE_TEST === 'true'`  — explicit opt-in.
 *   2. `DATABASE_URL` is set.
 *   3. `DATABASE_URL` does NOT point at a PRODUCTION project — allowlist is
 *      staging/local only. Until a dedicated staging project exists this keeps
 *      every live suite skipped against prod, fail-safe, even if someone sets
 *      the opt-in flag by mistake.
 *
 * Note: `vitest.config.ts` `test.env` forces `DATABASE_URL=''` +
 * `BLACKNEL_LIVE_TEST=''` under `pnpm test`, so the live suites are already
 * skipped there. This gate is the second layer for any invocation that
 * supplies its own env (and the prod-host check is the third).
 */

// Supabase project refs / hosts that are PRODUCTION. Live tests must never run
// against these. See project memory: `ctperyxdiwapcucqbbss` is the sole prod
// project; there is no separate staging today.
const PROD_DB_MARKERS = ['ctperyxdiwapcucqbbss'] as const;

export function isLiveEnabled(): boolean {
  if (process.env.BLACKNEL_LIVE_TEST !== 'true') return false;
  const url = env.DATABASE_URL;
  if (!url) return false;
  // Allowlist = anything that is NOT production.
  if (PROD_DB_MARKERS.some((marker) => url.includes(marker))) return false;
  return true;
}
