import 'server-only';

import { and, eq, inArray, lte, ne, or, sql } from 'drizzle-orm';

import { dbAdmin, dbAs } from '@/lib/db/client';
import {
  auditEvents,
  postTargets,
  posts,
} from '@/lib/db/schema';
import { log } from '@/lib/log';
import { canTransition, type PostStatus } from '@/lib/publish/status-transitions';
import { incrementUsage } from '@/lib/usage/counters';
import { err, ok, type Result } from '@/lib/types/result';

import {
  dispatchOneTarget,
  MAX_RETRY_COUNT,
  type DispatchOneTargetDeps,
} from './publish-target';

/**
 * Publish-job tick (Commit 20a).
 *
 * Two selectors fire per tick (separate queries — each returns
 * the small slice the cron actually touches):
 *
 *   1. **Set A — scheduled posts due:** `status='scheduled'`
 *      AND `scheduled_at <= now`. First-time dispatch path.
 *
 *   2. **Set B — retry-pending publishing posts:**
 *      `status='publishing'` AND has any target in
 *      `(status='failed' AND retry_count < 3 AND next_retry_at <= now)`.
 *      Continuation path for posts where the first dispatch left
 *      one or more transient failures.
 *
 * Per post, we:
 *
 *   - SELECT FOR UPDATE the post row.
 *   - If Set A: transition `scheduled → publishing` + audit
 *     `post.publishing.started`.
 *   - Identify "actionable" targets: `pending` OR `failed AND
 *     retry_count < 3 AND next_retry_at <= now`.
 *   - Dispatch each via `dispatchOneTarget`. Failures don't crash
 *     the loop — the per-target audit + bookkeeping captures
 *     them.
 *   - Re-read the target set after the dispatch loop and compute
 *     the terminal post status:
 *       - all `published`             → `post.status='published'`,
 *                                       audit `post.published`,
 *                                       counter `postsPerMonth++`.
 *       - all `failed` permanently    → `post.status='failed'`,
 *                                       audit `post.failed`.
 *       - mix `published` + permanent → `post.status='published'`,
 *                                       audit `post.published.partial`,
 *                                       counter `postsPerMonth++`
 *                                       (partial counts as 1 post).
 *       - any still-in-flight target  → keep `publishing`.
 *
 * Logging: structured per tick. When `candidatesFound === 0`,
 * the log fires only every 10th tick to avoid spamming the dev
 * console. Errors are caught + logged + swallowed so the next
 * tick can still run.
 */

const QUIET_LOG_EVERY_N_EMPTY_TICKS = 10;
let emptyTickCount = 0;

export interface PublishTickDeps extends DispatchOneTargetDeps {
  /**
   * `dispatchOneTarget` is the per-target worker. DI allows the
   * test to wrap it with a spy that observes call counts +
   * arguments without exercising the connector layer twice.
   */
  dispatchTarget: typeof dispatchOneTarget;
}

const defaultDeps: PublishTickDeps = {
  asUser: (ctx, fn) => dbAs(ctx, fn),
  asAdmin: (fn) => dbAdmin(fn),
  now: () => new Date(),
  dispatchTarget: dispatchOneTarget,
};

export interface PublishTickReport {
  readonly candidatesFound: number;
  readonly targetsProcessed: number;
  readonly publishedSuccess: number;
  readonly failedTransient: number;
  readonly failedPermanent: number;
  readonly skipped: number;
  readonly durationMs: number;
}

interface PostCandidate {
  readonly postId: string;
  readonly orgId: string;
  readonly source: 'scheduled' | 'publishing_retry';
}

export async function runPublishTick(
  deps: PublishTickDeps = defaultDeps,
): Promise<Result<PublishTickReport>> {
  const startMs = deps.now().getTime();
  const candidates = await findCandidates(deps);
  if (candidates.length === 0) {
    emptyTickCount += 1;
    if (emptyTickCount % QUIET_LOG_EVERY_N_EMPTY_TICKS === 0) {
      log.info(
        { tick: 'publish', candidatesFound: 0, emptyTicks: emptyTickCount },
        'publish tick — quiet',
      );
    }
    return ok({
      candidatesFound: 0,
      targetsProcessed: 0,
      publishedSuccess: 0,
      failedTransient: 0,
      failedPermanent: 0,
      skipped: 0,
      durationMs: deps.now().getTime() - startMs,
    });
  }
  emptyTickCount = 0;

  let targetsProcessed = 0;
  let publishedSuccess = 0;
  let failedTransient = 0;
  let failedPermanent = 0;
  let skipped = 0;

  for (const candidate of candidates) {
    try {
      const result = await processOneCandidate(candidate, deps);
      if (!result.ok) continue;
      targetsProcessed += result.data.targetsProcessed;
      publishedSuccess += result.data.publishedSuccess;
      failedTransient += result.data.failedTransient;
      failedPermanent += result.data.failedPermanent;
      skipped += result.data.skipped;
    } catch (e) {
      log.error(
        {
          err: (e as Error).message,
          stack: (e as Error).stack,
          postId: candidate.postId,
        },
        'publish.tick.candidate_failed',
      );
      // Continue to next candidate — one bad row mustn't stop
      // the entire tick.
    }
  }

  const report: PublishTickReport = {
    candidatesFound: candidates.length,
    targetsProcessed,
    publishedSuccess,
    failedTransient,
    failedPermanent,
    skipped,
    durationMs: deps.now().getTime() - startMs,
  };
  log.info({ tick: 'publish', ...report }, 'publish tick completed');
  return ok(report);
}

// ---------------------------------------------------------------------------
// Candidate selection
// ---------------------------------------------------------------------------

const SYSTEM_USER_ID = '00000000-0000-4000-8000-000000000001';

/** Set A + Set B in two queries. The cron runs as the service role. */
async function findCandidates(deps: PublishTickDeps): Promise<PostCandidate[]> {
  const now = deps.now();
  type Row = { postId: string; orgId: string };

  // Set A: scheduled posts due.
  const setA = await deps.asAdmin<Row[]>((tx) =>
    tx
      .select({ postId: posts.id, orgId: posts.organizationId })
      .from(posts)
      .where(and(eq(posts.status, 'scheduled'), lte(posts.scheduledAt, now)))
      .limit(50),
  );

  // Set B: publishing posts with actionable targets. Two cases:
  //
  //   (a) `target.status='pending'` — used by the post-approval
  //       sync dispatch path (Commit 20b). When an approver clicks
  //       "Approve" with no scheduled_at, the dispatcher transitions
  //       the post `pending_approval → publishing`. Targets stay
  //       'pending'. Set B picks them up on the next tick (or the
  //       sync `runPublishTick()` call from `approveAction`).
  //
  //   (b) `target.status='failed' AND retry_count<MAX AND next_retry_at<=now`
  //       — the original retry-due path from Commit 20a.
  //
  // Single distinct-by-post join into post_targets covers both.
  const setB = await deps.asAdmin<Row[]>((tx) =>
    tx
      .selectDistinct({ postId: posts.id, orgId: posts.organizationId })
      .from(posts)
      .innerJoin(postTargets, eq(postTargets.postId, posts.id))
      .where(
        and(
          eq(posts.status, 'publishing'),
          or(
            eq(postTargets.status, 'pending'),
            and(
              eq(postTargets.status, 'failed'),
              sql`${postTargets.retryCount} < ${MAX_RETRY_COUNT}`,
              lte(postTargets.nextRetryAt, now),
            ),
          ),
        ),
      )
      .limit(50),
  );

  const seen = new Set<string>();
  const out: PostCandidate[] = [];
  for (const r of setA) {
    if (seen.has(r.postId)) continue;
    seen.add(r.postId);
    out.push({ postId: r.postId, orgId: r.orgId, source: 'scheduled' });
  }
  for (const r of setB) {
    if (seen.has(r.postId)) continue;
    seen.add(r.postId);
    out.push({ postId: r.postId, orgId: r.orgId, source: 'publishing_retry' });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Per-candidate orchestration
// ---------------------------------------------------------------------------

interface CandidateReport {
  targetsProcessed: number;
  publishedSuccess: number;
  failedTransient: number;
  failedPermanent: number;
  skipped: number;
}

async function processOneCandidate(
  candidate: PostCandidate,
  deps: PublishTickDeps,
): Promise<Result<CandidateReport>> {
  const ctx = { orgId: candidate.orgId, userId: SYSTEM_USER_ID };
  const now = deps.now();

  // 1. Lock the post + verify status.
  type PostLockRow = {
    id: string;
    status: 'scheduled' | 'publishing' | 'published' | 'failed' | 'draft' | 'cancelled' | 'pending_approval';
  };
  const lockedRows = await deps.asAdmin<PostLockRow[]>((tx) =>
    tx
      .select({ id: posts.id, status: posts.status })
      .from(posts)
      .where(eq(posts.id, candidate.postId))
      .for('update')
      .limit(1),
  );
  const post = lockedRows[0];
  if (!post) return err('NOT_FOUND', 'Post no encontrado.');

  // Set A path: must still be 'scheduled' — another tick may
  // have grabbed it. Silently skip if not.
  if (candidate.source === 'scheduled' && post.status !== 'scheduled') {
    return ok(emptyReport());
  }
  // Set B path: must be 'publishing'. Silently skip otherwise.
  if (candidate.source === 'publishing_retry' && post.status !== 'publishing') {
    return ok(emptyReport());
  }

  // 2. Transition scheduled → publishing for the Set A path.
  //    System-actor: bypass RLS via asAdmin.
  if (candidate.source === 'scheduled') {
    if (!canTransition('scheduled', 'publishing')) {
      return err('VALIDATION_ERROR', 'Transición scheduled → publishing no permitida.');
    }
    await deps.asAdmin((tx) =>
      tx
        .update(posts)
        .set({ status: 'publishing' })
        .where(eq(posts.id, candidate.postId)),
    );
    await writeAudit(deps, {
      orgId: candidate.orgId,
      userId: SYSTEM_USER_ID,
      action: 'post.publishing.started',
      entityType: 'post',
      entityId: candidate.postId,
      before: { status: 'scheduled' },
      after: { status: 'publishing' },
    });
  }
  // Silence ctx in this scope — kept for symmetry with audit calls below.
  void ctx;

  // 3. Find actionable targets: pending OR retry-due-failed.
  type TargetSummaryRow = {
    id: string;
    status: 'pending' | 'publishing' | 'published' | 'failed';
    retryCount: number;
    nextRetryAt: Date | null;
  };
  const targets = await deps.asAdmin<TargetSummaryRow[]>((tx) =>
    tx
      .select({
        id: postTargets.id,
        status: postTargets.status,
        retryCount: postTargets.retryCount,
        nextRetryAt: postTargets.nextRetryAt,
      })
      .from(postTargets)
      .where(eq(postTargets.postId, candidate.postId)),
  );
  const actionable = targets.filter((t) => {
    if (t.status === 'pending') return true;
    if (
      t.status === 'failed' &&
      t.retryCount < MAX_RETRY_COUNT &&
      t.nextRetryAt !== null &&
      t.nextRetryAt.getTime() <= now.getTime()
    ) {
      return true;
    }
    return false;
  });

  const report: CandidateReport = emptyReport();
  for (const target of actionable) {
    report.targetsProcessed += 1;
    const dispatch = await deps.dispatchTarget(
      {
        orgId: candidate.orgId,
        userId: SYSTEM_USER_ID,
        actorType: 'system',
        targetId: target.id,
      },
      {
        asUser: deps.asUser,
        asAdmin: deps.asAdmin,
        now: deps.now,
      },
    );
    if (!dispatch.ok) {
      report.skipped += 1;
      continue;
    }
    switch (dispatch.data.kind) {
      case 'published':
        report.publishedSuccess += 1;
        break;
      case 'failed_transient':
        report.failedTransient += 1;
        break;
      case 'failed_permanent':
        report.failedPermanent += 1;
        break;
      case 'skipped':
        report.skipped += 1;
        break;
    }
  }

  // 4. Compute terminal post status from the now-updated targets.
  const finalTargets = await deps.asAdmin<TargetSummaryRow[]>((tx) =>
    tx
      .select({
        id: postTargets.id,
        status: postTargets.status,
        retryCount: postTargets.retryCount,
        nextRetryAt: postTargets.nextRetryAt,
      })
      .from(postTargets)
      .where(eq(postTargets.postId, candidate.postId)),
  );
  await applyTerminalStatus(candidate, finalTargets, deps);

  return ok(report);
}

async function applyTerminalStatus(
  candidate: PostCandidate,
  targets: ReadonlyArray<{
    status: 'pending' | 'publishing' | 'published' | 'failed';
    retryCount: number;
  }>,
  deps: PublishTickDeps,
): Promise<void> {
  if (targets.length === 0) return; // Defensive.

  let publishedCount = 0;
  let permanentFailedCount = 0;
  let inFlight = 0;
  for (const t of targets) {
    if (t.status === 'published') publishedCount += 1;
    else if (t.status === 'failed' && t.retryCount >= MAX_RETRY_COUNT) {
      permanentFailedCount += 1;
    } else {
      inFlight += 1;
    }
  }

  // Still working — keep status='publishing', next tick continues.
  if (inFlight > 0) return;

  const setTerminalStatus = async (to: PostStatus): Promise<void> => {
    await deps.asAdmin((tx) =>
      tx
        .update(posts)
        .set({ status: to, publishedAt: to === 'published' ? deps.now() : null })
        .where(eq(posts.id, candidate.postId)),
    );
  };

  if (publishedCount === targets.length) {
    await setTerminalStatus('published');
    await writeAudit(deps, {
      orgId: candidate.orgId,
      userId: SYSTEM_USER_ID,
      action: 'post.published',
      entityType: 'post',
      entityId: candidate.postId,
      after: { targetCount: targets.length, allOk: true },
    });
    await bumpPostsPerMonth(candidate, deps);
    return;
  }

  if (publishedCount === 0 && permanentFailedCount === targets.length) {
    await setTerminalStatus('failed');
    await writeAudit(deps, {
      orgId: candidate.orgId,
      userId: SYSTEM_USER_ID,
      action: 'post.failed',
      entityType: 'post',
      entityId: candidate.postId,
      after: { targetCount: targets.length, permanentFailedCount },
      riskLevel: 'medium',
    });
    return;
  }

  // Mix: at least one published + some permanently failed.
  await setTerminalStatus('published');
  await writeAudit(deps, {
    orgId: candidate.orgId,
    userId: SYSTEM_USER_ID,
    action: 'post.published.partial',
    entityType: 'post',
    entityId: candidate.postId,
    after: {
      targetCount: targets.length,
      publishedCount,
      permanentFailedCount,
    },
    riskLevel: 'low',
  });
  await bumpPostsPerMonth(candidate, deps);
}

/**
 * Increment `postsPerMonth` once when the post first reaches a
 * terminal published state (all OK or partial). The counter
 * captures "intent fulfilled" — partial publication still
 * consumed a budget seat because the user intended to publish.
 */
async function bumpPostsPerMonth(
  candidate: PostCandidate,
  deps: PublishTickDeps,
): Promise<void> {
  try {
    await deps.asAdmin((tx) =>
      incrementUsage(tx, candidate.orgId, 'postsPerMonth', 1),
    );
  } catch (cause) {
    log.error(
      { cause, postId: candidate.postId, orgId: candidate.orgId },
      'publish.tick.postsPerMonth.bump_failed',
    );
  }
}

// ---------------------------------------------------------------------------
// Audit helper
// ---------------------------------------------------------------------------

interface AuditInput {
  orgId: string;
  userId: string;
  action: string;
  entityType: 'post' | 'post_target';
  entityId: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  riskLevel?: 'low' | 'medium' | 'high' | 'critical';
}

async function writeAudit(deps: PublishTickDeps, input: AuditInput): Promise<void> {
  try {
    await deps.asAdmin(async (tx) =>
      tx.insert(auditEvents).values({
        organizationId: input.orgId,
        // System actor: `user_id` is null because the cron isn't a
        // real user. The audit_events.user_id FK is `ON DELETE SET
        // NULL`, so NULL here matches the no-user semantic.
        userId: null,
        actorType: 'system',
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        ...(input.before !== undefined ? { before: input.before } : {}),
        ...(input.after !== undefined ? { after: input.after } : {}),
        riskLevel: input.riskLevel ?? 'low',
      }),
    );
  } catch (cause) {
    log.error(
      { cause, action: input.action, entityId: input.entityId },
      'publish.tick.audit.failed',
    );
  }
}

function emptyReport(): CandidateReport {
  return {
    targetsProcessed: 0,
    publishedSuccess: 0,
    failedTransient: 0,
    failedPermanent: 0,
    skipped: 0,
  };
}

// Touch unused drizzle imports so a refactor that drops them
// surfaces here rather than as a silent broken contract.
void inArray;
void ne;
