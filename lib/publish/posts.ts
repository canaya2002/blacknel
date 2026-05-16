import 'server-only';

import { and, eq, inArray } from 'drizzle-orm';

import { type AnyPgTx, dbAdmin, dbAs } from '../db/client';
import {
  auditEvents,
  connectedAccounts,
  postTargets,
  posts,
} from '../db/schema';
import { AppError } from '../errors';
import { err, ok, type Result } from '../types/result';

import { canTransition, isTerminal, type PostStatus } from './status-transitions';

/**
 * Phase-6 / Commit-17 base orchestrator for the publishing path.
 *
 * Coverage right now:
 *
 *   - `createPost(ctx, input)`     — insert `posts` row + the N
 *                                    associated `post_targets` rows
 *                                    for the chosen accounts.
 *   - `updatePostDraft(ctx, …)`    — edit body / link / utm / media /
 *                                    schedule. Only legal while
 *                                    `status='draft' | 'pending_approval'`.
 *   - `transitionPostStatus(…)`    — gated status mutator. Used by
 *                                    schedule, cancel, retry actions.
 *   - `cancelPost(ctx, postId)`    — terminal cancel transition.
 *
 * NOT covered here (Commit 20 territory):
 *
 *   - The publish-job that flips `scheduled → publishing → published`
 *     and walks targets. The job uses the same `transitionPostStatus`
 *     helper for the parent row plus its own per-target dispatch
 *     module.
 *   - The approval flow (`pending_approval → scheduled` via
 *     `/approvals`). The `posts` entity is already accepted by the
 *     approvals CHECK constraint; the dispatcher module lands in
 *     Commit 20.
 *
 * # `postsPerMonth` counter
 *
 * Per Phase-1/2 plan-limit semantics, the windowed
 * `postsPerMonth` counter (`lib/plans/plans.ts` →
 * `lib/usage/counters.ts`) increments **when a post transitions to
 * `published`** — not at schedule time, not at draft time, not on
 * `failed`. The Commit-20 publish-job is the only writer that
 * triggers the increment. Commit 17 leaves the counter untouched
 * because drafts and schedules don't consume the budget.
 *
 * # Audit
 *
 * Every mutation here writes a row to `audit_events`. The audit
 * write runs outside the main transaction (via `dbAdmin`) — same
 * pattern as inbox / approvals / reviews, tracked at
 * TODO.md#audit-events-atomicity for the Phase-11 atomic merge.
 */

// ---------------------------------------------------------------------------
// DI seam (matches inbox/send-reply, reviews/send-response, etc.)
// ---------------------------------------------------------------------------

export interface PostsDeps {
  asUser: <T>(
    ctx: { orgId: string; userId: string },
    fn: (tx: AnyPgTx) => Promise<T>,
  ) => Promise<T>;
  asAdmin: <T>(fn: (tx: AnyPgTx) => Promise<T>) => Promise<T>;
  now: () => Date;
}

const defaultDeps: PostsDeps = {
  asUser: (ctx, fn) => dbAs(ctx, fn),
  asAdmin: (fn) => dbAdmin(fn),
  now: () => new Date(),
};

// ---------------------------------------------------------------------------
// createPost
// ---------------------------------------------------------------------------

export interface CreatePostInput {
  readonly brandId?: string | null;
  readonly campaignId?: string | null;
  readonly text: string;
  readonly mediaIds?: ReadonlyArray<string>;
  readonly link?: string | null;
  readonly utm?: Record<string, string>;
  readonly scheduledAt?: Date | null;
  /** Connected-account IDs the post should publish to. */
  readonly accountIds: ReadonlyArray<string>;
  /** Per-account overrides (text/link/mediaIds). */
  readonly platformVariants?: Readonly<Record<string, Record<string, unknown>>>;
  /** Client-side dedup key — defends against double-click on Schedule. */
  readonly idempotencyKey?: string;
  /** Initial status; defaults to `draft`. */
  readonly initialStatus?: PostStatus;
}

export interface CreatePostSuccess {
  readonly postId: string;
  readonly targetIds: ReadonlyArray<string>;
}

const MAX_TEXT_LEN = 64_000; // platform caps are smaller; this is a sanity bound

export async function createPost(
  ctx: { orgId: string; userId: string },
  input: CreatePostInput,
  deps: PostsDeps = defaultDeps,
): Promise<Result<CreatePostSuccess>> {
  if (input.text.length > MAX_TEXT_LEN) {
    return err('VALIDATION_ERROR', 'Texto del post supera el máximo permitido.');
  }
  if (input.accountIds.length === 0) {
    return err('VALIDATION_ERROR', 'Selecciona al menos una cuenta destino.');
  }
  if (
    input.initialStatus &&
    !['draft', 'pending_approval', 'scheduled'].includes(input.initialStatus)
  ) {
    return err('VALIDATION_ERROR', 'initialStatus inválido para createPost.');
  }
  const status: PostStatus = input.initialStatus ?? 'draft';

  // Verify each account belongs to the caller's org (RLS would
  // bounce anyway, but checking up front gives a clean error).
  const validAccountRows = await deps.asUser<Array<{ id: string; platform: string }>>(
    ctx,
    (tx) =>
      tx
        .select({ id: connectedAccounts.id, platform: connectedAccounts.platform })
        .from(connectedAccounts)
        .where(
          and(
            eq(connectedAccounts.organizationId, ctx.orgId),
            inArray(connectedAccounts.id, [...input.accountIds]),
          ),
        ),
  );
  if (validAccountRows.length !== input.accountIds.length) {
    return err('VALIDATION_ERROR', 'Una o más cuentas no existen en esta organización.');
  }

  let postId = '';
  let targetIds: string[] = [];

  try {
    const result = await deps.asUser<{ postId: string; targetIds: string[] }>(
      ctx,
      async (tx) => {
        const inserted = await tx
          .insert(posts)
          .values({
            organizationId: ctx.orgId,
            ...(input.brandId !== undefined ? { brandId: input.brandId } : {}),
            ...(input.campaignId !== undefined ? { campaignId: input.campaignId } : {}),
            authorId: ctx.userId,
            status,
            text: input.text,
            ...(input.mediaIds ? { mediaIds: [...input.mediaIds] } : {}),
            ...(input.link !== undefined ? { link: input.link } : {}),
            ...(input.utm ? { utm: input.utm } : {}),
            ...(input.scheduledAt !== undefined
              ? { scheduledAt: input.scheduledAt }
              : {}),
            ...(input.idempotencyKey
              ? { idempotencyKey: input.idempotencyKey }
              : {}),
          })
          .returning({ id: posts.id });
        const newPostId = inserted[0]!.id;

        const targetRows = await tx
          .insert(postTargets)
          .values(
            input.accountIds.map((accountId) => ({
              organizationId: ctx.orgId,
              postId: newPostId,
              connectedAccountId: accountId,
              platformVariant:
                input.platformVariants?.[accountId] ?? {},
            })),
          )
          .returning({ id: postTargets.id });

        return {
          postId: newPostId,
          targetIds: (targetRows as Array<{ id: string }>).map((r) => r.id),
        };
      },
    );
    postId = result.postId;
    targetIds = result.targetIds;
  } catch (e) {
    const msg = (e as Error).message ?? '';
    if (msg.includes('posts_org_idempotency_unique')) {
      return err('CONFLICT', 'Este post ya fue creado en un intento previo.', {
        meta: { idempotencyKey: input.idempotencyKey },
      });
    }
    if (msg.includes('post_targets_post_account_active_unique')) {
      return err('VALIDATION_ERROR', 'Hay cuentas duplicadas en la lista de destino.');
    }
    throw e;
  }

  await writeAudit(deps, ctx, {
    action: 'post.created',
    entityType: 'post',
    entityId: postId,
    after: {
      status,
      accountCount: input.accountIds.length,
      hasMedia: (input.mediaIds?.length ?? 0) > 0,
      scheduledAt: input.scheduledAt ?? null,
    },
    riskLevel: 'low',
  });

  return ok({ postId, targetIds });
}

// ---------------------------------------------------------------------------
// updatePostDraft
// ---------------------------------------------------------------------------

export interface UpdatePostDraftInput {
  readonly postId: string;
  readonly text?: string;
  readonly mediaIds?: ReadonlyArray<string>;
  readonly link?: string | null;
  readonly utm?: Record<string, string>;
  readonly scheduledAt?: Date | null;
  readonly campaignId?: string | null;
}

export async function updatePostDraft(
  ctx: { orgId: string; userId: string },
  input: UpdatePostDraftInput,
  deps: PostsDeps = defaultDeps,
): Promise<Result<{ postId: string }>> {
  // Fetch current status to gate the edit.
  const rows = await deps.asUser<Array<{ id: string; status: PostStatus }>>(
    ctx,
    (tx) =>
      tx
        .select({ id: posts.id, status: posts.status })
        .from(posts)
        .where(
          and(
            eq(posts.id, input.postId),
            eq(posts.organizationId, ctx.orgId),
          ),
        )
        .limit(1),
  );
  if (rows.length === 0) return err('NOT_FOUND', 'Post no encontrado.');
  const row = rows[0]!;
  if (row.status !== 'draft' && row.status !== 'pending_approval') {
    return err(
      'CONFLICT',
      `No se puede editar un post en estado ${row.status}. Cancela o re-abre primero.`,
    );
  }

  const patch: Record<string, unknown> = {};
  if (input.text !== undefined) patch.text = input.text;
  if (input.mediaIds !== undefined) patch.mediaIds = [...input.mediaIds];
  if (input.link !== undefined) patch.link = input.link;
  if (input.utm !== undefined) patch.utm = input.utm;
  if (input.scheduledAt !== undefined) patch.scheduledAt = input.scheduledAt;
  if (input.campaignId !== undefined) patch.campaignId = input.campaignId;
  if (Object.keys(patch).length === 0) {
    return ok({ postId: input.postId });
  }

  await deps.asUser(ctx, (tx) =>
    tx
      .update(posts)
      .set(patch)
      .where(
        and(
          eq(posts.id, input.postId),
          eq(posts.organizationId, ctx.orgId),
        ),
      ),
  );

  await writeAudit(deps, ctx, {
    action: 'post.draft.updated',
    entityType: 'post',
    entityId: input.postId,
    after: { fields: Object.keys(patch) },
    riskLevel: 'low',
  });

  return ok({ postId: input.postId });
}

// ---------------------------------------------------------------------------
// transitionPostStatus
// ---------------------------------------------------------------------------

export async function transitionPostStatus(
  ctx: { orgId: string; userId: string },
  postId: string,
  to: PostStatus,
  deps: PostsDeps = defaultDeps,
): Promise<Result<{ from: PostStatus; to: PostStatus }>> {
  const rows = await deps.asUser<Array<{ status: PostStatus }>>(
    ctx,
    (tx) =>
      tx
        .select({ status: posts.status })
        .from(posts)
        .where(
          and(eq(posts.id, postId), eq(posts.organizationId, ctx.orgId)),
        )
        .limit(1),
  );
  if (rows.length === 0) return err('NOT_FOUND', 'Post no encontrado.');
  const from = rows[0]!.status;

  if (isTerminal(from)) {
    return err(
      'CONFLICT',
      `Post en estado terminal ${from}; ninguna transición permitida.`,
    );
  }
  if (!canTransition(from, to)) {
    return err(
      'VALIDATION_ERROR',
      `Transición ${from} → ${to} no permitida.`,
      { meta: { from, to } },
    );
  }

  await deps.asUser(ctx, (tx) =>
    tx
      .update(posts)
      .set({ status: to })
      .where(
        and(eq(posts.id, postId), eq(posts.organizationId, ctx.orgId)),
      ),
  );

  await writeAudit(deps, ctx, {
    action: `post.status.${to}`,
    entityType: 'post',
    entityId: postId,
    before: { status: from },
    after: { status: to },
    riskLevel: 'low',
  });

  return ok({ from, to });
}

// ---------------------------------------------------------------------------
// cancelPost (convenience wrapper)
// ---------------------------------------------------------------------------

export async function cancelPost(
  ctx: { orgId: string; userId: string },
  postId: string,
  deps: PostsDeps = defaultDeps,
): Promise<Result<{ postId: string }>> {
  const result = await transitionPostStatus(ctx, postId, 'cancelled', deps);
  if (!result.ok) return result;
  return ok({ postId });
}

// ---------------------------------------------------------------------------
// Audit helper
// ---------------------------------------------------------------------------

interface AuditInput {
  action: string;
  entityType: string;
  entityId: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  riskLevel?: string;
}

async function writeAudit(
  deps: PostsDeps,
  ctx: { orgId: string; userId: string },
  input: AuditInput,
): Promise<void> {
  try {
    await deps.asAdmin(async (tx) =>
      tx.insert(auditEvents).values({
        organizationId: ctx.orgId,
        userId: ctx.userId,
        actorType: 'user',
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        before: input.before ?? null,
        after: input.after ?? null,
        ...(input.riskLevel ? { riskLevel: input.riskLevel } : {}),
      }),
    );
  } catch (cause) {
    throw new AppError(
      'INTERNAL_ERROR',
      'Failed to write audit event for post.',
      { cause, meta: { action: input.action } },
    );
  }
}
