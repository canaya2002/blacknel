import 'server-only';

import { dbAdmin } from '../db/client';
import type { PlanCode } from '../plans/plans';
import { checkUsage, type UsageCheck } from '../usage/counters';

/**
 * Read the org's `postsPerMonth` budget vs. current usage. Used in
 * two places:
 *
 *   1. UI (Server Component on /publish) — when `ok=false` the
 *      "Nuevo post" CTA is replaced by a banner pointing at /billing.
 *   2. Server Action `createPostAction` — defense-in-depth gate.
 *      A user with a stale tab can still hit the action; this
 *      check rejects the call with `PLAN_LIMIT_REACHED`.
 *
 * `dbAdmin` is required because `usage_counters` only grants SELECT
 * to `authenticated` and the read of the limit value lives in the
 * usage helper. Tracked at TODO.md#usage-counters-rls-scoped for
 * the Phase-11 RLS-scoped-write evaluation.
 */
export async function checkPostsCap(
  orgId: string,
  plan: PlanCode,
): Promise<UsageCheck> {
  return dbAdmin((tx) => checkUsage(tx, orgId, plan, 'postsPerMonth', 1));
}
