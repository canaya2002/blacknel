import 'server-only';

import { and, desc, eq, gte, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';

import { dbAdmin, dbAs, type AnyPgTx } from '../db/client';
import { aiGenerations } from '../db/schema';

/**
 * Test seam — vitest injects a fixture-backed `runAdmin` / `runAs`
 * here in `beforeAll` so the persistence layer can write/read
 * against the in-memory pglite DB without `getRawDb()` throwing.
 *
 * Production code path is the `defaultDeps` set at module load.
 */
type RunAdminFn = <T>(fn: (tx: AnyPgTx) => Promise<T>) => Promise<T>;
type RunAsFn = <T>(
  ctx: { orgId: string; userId: string },
  fn: (tx: AnyPgTx) => Promise<T>,
) => Promise<T>;

interface PersistenceDeps {
  asAdmin: RunAdminFn;
  asUser: RunAsFn;
}

let activeDeps: PersistenceDeps = {
  asAdmin: dbAdmin,
  asUser: dbAs,
};

export function _setDbDepsForTests(deps: PersistenceDeps): void {
  activeDeps = deps;
}

export function _resetDbDepsForTests(): void {
  activeDeps = { asAdmin: dbAdmin, asUser: dbAs };
}

import { DEDUP_WINDOW_MS_EXPORT } from './cache';
import type {
  AiActorType,
  AiContext,
  AiErrorCode,
  AiGenerationMeta,
  AiModel,
  AiSkillKey,
} from './types';

/**
 * Persistence helpers for `ai_generations` (Phase 7 / Commit 22).
 *
 * The adapter is the only writer; the dashboard + skill modules
 * are the readers. Writes go through `dbAdmin` (system actor
 * bypasses RLS) because the mock adapter records on behalf of
 * both user and system contexts; reads go through `dbAs` so RLS
 * enforces tenant isolation.
 */

// ---------------------------------------------------------------------------
// Write path
// ---------------------------------------------------------------------------

export interface WriteGenerationInput {
  readonly orgId: string;
  readonly userId: string | null;
  readonly actorType: AiActorType;
  readonly skill: AiSkillKey;
  readonly model: AiModel;
  readonly requestHash: string;
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly outputTokens: number;
  readonly costCents: number;
  readonly durationMs: number;
  readonly cacheHit: boolean;
  readonly entityType: AiContext['entityType'];
  readonly entityId: string | null;
  readonly input: Record<string, unknown>;
  readonly output: Record<string, unknown>;
  readonly errorCode?: AiErrorCode;
  readonly errorMessage?: string;
  /**
   * Causal linkage for the dual-model cascade (Commit 23 /
   * Ajuste 1). NULL on baseline rows; set to the baseline
   * row's id for the second-pass row.
   */
  readonly parentGenerationId?: string | null;
}

export async function writeGeneration(
  data: WriteGenerationInput,
): Promise<{ generationId: string; createdAt: Date }> {
  const rows = await activeDeps.asAdmin<Array<{ id: string; createdAt: Date }>>(
    async (tx) =>
      tx
        .insert(aiGenerations)
        .values({
          organizationId: data.orgId,
          userId: data.userId,
          actorType: data.actorType,
          skill: data.skill,
          model: data.model,
          requestHash: data.requestHash,
          inputTokens: data.inputTokens,
          cachedInputTokens: data.cachedInputTokens,
          outputTokens: data.outputTokens,
          costCents: data.costCents,
          durationMs: data.durationMs,
          cacheHit: data.cacheHit,
          entityType: data.entityType,
          entityId: data.entityId,
          input: data.input,
          output: data.output,
          ...(data.errorCode ? { errorCode: data.errorCode } : {}),
          ...(data.errorMessage ? { errorMessage: data.errorMessage } : {}),
          ...(data.parentGenerationId
            ? { parentGenerationId: data.parentGenerationId }
            : {}),
        })
        .returning({
          id: aiGenerations.id,
          createdAt: aiGenerations.createdAt,
        }),
  );
  const row = rows[0]!;
  return { generationId: row.id, createdAt: row.createdAt };
}

// ---------------------------------------------------------------------------
// Dedup lookup
// ---------------------------------------------------------------------------

/**
 * Cross-process dedup: returns the most recent `ai_generations`
 * row matching `(orgId, requestHash)` within the dedup window,
 * or null when none qualify.
 *
 * The LRU in `cache.ts` is the fast path; this is the fallback
 * when the request lands on a different process / cold start.
 */
export async function findRecentByHash(
  orgId: string,
  requestHash: string,
  windowMs: number = DEDUP_WINDOW_MS_EXPORT,
): Promise<{ output: Record<string, unknown>; meta: AiGenerationMeta } | null> {
  const since = new Date(Date.now() - windowMs);
  // Admin context: dedup lookup is RLS-equivalent (we filter by
  // orgId explicitly) and runs even for the system path which
  // doesn't carry a user session.
  const rows = await activeDeps.asAdmin<
    Array<{
      id: string;
      skill: AiSkillKey;
      model: AiModel;
      output: Record<string, unknown>;
      input: Record<string, unknown>;
      inputTokens: number;
      cachedInputTokens: number;
      outputTokens: number;
      costCents: number;
      durationMs: number;
      parentGenerationId: string | null;
    }>
  >((tx) =>
    tx
      .select({
        id: aiGenerations.id,
        skill: aiGenerations.skill,
        model: aiGenerations.model,
        output: aiGenerations.output,
        input: aiGenerations.input,
        inputTokens: aiGenerations.inputTokens,
        cachedInputTokens: aiGenerations.cachedInputTokens,
        outputTokens: aiGenerations.outputTokens,
        costCents: aiGenerations.costCents,
        durationMs: aiGenerations.durationMs,
        parentGenerationId: aiGenerations.parentGenerationId,
      })
      .from(aiGenerations)
      .where(
        and(
          eq(aiGenerations.organizationId, orgId),
          eq(aiGenerations.requestHash, requestHash),
          gte(aiGenerations.createdAt, since),
        ),
      )
      .orderBy(desc(aiGenerations.createdAt))
      .limit(1),
  );
  const row = rows[0];
  if (!row) return null;

  const promptVersion =
    typeof row.input.promptVersion === 'string'
      ? (row.input.promptVersion as string)
      : 'v1';

  return {
    output: row.output,
    meta: {
      generationId: row.id,
      requestHash,
      skill: row.skill,
      model: row.model as AiModel,
      inputTokens: row.inputTokens,
      cachedInputTokens: row.cachedInputTokens,
      outputTokens: row.outputTokens,
      costCents: 0, // dedup hit doesn't bill again
      durationMs: row.durationMs,
      cacheHit: true,
      via: 'mock',
      promptVersion,
      parentGenerationId: row.parentGenerationId,
    },
  };
}

// ---------------------------------------------------------------------------
// Dashboard reads
// ---------------------------------------------------------------------------

export interface GenerationListItem {
  readonly id: string;
  readonly createdAt: Date;
  readonly skill: AiSkillKey;
  readonly model: AiModel;
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly outputTokens: number;
  readonly costCents: number;
  readonly durationMs: number;
  readonly cacheHit: boolean;
  readonly entityType: string;
  readonly entityId: string | null;
  readonly errorCode: string | null;
  readonly actorType: AiActorType;
  readonly userId: string | null;
  readonly promptVersion: string;
  /** NULL for baseline rows; baseline `id` for cascade rows. */
  readonly parentGenerationId: string | null;
}

/**
 * Cascade filter for /audit/ai (Commit 23 / Ajuste 3).
 *   - `'cascade'`  — only second-pass rows.
 *   - `'baseline'` — only baseline rows.
 *   - `undefined`  — both.
 */
export type CascadeFilter = 'cascade' | 'baseline';

export interface ListGenerationsOpts {
  readonly orgId: string;
  readonly userId: string;
  readonly skill?: AiSkillKey;
  readonly model?: AiModel;
  readonly since?: Date;
  readonly cascade?: CascadeFilter;
  readonly limit?: number;
}

export async function listGenerationsForOrg(
  opts: ListGenerationsOpts,
): Promise<ReadonlyArray<GenerationListItem>> {
  return activeDeps.asUser(
    { orgId: opts.orgId, userId: opts.userId },
    (tx) => listGenerationsForOrgWithTx(tx, opts),
  );
}

export async function listGenerationsForOrgWithTx(
  tx: AnyPgTx,
  opts: ListGenerationsOpts,
): Promise<ReadonlyArray<GenerationListItem>> {
  const conditions: SQL[] = [eq(aiGenerations.organizationId, opts.orgId)];
  if (opts.skill) conditions.push(eq(aiGenerations.skill, opts.skill));
  if (opts.model) conditions.push(eq(aiGenerations.model, opts.model));
  if (opts.since) conditions.push(gte(aiGenerations.createdAt, opts.since));
  if (opts.cascade === 'cascade') {
    conditions.push(isNotNull(aiGenerations.parentGenerationId));
  } else if (opts.cascade === 'baseline') {
    conditions.push(isNull(aiGenerations.parentGenerationId));
  }

  type Row = GenerationListItem & { input: Record<string, unknown> };
  const rows = (await tx
    .select({
      id: aiGenerations.id,
      createdAt: aiGenerations.createdAt,
      skill: aiGenerations.skill,
      model: aiGenerations.model,
      inputTokens: aiGenerations.inputTokens,
      cachedInputTokens: aiGenerations.cachedInputTokens,
      outputTokens: aiGenerations.outputTokens,
      costCents: aiGenerations.costCents,
      durationMs: aiGenerations.durationMs,
      cacheHit: aiGenerations.cacheHit,
      entityType: aiGenerations.entityType,
      entityId: aiGenerations.entityId,
      errorCode: aiGenerations.errorCode,
      actorType: aiGenerations.actorType,
      userId: aiGenerations.userId,
      input: aiGenerations.input,
      parentGenerationId: aiGenerations.parentGenerationId,
    })
    .from(aiGenerations)
    .where(and(...conditions))
    .orderBy(desc(aiGenerations.createdAt))
    .limit(opts.limit ?? 100)) as Row[];

  return rows.map((r): GenerationListItem => {
    const promptVersion =
      typeof r.input?.promptVersion === 'string'
        ? (r.input.promptVersion as string)
        : 'v1';
    return {
      id: r.id,
      createdAt: r.createdAt,
      skill: r.skill,
      model: r.model as AiModel,
      inputTokens: r.inputTokens,
      cachedInputTokens: r.cachedInputTokens,
      outputTokens: r.outputTokens,
      costCents: r.costCents,
      durationMs: r.durationMs,
      cacheHit: r.cacheHit,
      entityType: r.entityType,
      entityId: r.entityId,
      errorCode: r.errorCode,
      actorType: r.actorType,
      userId: r.userId,
      promptVersion,
      parentGenerationId: r.parentGenerationId,
    };
  });
}

// ---------------------------------------------------------------------------
// KPI rollups for /audit/ai
// ---------------------------------------------------------------------------

export interface GenerationKpis {
  readonly costCentsMonth: number;
  readonly generationsMonth: number;
  /** (prompt-cache hits + dedup hits) / total. 0 when no calls. */
  readonly cacheHitRate: number;
  readonly mostUsedModel: AiModel | null;
  /**
   * Commit 23 / Ajuste 3 — fraction of high-risk baselines that
   * triggered the Opus cascade. Formula:
   *
   *   cascadeRate = COUNT(cascade rows in window) /
   *                 COUNT(baseline rows in window where
   *                       output->>'riskLevel' IN ('high', 'critical'))
   *
   * 0 when no high-risk baselines exist. 1.0 in the mock (every
   * high baseline cascades). Real adapter (Phase 11) may drop
   * below 1 if cascade is skipped (rate limit, timeout, etc).
   */
  readonly cascadeRate: number;
}

export async function getGenerationKpis(opts: {
  orgId: string;
  userId: string;
}): Promise<GenerationKpis> {
  return activeDeps.asUser({ orgId: opts.orgId, userId: opts.userId }, (tx) =>
    getGenerationKpisWithTx(tx, opts.orgId),
  );
}

export async function getGenerationKpisWithTx(
  tx: AnyPgTx,
  orgId: string,
): Promise<GenerationKpis> {
  const sinceMonth = new Date();
  sinceMonth.setUTCDate(1);
  sinceMonth.setUTCHours(0, 0, 0, 0);

  type Row = {
    costCents: string | number | null;
    n: string | number | null;
    cachedSum: string | number | null;
    inputSum: string | number | null;
    cacheHits: string | number | null;
  };
  const rows = (await tx
    .select({
      costCents: sql<string | number | null>`COALESCE(SUM(${aiGenerations.costCents}), 0)::int`,
      n: sql<string | number | null>`COUNT(${aiGenerations.id})::int`,
      cachedSum: sql<string | number | null>`COALESCE(SUM(${aiGenerations.cachedInputTokens}), 0)::int`,
      inputSum: sql<string | number | null>`COALESCE(SUM(${aiGenerations.inputTokens}), 0)::int`,
      cacheHits: sql<string | number | null>`COALESCE(SUM(CASE WHEN ${aiGenerations.cacheHit} THEN 1 ELSE 0 END), 0)::int`,
    })
    .from(aiGenerations)
    .where(
      and(
        eq(aiGenerations.organizationId, orgId),
        gte(aiGenerations.createdAt, sinceMonth),
      ),
    )) as Row[];

  const total = toNum(rows[0]?.n) ?? 0;
  const cachedTokens = toNum(rows[0]?.cachedSum) ?? 0;
  const inputTokens = toNum(rows[0]?.inputSum) ?? 0;
  const dedupHits = toNum(rows[0]?.cacheHits) ?? 0;

  // Cache hit rate = (prompt-cache hit ratio + dedup hit ratio) / 2.
  // For dashboard purposes we collapse both into one number — Phase
  // 11 can split them when budget alerts care about the distinction.
  const promptCacheRatio = inputTokens > 0 ? cachedTokens / inputTokens : 0;
  const dedupRatio = total > 0 ? dedupHits / total : 0;
  const cacheHitRate = total > 0 ? (promptCacheRatio + dedupRatio) / 2 : 0;

  type ModelRow = { model: string; n: string | number };
  const modelRows = (await tx
    .select({
      model: aiGenerations.model,
      n: sql<string | number>`COUNT(${aiGenerations.id})::int`,
    })
    .from(aiGenerations)
    .where(
      and(
        eq(aiGenerations.organizationId, orgId),
        gte(aiGenerations.createdAt, sinceMonth),
      ),
    )
    .groupBy(aiGenerations.model)
    .orderBy(desc(sql`COUNT(${aiGenerations.id})`))
    .limit(1)) as ModelRow[];

  // Cascade-rate query (Commit 23 / Ajuste 3): fraction of
  // high-risk baselines that triggered the Opus cascade.
  type CascadeRow = {
    eligibleBaselines: string | number | null;
    cascades: string | number | null;
  };
  const cascadeRows = (await tx
    .select({
      eligibleBaselines: sql<string | number | null>`
        COALESCE(SUM(CASE
          WHEN ${aiGenerations.parentGenerationId} IS NULL
           AND ${aiGenerations.skill} = 'compliance'
           AND (${aiGenerations.output} ->> 'riskLevel') IN ('high', 'critical')
          THEN 1 ELSE 0 END), 0)::int
      `,
      cascades: sql<string | number | null>`
        COALESCE(SUM(CASE
          WHEN ${aiGenerations.parentGenerationId} IS NOT NULL
          THEN 1 ELSE 0 END), 0)::int
      `,
    })
    .from(aiGenerations)
    .where(
      and(
        eq(aiGenerations.organizationId, orgId),
        gte(aiGenerations.createdAt, sinceMonth),
      ),
    )) as CascadeRow[];
  const eligible = toNum(cascadeRows[0]?.eligibleBaselines) ?? 0;
  const cascades = toNum(cascadeRows[0]?.cascades) ?? 0;
  const cascadeRate = eligible > 0 ? cascades / eligible : 0;

  return {
    costCentsMonth: toNum(rows[0]?.costCents) ?? 0,
    generationsMonth: total,
    cacheHitRate,
    mostUsedModel: (modelRows[0]?.model as AiModel | undefined) ?? null,
    cascadeRate,
  };
}

function toNum(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
