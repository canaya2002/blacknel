import 'server-only';

import { eq } from 'drizzle-orm';

import { dbAdmin, type AnyPgTx } from '../db/client';
import { aiRateBuckets } from '../db/schema';
import type { PlanCode } from '../plans/plans';

import { AiError } from './types';

/**
 * Per-org token-bucket rate limit (C43b), PERSISTED in `ai_rate_buckets` so it
 * survives Vercel cold starts (no in-memory state). Refills continuously by
 * elapsed wall-clock time. Consumed before each REAL generation (the mock path
 * never reaches here — see lib/ai/client.ts). An empty bucket rejects with a
 * typed, NON-retryable `rate_limited` AiError before any API spend.
 */

export interface BucketConfig {
  /** Max tokens (burst). */
  readonly capacity: number;
  /** Tokens replenished per second (sustained rate). */
  readonly refillPerSec: number;
}

export const BUCKET_CONFIG: Readonly<Record<PlanCode, BucketConfig>> = {
  standard: { capacity: 5, refillPerSec: 5 / 60 }, // burst 5, ~5/min sustained
  growth: { capacity: 20, refillPerSec: 20 / 60 }, // burst 20, ~20/min
  enterprise: { capacity: 60, refillPerSec: 60 / 60 }, // burst 60, ~60/min
};

export interface BucketState {
  readonly tokens: number;
  readonly updatedAtMs: number;
}

/**
 * Pure: refill by elapsed wall-clock then try to consume one token. Exported
 * for deterministic unit tests (no DB, controlled `nowMs`).
 */
export function refillAndConsume(
  state: BucketState,
  config: BucketConfig,
  nowMs: number,
): { allowed: boolean; next: BucketState } {
  const elapsedSec = Math.max(0, (nowMs - state.updatedAtMs) / 1000);
  const refilled = Math.min(
    config.capacity,
    state.tokens + elapsedSec * config.refillPerSec,
  );
  if (refilled >= 1) {
    return { allowed: true, next: { tokens: refilled - 1, updatedAtMs: nowMs } };
  }
  return { allowed: false, next: { tokens: refilled, updatedAtMs: nowMs } };
}

// Test seams.
type RunAdminFn = <T>(fn: (tx: AnyPgTx) => Promise<T>) => Promise<T>;
let runAdmin: RunAdminFn = dbAdmin;
export function _setRunAdminForTests(fn: RunAdminFn): void {
  runAdmin = fn;
}
export function _resetRunAdminForTests(): void {
  runAdmin = dbAdmin;
}

let now: () => number = () => Date.now();
export function _setNowForTests(fn: () => number): void {
  now = fn;
}
export function _resetNowForTests(): void {
  now = () => Date.now();
}

/**
 * Consume one token for `orgId`. Reads + writes the persisted bucket under a
 * row lock (serialised per org), refilling by elapsed time first. Returns
 * false when the (refilled) bucket has < 1 token.
 */
export async function consumeRateToken(
  orgId: string,
  plan: PlanCode,
): Promise<boolean> {
  const config = BUCKET_CONFIG[plan];
  const nowMs = now();
  return runAdmin(async (tx) => {
    // Seed a full bucket on first use for this org.
    await tx
      .insert(aiRateBuckets)
      .values({ organizationId: orgId, tokens: config.capacity, updatedAtMs: nowMs })
      .onConflictDoNothing();

    const rows = (await tx
      .select({
        tokens: aiRateBuckets.tokens,
        updatedAtMs: aiRateBuckets.updatedAtMs,
      })
      .from(aiRateBuckets)
      .where(eq(aiRateBuckets.organizationId, orgId))
      .for('update')
      .limit(1)) as Array<{ tokens: number; updatedAtMs: number }>;

    const row = rows[0]!;
    const { allowed, next } = refillAndConsume(
      { tokens: row.tokens, updatedAtMs: Number(row.updatedAtMs) },
      config,
      nowMs,
    );

    await tx
      .update(aiRateBuckets)
      .set({ tokens: next.tokens, updatedAtMs: next.updatedAtMs })
      .where(eq(aiRateBuckets.organizationId, orgId));

    return allowed;
  });
}

export async function assertWithinRateLimit(
  orgId: string,
  plan: PlanCode,
): Promise<void> {
  const ok = await consumeRateToken(orgId, plan);
  if (!ok) {
    throw new AiError(
      'rate_limited',
      'AI rate limit reached for this organization. Try again shortly.',
    );
  }
}
