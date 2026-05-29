import 'server-only';

import { and, eq, gte, sql } from 'drizzle-orm';

import { dbAdmin, type AnyPgTx } from '../db/client';
import { aiGenerations, organizations, plans } from '../db/schema';
import type { PlanCode } from '../plans/plans';
import { checkUsage, incrementUsage } from '../usage/counters';
import { currentMonthPeriod } from '../usage/period';

import { AiError } from './types';

/**
 * Per-org AI budget (C43b). Two layers, both checked BEFORE any REAL
 * generation (the mock path never reaches here — gating lives in
 * lib/ai/client.ts, which only routes to adapter-real when AI is live):
 *
 *   1. Generation-count cap by plan (Standard 50/mo; Growth/Enterprise
 *      unlimited) — reuses the windowed usage_counters machinery
 *      (metric 'aiGenerationsPerMonth').
 *   2. Cost-ceiling circuit breaker by plan (cents/month) — the ONLY in-code
 *      cost guard for Growth/Enterprise (unlimited count), and defence in
 *      depth for Standard. Guards against a runaway Opus cascade.
 *
 * Both reject with a typed, NON-retryable `budget_exceeded` AiError.
 */

const AI_BUDGET_METRIC = 'aiGenerationsPerMonth' as const;

/**
 * Monthly cost ceiling per plan (cents) — a safety circuit breaker, NOT a
 * billing limit, set generously above expected usage. For Growth/Enterprise
 * (unlimited generation count) this is the only in-code cost guard.
 */
export const AI_MONTHLY_COST_CEILING_CENTS: Readonly<Record<PlanCode, number>> = {
  standard: 2_500, // $25
  growth: 15_000, // $150
  enterprise: 75_000, // $750
};

/** Pure: is month-to-date cost at/over the plan's safety ceiling? */
export function exceedsCostCeiling(plan: PlanCode, monthCostCents: number): boolean {
  return monthCostCents >= AI_MONTHLY_COST_CEILING_CENTS[plan];
}

// Test seam (mirrors lib/ai/persistence.ts) — inject a fixture-backed runAdmin.
type RunAdminFn = <T>(fn: (tx: AnyPgTx) => Promise<T>) => Promise<T>;
let runAdmin: RunAdminFn = dbAdmin;
export function _setRunAdminForTests(fn: RunAdminFn): void {
  runAdmin = fn;
}
export function _resetRunAdminForTests(): void {
  runAdmin = dbAdmin;
}

/**
 * Resolve the plan for an org on the system path (dbAdmin). Falls back to
 * 'standard' when no plan is linked — the safest (tightest) default.
 */
export async function planCodeForOrg(orgId: string): Promise<PlanCode> {
  const rows = await runAdmin<Array<{ code: PlanCode | null }>>((tx) =>
    tx
      .select({ code: plans.code })
      .from(organizations)
      .leftJoin(plans, eq(organizations.planId, plans.id))
      .where(eq(organizations.id, orgId))
      .limit(1),
  );
  return rows[0]?.code ?? 'standard';
}

async function monthToDateCostCents(tx: AnyPgTx, orgId: string): Promise<number> {
  const since = currentMonthPeriod().start;
  const rows = (await tx
    .select({
      cents: sql<string | number>`COALESCE(SUM(${aiGenerations.costCents}), 0)::int`,
    })
    .from(aiGenerations)
    .where(
      and(
        eq(aiGenerations.organizationId, orgId),
        gte(aiGenerations.createdAt, since),
      ),
    )) as Array<{ cents: string | number }>;
  const v = rows[0]?.cents ?? 0;
  return typeof v === 'number' ? v : Number(v) || 0;
}

/**
 * Throw `budget_exceeded` when the org is at/over its monthly generation cap
 * OR its monthly cost ceiling. Read-only (no mutation).
 */
export async function assertWithinBudget(
  orgId: string,
  plan: PlanCode,
): Promise<void> {
  await runAdmin(async (tx) => {
    const check = await checkUsage(tx, orgId, plan, AI_BUDGET_METRIC, 1);
    if (!check.ok) {
      throw new AiError(
        'budget_exceeded',
        `Monthly AI generation cap reached for plan ${plan} (${check.current}/${check.cap}).`,
      );
    }
    const spent = await monthToDateCostCents(tx, orgId);
    if (exceedsCostCeiling(plan, spent)) {
      throw new AiError(
        'budget_exceeded',
        `Monthly AI cost ceiling reached for plan ${plan} (${spent}/${AI_MONTHLY_COST_CEILING_CENTS[plan]} cents).`,
      );
    }
  });
}

/** Count one real generation toward the org's monthly budget. */
export async function recordGeneration(orgId: string): Promise<void> {
  await runAdmin((tx) => incrementUsage(tx, orgId, AI_BUDGET_METRIC));
}
