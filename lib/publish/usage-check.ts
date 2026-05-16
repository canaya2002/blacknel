import 'server-only';

import { type AnyPgTx, dbAdmin } from '../db/client';
import type { PlanCode } from '../plans/plans';
import { checkUsage, type UsageCheck } from '../usage/counters';
import { err, ok, type Result } from '../types/result';
import type { AppError } from '../errors';

/**
 * Read the org's `postsPerMonth` budget vs. current usage. Used in
 * two places:
 *
 *   1. UI (Server Component on /publish) — when `ok=false` the
 *      "Nuevo post" CTA is replaced by a banner pointing at /billing.
 *   2. Server Action `createPostAction` — defense-in-depth gate.
 *      A user with a stale tab can still hit the action; the
 *      `assertPostsCap` wrapper below rejects the call with
 *      `PLAN_LIMIT_REACHED`.
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

/**
 * Transaction-bound variant. Production callers use `assertPostsCap`
 * which opens its own `dbAdmin`; integration tests pass an existing
 * fixture transaction so the check runs against the test pglite
 * without going through `getRawDb()`.
 */
export async function checkPostsCapWithTx(
  tx: AnyPgTx,
  orgId: string,
  plan: PlanCode,
): Promise<UsageCheck> {
  return checkUsage(tx, orgId, plan, 'postsPerMonth', 1);
}

/**
 * Assertion wrapper used by Server Actions. Returns an `ok(true)` when
 * there is room for one more post in the current period, or
 * `err('PLAN_LIMIT_REACHED', …)` carrying `current` / `cap` meta. The
 * action layer just returns the failure result to the caller — no
 * branching needed.
 *
 * Extracted so the integration test can exercise the exact branch
 * the action takes without having to mock `requireUser` /
 * `revalidatePath` (Section B test, composer-cap-gating).
 */
export async function assertPostsCap(
  orgId: string,
  plan: PlanCode,
): Promise<Result<true, AppError>> {
  const cap = await checkPostsCap(orgId, plan);
  return resultFromCap(cap);
}

/**
 * Same semantics as `assertPostsCap`, scoped to an existing
 * transaction — for the integration test.
 */
export async function assertPostsCapWithTx(
  tx: AnyPgTx,
  orgId: string,
  plan: PlanCode,
): Promise<Result<true, AppError>> {
  const cap = await checkPostsCapWithTx(tx, orgId, plan);
  return resultFromCap(cap);
}

function resultFromCap(cap: UsageCheck): Result<true, AppError> {
  if (!cap.ok) {
    return err(
      'PLAN_LIMIT_REACHED',
      'Has usado el cupo mensual de posts para tu plan.',
      { meta: { current: cap.current, cap: cap.cap } },
    );
  }
  return ok(true);
}
