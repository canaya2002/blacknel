import { AppError } from '../errors';

import { getPlan, type LimitMetric, type PlanCode } from './plans';

/**
 * Plan-limit primitives. `checkLimit` queries `usage_counters` plus the
 * org's active plan, returns a quotas snapshot, and never throws — the
 * caller decides whether to surface an upgrade prompt or hard-stop.
 *
 * In Phase 1 the DB read goes through `dbAs(orgId, ...)` so RLS scopes
 * the counter to the caller's org automatically. Until pglite-as-dev is
 * wired into the runtime (next commit), `checkLimit` is called only by
 * code paths that themselves require a configured DB.
 */

export interface LimitCheck {
  metric: LimitMetric;
  current: number;
  /** `-1` if the plan exposes unlimited usage. */
  limit: number;
  /** Convenience: `current >= limit` when the limit is non-unlimited. */
  reached: boolean;
  /** True if the action that would consume `+1` is allowed. */
  ok: boolean;
}

/**
 * Pure resolver: given a plan and a metric, return the configured cap.
 * `-1` means unlimited.
 */
export function getPlanLimit(planCode: PlanCode, metric: LimitMetric): number {
  return getPlan(planCode).limits[metric];
}

/**
 * Returns whether `currentValue + delta` fits inside the plan's cap.
 * `-1` (unlimited) always returns `true`.
 */
export function fitsLimit(
  planCode: PlanCode,
  metric: LimitMetric,
  currentValue: number,
  delta: number = 1,
): boolean {
  const cap = getPlanLimit(planCode, metric);
  if (cap === -1) return true;
  return currentValue + delta <= cap;
}

/**
 * Throwing guard. Use right before performing the action that consumes
 * the quota.
 */
export function requireLimit(
  planCode: PlanCode,
  metric: LimitMetric,
  currentValue: number,
  delta: number = 1,
): void {
  if (!fitsLimit(planCode, metric, currentValue, delta)) {
    const cap = getPlanLimit(planCode, metric);
    throw new AppError(
      'PLAN_LIMIT_REACHED',
      `Plan ${planCode} limit reached for "${String(metric)}" (${currentValue + delta}/${cap}).`,
      { meta: { plan: planCode, metric, current: currentValue, delta, cap } },
    );
  }
}
