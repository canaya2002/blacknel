import 'server-only';

import { and, eq, gte, lt, sql } from 'drizzle-orm';

import type { AnyPgTx } from '@/lib/db/client';
import { usageCounters } from '@/lib/db/schema';
import type { LimitMetric, PlanCode } from '@/lib/plans/plans';
import { fitsLimit, getPlanLimit } from '@/lib/plans/limits';

import { currentMonthPeriod, INFINITY_PERIOD } from './period';

/**
 * Usage counters. Two flavors:
 *
 *   - **Point-in-time** (brands, users, socialAccounts, locations):
 *     a single row per (org, metric) with `period_start = -infinity`,
 *     `period_end = +infinity`. We bump the row up or down whenever
 *     the canonical table changes — `incrementUsage(...) / decrementUsage(...)`.
 *
 *   - **Windowed** (postsPerMonth): a row per (org, metric, period_start)
 *     covering one calendar month. `readUsage` rolls the period
 *     forward on read if the existing row is stale — no Inngest cron
 *     needed for Phase 2.
 *
 * All callers operate inside a transaction obtained from `runAdmin` or
 * `dbAs` — both work, but admin context is required when the calling
 * Server Action is itself elevated (e.g. cleanup after deleting an org).
 */

export const POINT_IN_TIME_METRICS = [
  'brands',
  'users',
  'socialAccounts',
  'locations',
  'assetsInLibrary',
  'storageBytes',
  'mediaStorageBytes',
] as const satisfies ReadonlyArray<LimitMetric>;

export const WINDOWED_METRICS = [
  'postsPerMonth',
  'reviewRequestsPerMonth',
  'aiGenerationsPerMonth',
] as const satisfies ReadonlyArray<LimitMetric>;

export type PointInTimeMetric = (typeof POINT_IN_TIME_METRICS)[number];
export type WindowedMetric = (typeof WINDOWED_METRICS)[number];

function isWindowed(metric: LimitMetric): metric is WindowedMetric {
  return (WINDOWED_METRICS as ReadonlyArray<LimitMetric>).includes(metric);
}

interface UsageRow {
  value: number;
  periodStart: Date;
  periodEnd: Date;
}

/**
 * Read the current usage value for `metric` in `organizationId`.
 * Roll-forward semantics: a stale `postsPerMonth` row from last
 * month resolves to `0` (and stays in the table — we don't delete
 * history). A point-in-time metric just returns the stored value.
 *
 * Returns `0` when no row exists yet.
 */
export async function readUsage(
  tx: AnyPgTx,
  organizationId: string,
  metric: LimitMetric,
): Promise<number> {
  if (isWindowed(metric)) {
    const period = currentMonthPeriod();
    const rows = await tx
      .select({ value: usageCounters.value })
      .from(usageCounters)
      .where(
        and(
          eq(usageCounters.organizationId, organizationId),
          eq(usageCounters.metric, metric),
          gte(usageCounters.periodStart, period.start),
          lt(usageCounters.periodStart, period.end),
        ),
      )
      .limit(1);
    return rows[0]?.value ?? 0;
  }

  const rows = await tx
    .select({ value: usageCounters.value })
    .from(usageCounters)
    .where(
      and(
        eq(usageCounters.organizationId, organizationId),
        eq(usageCounters.metric, metric),
      ),
    )
    .limit(1);
  return rows[0]?.value ?? 0;
}

/**
 * Increment the counter for `metric` by `delta` (default 1). Upserts
 * the row for the current period.
 */
export async function incrementUsage(
  tx: AnyPgTx,
  organizationId: string,
  metric: LimitMetric,
  delta = 1,
): Promise<number> {
  const period = isWindowed(metric) ? currentMonthPeriod() : INFINITY_PERIOD;
  await tx
    .insert(usageCounters)
    .values({
      organizationId,
      metric,
      periodStart: period.start,
      periodEnd: period.end,
      value: delta,
    })
    .onConflictDoUpdate({
      target: [
        usageCounters.organizationId,
        usageCounters.metric,
        usageCounters.periodStart,
      ],
      set: {
        value: sql`${usageCounters.value} + ${delta}`,
      },
    });
  return readUsage(tx, organizationId, metric);
}

/**
 * Decrement the counter. Floors at 0 — never goes negative, even if
 * the source table is somehow out of sync with the counter.
 */
export async function decrementUsage(
  tx: AnyPgTx,
  organizationId: string,
  metric: LimitMetric,
  delta = 1,
): Promise<number> {
  const period = isWindowed(metric) ? currentMonthPeriod() : INFINITY_PERIOD;
  await tx
    .insert(usageCounters)
    .values({
      organizationId,
      metric,
      periodStart: period.start,
      periodEnd: period.end,
      value: 0,
    })
    .onConflictDoUpdate({
      target: [
        usageCounters.organizationId,
        usageCounters.metric,
        usageCounters.periodStart,
      ],
      set: {
        value: sql`GREATEST(0, ${usageCounters.value} - ${delta})`,
      },
    });
  return readUsage(tx, organizationId, metric);
}

/**
 * Composite: "can we add `delta` of `metric` under `plan`?" Reads the
 * counter and checks the plan's hard limit. Returns the decision plus
 * useful context for UI.
 */
export interface UsageCheck {
  ok: boolean;
  current: number;
  cap: number;
  reached: boolean;
}

export async function checkUsage(
  tx: AnyPgTx,
  organizationId: string,
  plan: PlanCode,
  metric: LimitMetric,
  delta = 1,
): Promise<UsageCheck> {
  const current = await readUsage(tx, organizationId, metric);
  const cap = getPlanLimit(plan, metric);
  return {
    ok: fitsLimit(plan, metric, current, delta),
    current,
    cap,
    reached: cap !== -1 && current >= cap,
  };
}

interface UsageRowOut {
  metric: LimitMetric;
  value: number;
  periodStart: Date;
  periodEnd: Date;
}

/**
 * Snapshot of every counter for the org (current period for windowed,
 * +/- infinity for point-in-time). Used by /billing.
 */
export async function snapshotUsage(
  tx: AnyPgTx,
  organizationId: string,
): Promise<UsageRowOut[]> {
  const rows = (await tx
    .select({
      metric: usageCounters.metric,
      value: usageCounters.value,
      periodStart: usageCounters.periodStart,
      periodEnd: usageCounters.periodEnd,
    })
    .from(usageCounters)
    .where(eq(usageCounters.organizationId, organizationId))) as Array<UsageRow & { metric: string }>;

  return rows.map((r) => ({
    metric: r.metric as LimitMetric,
    value: r.value,
    periodStart: r.periodStart,
    periodEnd: r.periodEnd,
  }));
}
