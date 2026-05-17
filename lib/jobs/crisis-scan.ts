import 'server-only';

import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';

import { dbAdmin, dbAs, type AnyPgTx } from '@/lib/db/client';
import {
  aiRecommendations,
  auditEvents,
  brands,
  organizations,
  reviews,
} from '@/lib/db/schema';
import { log } from '@/lib/log';
import { detectCrisis } from '@/lib/ai/skills/crisis';
import type {
  CrisisMockInputMessage,
  CrisisMockInputReview,
  CrisisMockOutput,
} from '@/lib/ai/mock-bodies/crisis';
import { ok, type Result } from '@/lib/types/result';

/**
 * Crisis-scan producer (Phase 7 / Commit 25).
 *
 * For each org, reads the last 24h of reviews + inbox messages,
 * asks `detectCrisis` (Opus, ai_generations row written), and
 * persists the verdict to `ai_recommendations` when a pattern
 * fires. The dashboard banner + history page (`/reputation/...`)
 * consume from `ai_recommendations` — never directly from this
 * producer.
 *
 * # Merge logic (D-25-3 refined)
 *
 * To avoid spamming managers with duplicate alerts while still
 * catching escalations, the producer reuses an existing
 * `'pending'` rec when the new evidence overlaps materially:
 *
 *     newIds      = scanEvidence.ids \ existing.evidence.ids
 *     growthRate  = newIds.length / existing.evidence.ids.length
 *
 *     if growthRate >= 0.30   → ESCALATE (UPDATE existing row)
 *     if growthRate <  0.30   → SKIP    (no write, audit only)
 *     if no existing rec      → INSERT new row
 *
 * **Numerical examples (Ajuste-doc'd)**:
 *
 *   - existing=5 ids,  new detects 6 (5 old + 1 new) → growth=0.20 → SKIP
 *   - existing=5 ids,  new detects 8 (4 old + 4 new) → growth=0.80 → ESCALATE
 *   - existing=10 ids, new detects 12 (10 old + 2 new) → growth=0.20 → SKIP
 *   - existing=10 ids, new detects 14 (10 old + 4 new) → growth=0.40 → ESCALATE
 *
 * **Edge cases**:
 *
 *   - **existing has 0 ids** (defensive — shouldn't happen but
 *     the producer guards against it). Any non-empty new set
 *     counts as 100% growth → ESCALATE.
 *   - **new set is entirely different from existing** (e.g.
 *     different customers, different complaint pattern). All
 *     of new counts as "new ids", growthRate = newIds/existing.
 *     Typically ≥1.0 → ESCALATE. Correct outcome: same rec
 *     row tracks the broader crisis surface.
 *   - **new set is a strict subset of existing** (scan window
 *     drifted but data overlaps). newIds.length = 0 →
 *     growth=0 → SKIP. Correct: nothing new to surface.
 *
 * # Severity escalation (Ajuste 1)
 *
 * When the merge takes the ESCALATE branch, severity may bump:
 *
 *   existing='medium' + merged total > 10 ids → 'high'
 *   existing='high'   + merged total > 20 ids → 'critical'
 *
 * The update emits `ai_recommendation.crisis.severity_escalated`
 * with `before`/`after` metadata so the audit shows the bump
 * separately from the evidence growth.
 *
 * # Window
 *
 * Per-scan window: last 24h. Existing-rec lookup window: last
 * 7d (D-25-3). Cron tick interval: 60min (D-25-1).
 */

const SCAN_WINDOW_MS = 24 * 60 * 60_000;
const EXISTING_LOOKBACK_MS = 7 * 24 * 60 * 60_000;
const GROWTH_THRESHOLD = 0.30;

const SEVERITY_HIGH_MIN_IDS = 10;
const SEVERITY_CRITICAL_MIN_IDS = 20;

export interface CrisisScanDeps {
  asUser: <T>(
    ctx: { orgId: string; userId: string },
    fn: (tx: AnyPgTx) => Promise<T>,
  ) => Promise<T>;
  asAdmin: <T>(fn: (tx: AnyPgTx) => Promise<T>) => Promise<T>;
  now: () => Date;
}

const defaultDeps: CrisisScanDeps = {
  asUser: (ctx, fn) => dbAs(ctx, fn),
  asAdmin: (fn) => dbAdmin(fn),
  now: () => new Date(),
};

/**
 * System-actor user id used by all cron-driven AI scans. Matches
 * the publish-job pattern. `audit_events.user_id` is `ON DELETE
 * SET NULL` so we record `null` for system; this constant exists
 * for code clarity, not for FK use.
 */
const SYSTEM_USER_ID = '00000000-0000-4000-8000-000000000001';

export interface CrisisScanReport {
  readonly orgsScanned: number;
  readonly crisesCreated: number;
  readonly crisesEscalated: number;
  readonly skippedDuplicates: number;
  readonly cleanScans: number;
  readonly durationMs: number;
}

export interface ScanCrisisOpts {
  readonly orgId: string;
  /** Optional brand scope. NULL = org-wide scan. */
  readonly brandId?: string | null;
  readonly brandName?: string;
}

interface ExistingPendingRec {
  readonly id: string;
  readonly severity: 'low' | 'medium' | 'high' | 'critical';
  readonly evidence: { reviewIds: string[]; messageIds: string[] };
}

// ---------------------------------------------------------------------------
// Top-level multi-org tick
// ---------------------------------------------------------------------------

export async function runCrisisScanTick(
  deps: CrisisScanDeps = defaultDeps,
): Promise<Result<CrisisScanReport>> {
  const startMs = deps.now().getTime();
  type OrgRow = { id: string };
  const orgs = await deps.asAdmin<OrgRow[]>((tx) =>
    tx.select({ id: organizations.id }).from(organizations).limit(500),
  );

  let crisesCreated = 0;
  let crisesEscalated = 0;
  let skippedDuplicates = 0;
  let cleanScans = 0;

  for (const o of orgs) {
    try {
      const result = await scanForCrisis({ orgId: o.id }, deps);
      if (!result.ok) continue;
      switch (result.data.outcome) {
        case 'created':
          crisesCreated += 1;
          break;
        case 'escalated':
          crisesEscalated += 1;
          break;
        case 'skipped_duplicate':
          skippedDuplicates += 1;
          break;
        case 'no_crisis':
          cleanScans += 1;
          break;
      }
    } catch (e) {
      log.error(
        { err: (e as Error).message, orgId: o.id },
        'crisis.scan.org_failed',
      );
    }
  }

  const report: CrisisScanReport = {
    orgsScanned: orgs.length,
    crisesCreated,
    crisesEscalated,
    skippedDuplicates,
    cleanScans,
    durationMs: deps.now().getTime() - startMs,
  };
  log.info({ tick: 'crisis', ...report }, 'crisis tick completed');
  return ok(report);
}

// ---------------------------------------------------------------------------
// Per-org / per-brand scan
// ---------------------------------------------------------------------------

export type ScanOutcome =
  | 'no_crisis'
  | 'created'
  | 'escalated'
  | 'skipped_duplicate';

export interface ScanCrisisSuccess {
  readonly outcome: ScanOutcome;
  readonly recommendationId: string | null;
  readonly verdict: CrisisMockOutput;
}

export async function scanForCrisis(
  opts: ScanCrisisOpts,
  deps: CrisisScanDeps = defaultDeps,
): Promise<Result<ScanCrisisSuccess>> {
  const now = deps.now();
  const windowStart = new Date(now.getTime() - SCAN_WINDOW_MS);

  // 1. Load brand name (if scoped) for the prompt context.
  let brandName = opts.brandName ?? 'la organización';
  if (opts.brandId && !opts.brandName) {
    const brandRows = await deps.asAdmin<Array<{ name: string }>>((tx) =>
      tx
        .select({ name: brands.name })
        .from(brands)
        .where(eq(brands.id, opts.brandId!))
        .limit(1),
    );
    if (brandRows[0]) brandName = brandRows[0].name;
  }

  // 2. Pull the 24h windows for reviews + inbox messages.
  type ReviewRow = { id: string; rating: number; createdAt: Date };
  const reviewRows = await deps.asAdmin<ReviewRow[]>((tx) =>
    tx
      .select({
        id: reviews.id,
        rating: reviews.rating,
        createdAt: reviews.createdAt,
      })
      .from(reviews)
      .where(
        and(
          eq(reviews.organizationId, opts.orgId),
          gte(reviews.createdAt, windowStart),
          ...(opts.brandId ? [eq(reviews.brandId, opts.brandId)] : []),
        ),
      )
      .limit(500),
  );

  // Commit 25 scope — reviews-only crisis detection. The
  // `inbox_messages` table doesn't carry a per-message sentiment
  // column today; running sentiment classification per message
  // in this loop would add ~N Haiku calls per scan. The trigger
  // rules in `detectCrisis` already weight low-rating reviews
  // much more than negative messages, so reviews alone provide
  // signal for the v1 producer.
  //
  // Phase 9 TODO `crisis-include-inbox-sentiment` adds the
  // batch-sentiment pass on inbound messages so they enter the
  // window properly.
  const messageRows: Array<{ id: string; sentAt: Date }> = [];

  // 3. Run the AI verdict.
  const scanReviews: CrisisMockInputReview[] = reviewRows.map((r) => ({
    id: r.id,
    rating: r.rating,
    createdAtIso: r.createdAt.toISOString(),
  }));
  // messageRows is always empty in Commit 25 (see note above).
  // The shape is preserved for the Phase-9 expansion.
  const scanMessages: CrisisMockInputMessage[] = messageRows.map((m) => ({
    id: m.id,
    sentiment: 'neutral',
    createdAtIso: m.sentAt.toISOString(),
  }));

  const verdict = await detectCrisis({
    input: {
      brandName,
      windowStartIso: windowStart.toISOString(),
      windowEndIso: now.toISOString(),
      reviews: scanReviews,
      messages: scanMessages,
    },
    context: {
      orgId: opts.orgId,
      userId: null,
      actorType: 'system',
      entityType: 'org',
      entityId: null,
      brandId: opts.brandId ?? null,
    },
  });

  if (!verdict.crisis) {
    return ok({ outcome: 'no_crisis', recommendationId: null, verdict });
  }

  // 4. Merge logic — look for an existing pending rec within the
  //    7d lookback window for the same org + brand scope.
  const existing = await findExistingPending(deps, opts.orgId, opts.brandId ?? null);

  if (!existing) {
    const created = await insertNewCrisisRec(
      deps,
      opts.orgId,
      opts.brandId ?? null,
      verdict,
    );
    return ok({ outcome: 'created', recommendationId: created.id, verdict });
  }

  // Compute growth rate per the D-25-3 refined algorithm.
  const existingIds = new Set([
    ...existing.evidence.reviewIds,
    ...existing.evidence.messageIds,
  ]);
  const newCombined = [
    ...verdict.evidence.reviewIds,
    ...verdict.evidence.messageIds,
  ];
  const newIds = newCombined.filter((id) => !existingIds.has(id));
  // Edge case: existing has 0 ids. Treat any new ids as 100%
  // growth so the rec escalates. Defensive — a rec with 0
  // evidence shouldn't exist in healthy data.
  const growthRate =
    existingIds.size === 0
      ? newIds.length > 0
        ? 1
        : 0
      : newIds.length / existingIds.size;

  if (growthRate < GROWTH_THRESHOLD) {
    await writeSystemAudit(deps, opts.orgId, {
      action: 'ai_recommendation.crisis.skipped_duplicate',
      entityId: existing.id,
      after: {
        growthRate,
        threshold: GROWTH_THRESHOLD,
        existingIds: existingIds.size,
        newIds: newIds.length,
      },
    });
    return ok({
      outcome: 'skipped_duplicate',
      recommendationId: existing.id,
      verdict,
    });
  }

  // Escalate — merge evidence + maybe bump severity.
  const mergedReviewIds = unique([
    ...existing.evidence.reviewIds,
    ...verdict.evidence.reviewIds,
  ]);
  const mergedMessageIds = unique([
    ...existing.evidence.messageIds,
    ...verdict.evidence.messageIds,
  ]);
  const mergedTotal = mergedReviewIds.length + mergedMessageIds.length;

  // Severity escalation (Ajuste 1).
  let nextSeverity = existing.severity;
  if (existing.severity === 'medium' && mergedTotal > SEVERITY_HIGH_MIN_IDS) {
    nextSeverity = 'high';
  }
  if (
    (existing.severity === 'high' || nextSeverity === 'high') &&
    mergedTotal > SEVERITY_CRITICAL_MIN_IDS
  ) {
    nextSeverity = 'critical';
  }
  // verdict.severity may also bump us (the AI says we're now
  // critical even with the same merged count) — honor whichever
  // is higher.
  nextSeverity = pickHigherSeverity(nextSeverity, verdict.severity);

  await deps.asAdmin((tx) =>
    tx
      .update(aiRecommendations)
      .set({
        evidence: {
          reviewIds: mergedReviewIds,
          messageIds: mergedMessageIds,
        },
        body: verdict.summary,
        title: verdict.title || `Crisis pattern · ${brandName}`,
        // Map severity to the rec category-agnostic shape — we
        // store severity inside `evidence.severity` since the
        // table has no dedicated column. Phase 11 may promote
        // severity to a column if dashboards need to filter.
      })
      .where(eq(aiRecommendations.id, existing.id)),
  );
  // Severity lives in evidence.severity (jsonb) — patch separately
  // so we don't clobber the merged ids.
  await deps.asAdmin((tx) =>
    tx
      .update(aiRecommendations)
      .set({
        evidence: sql`jsonb_set(${aiRecommendations.evidence}, '{severity}', ${JSON.stringify(nextSeverity)}::jsonb)`,
      })
      .where(eq(aiRecommendations.id, existing.id)),
  );

  await writeSystemAudit(deps, opts.orgId, {
    action: 'ai_recommendation.crisis.escalated',
    entityId: existing.id,
    before: {
      severity: existing.severity,
      reviewIds: existing.evidence.reviewIds.length,
      messageIds: existing.evidence.messageIds.length,
    },
    after: {
      severity: nextSeverity,
      reviewIds: mergedReviewIds.length,
      messageIds: mergedMessageIds.length,
      growthRate,
    },
  });

  if (nextSeverity !== existing.severity) {
    await writeSystemAudit(deps, opts.orgId, {
      action: 'ai_recommendation.crisis.severity_escalated',
      entityId: existing.id,
      before: { severity: existing.severity },
      after: { severity: nextSeverity, mergedIdsTotal: mergedTotal },
    });
  }

  return ok({
    outcome: 'escalated',
    recommendationId: existing.id,
    verdict,
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function unique(arr: string[]): string[] {
  return Array.from(new Set(arr));
}

const SEVERITY_RANK: Readonly<Record<'low' | 'medium' | 'high' | 'critical', number>> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

function pickHigherSeverity(
  a: 'low' | 'medium' | 'high' | 'critical',
  b: 'low' | 'medium' | 'high' | 'critical',
): 'low' | 'medium' | 'high' | 'critical' {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

async function findExistingPending(
  deps: CrisisScanDeps,
  orgId: string,
  brandId: string | null,
): Promise<ExistingPendingRec | null> {
  const since = new Date(deps.now().getTime() - EXISTING_LOOKBACK_MS);
  type Row = {
    id: string;
    evidence: unknown;
  };
  const rows = await deps.asAdmin<Row[]>((tx) =>
    tx
      .select({
        id: aiRecommendations.id,
        evidence: aiRecommendations.evidence,
      })
      .from(aiRecommendations)
      .where(
        and(
          eq(aiRecommendations.organizationId, orgId),
          eq(aiRecommendations.category, 'crisis'),
          eq(aiRecommendations.status, 'pending'),
          ...(brandId === null
            ? []
            : [eq(aiRecommendations.brandId, brandId)]),
          gte(aiRecommendations.createdAt, since),
        ),
      )
      .orderBy(desc(aiRecommendations.createdAt))
      .limit(1),
  );

  const row = rows[0];
  if (!row) return null;

  const ev = row.evidence as Record<string, unknown> | null;
  const reviewIds = Array.isArray(ev?.reviewIds)
    ? (ev.reviewIds as unknown[]).filter((v): v is string => typeof v === 'string')
    : [];
  const messageIds = Array.isArray(ev?.messageIds)
    ? (ev.messageIds as unknown[]).filter((v): v is string => typeof v === 'string')
    : [];
  const severity =
    typeof ev?.severity === 'string'
      ? (ev.severity as 'low' | 'medium' | 'high' | 'critical')
      : 'medium';
  return { id: row.id, severity, evidence: { reviewIds, messageIds } };
}

async function insertNewCrisisRec(
  deps: CrisisScanDeps,
  orgId: string,
  brandId: string | null,
  verdict: CrisisMockOutput,
): Promise<{ id: string }> {
  const inserted = await deps.asAdmin<Array<{ id: string }>>((tx) =>
    tx
      .insert(aiRecommendations)
      .values({
        organizationId: orgId,
        ...(brandId ? { brandId } : {}),
        category: 'crisis',
        title: verdict.title || 'Crisis pattern',
        body: verdict.summary,
        status: 'pending',
        evidence: {
          reviewIds: verdict.evidence.reviewIds,
          messageIds: verdict.evidence.messageIds,
          severity: verdict.severity,
          recommendedAction: verdict.recommendedAction,
        },
      })
      .returning({ id: aiRecommendations.id }),
  );
  const id = inserted[0]!.id;
  await writeSystemAudit(deps, orgId, {
    action: 'ai_recommendation.crisis.created',
    entityId: id,
    after: {
      severity: verdict.severity,
      reviewIds: verdict.evidence.reviewIds.length,
      messageIds: verdict.evidence.messageIds.length,
    },
  });
  return { id };
}

interface AuditInput {
  action: string;
  entityId: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

async function writeSystemAudit(
  deps: CrisisScanDeps,
  orgId: string,
  input: AuditInput,
): Promise<void> {
  try {
    await deps.asAdmin((tx) =>
      tx.insert(auditEvents).values({
        organizationId: orgId,
        userId: null,
        actorType: 'system',
        action: input.action,
        entityType: 'ai_recommendation',
        entityId: input.entityId,
        ...(input.before ? { before: input.before } : {}),
        ...(input.after ? { after: input.after } : {}),
        riskLevel: 'low',
      }),
    );
  } catch (cause) {
    log.error(
      { cause, action: input.action, entityId: input.entityId },
      'crisis.scan.audit.failed',
    );
  }
}

// Touch unused imports to keep them live for downstream extensions.
void inArray;
void SYSTEM_USER_ID;
