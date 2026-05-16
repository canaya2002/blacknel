import 'server-only';

import { and, eq, inArray, ne } from 'drizzle-orm';

import { type AnyPgTx, dbAdmin, dbAs } from '@/lib/db/client';
import { auditEvents, connectedAccounts, postTargets, posts } from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { err, ok, type Result } from '@/lib/types/result';

/**
 * Replace the active `post_targets` for a draft / pending-approval
 * post with a new set of account ids — the composer account picker
 * is the writer.
 *
 * # Diff semantics
 *
 * For a given `postId`, `setPostTargets({...})` is the source of
 * truth for which accounts the post should publish to. The
 * algorithm:
 *
 *   1. Load existing non-failed targets (`status != 'failed'`).
 *      Failed rows stay untouched — they're retry history.
 *   2. For each requested `accountId` not already present:
 *      insert a fresh `pending` target.
 *   3. For each existing non-failed target whose `accountId` is
 *      no longer requested: delete it.
 *
 * The partial unique on `(post_id, connected_account_id) WHERE
 * status != 'failed'` makes "one row per active account"
 * structurally true; the helper just keeps the set aligned.
 *
 * # Gating
 *
 * Rejects if the post is in a terminal or in-flight state
 * (`published`, `cancelled`, `publishing`, `failed`). The
 * composer surfaces a disabled state in those cases; this is
 * defense in depth so the action layer can't accidentally
 * mutate targets on a row already past the editing point.
 */

export interface PostTargetsDeps {
  asUser: <T>(
    ctx: { orgId: string; userId: string },
    fn: (tx: AnyPgTx) => Promise<T>,
  ) => Promise<T>;
  asAdmin: <T>(fn: (tx: AnyPgTx) => Promise<T>) => Promise<T>;
}

const defaultDeps: PostTargetsDeps = {
  asUser: (ctx, fn) => dbAs(ctx, fn),
  asAdmin: (fn) => dbAdmin(fn),
};

export interface SetPostTargetsOpts {
  readonly orgId: string;
  readonly userId: string;
  readonly postId: string;
  readonly accountIds: ReadonlyArray<string>;
}

export interface SetPostTargetsSuccess {
  readonly added: ReadonlyArray<string>;
  readonly removed: ReadonlyArray<string>;
  readonly unchanged: ReadonlyArray<string>;
}

const EDITABLE_STATES = new Set(['draft', 'pending_approval']);

export async function setPostTargets(
  opts: SetPostTargetsOpts,
  deps: PostTargetsDeps = defaultDeps,
): Promise<Result<SetPostTargetsSuccess>> {
  // 1. Verify the post exists, belongs to the caller's org, and is
  //    in an editable state.
  const postRows = await deps.asUser<Array<{ id: string; status: string }>>(
    { orgId: opts.orgId, userId: opts.userId },
    (tx) =>
      tx
        .select({ id: posts.id, status: posts.status })
        .from(posts)
        .where(
          and(eq(posts.id, opts.postId), eq(posts.organizationId, opts.orgId)),
        )
        .limit(1),
  );
  const post = postRows[0];
  if (!post) return err('NOT_FOUND', 'Post no encontrado.');
  if (!EDITABLE_STATES.has(post.status)) {
    return err(
      'CONFLICT',
      `No se pueden modificar destinos en estado ${post.status}. Vuelve a borrador para editar.`,
    );
  }

  // 2. Verify every requested account belongs to the caller's org.
  if (opts.accountIds.length > 0) {
    const valid = await deps.asUser<Array<{ id: string }>>(
      { orgId: opts.orgId, userId: opts.userId },
      (tx) =>
        tx
          .select({ id: connectedAccounts.id })
          .from(connectedAccounts)
          .where(
            and(
              eq(connectedAccounts.organizationId, opts.orgId),
              inArray(connectedAccounts.id, [...opts.accountIds]),
            ),
          ),
    );
    if (valid.length !== opts.accountIds.length) {
      return err(
        'VALIDATION_ERROR',
        'Una o más cuentas no existen en esta organización.',
      );
    }
  }

  // 3. Load existing non-failed targets.
  const existing = await deps.asUser<Array<{ id: string; connectedAccountId: string }>>(
    { orgId: opts.orgId, userId: opts.userId },
    (tx) =>
      tx
        .select({ id: postTargets.id, connectedAccountId: postTargets.connectedAccountId })
        .from(postTargets)
        .where(and(eq(postTargets.postId, opts.postId), ne(postTargets.status, 'failed'))),
  );
  const existingAccountIds = new Set(existing.map((r) => r.connectedAccountId));
  const requestedAccountIds = new Set(opts.accountIds);

  const toAdd: string[] = [];
  for (const id of opts.accountIds) {
    if (!existingAccountIds.has(id)) toAdd.push(id);
  }
  const toRemoveAccountIds: string[] = [];
  const toRemoveTargetIds: string[] = [];
  for (const row of existing) {
    if (!requestedAccountIds.has(row.connectedAccountId)) {
      toRemoveAccountIds.push(row.connectedAccountId);
      toRemoveTargetIds.push(row.id);
    }
  }
  const unchanged: string[] = [];
  for (const row of existing) {
    if (requestedAccountIds.has(row.connectedAccountId)) {
      unchanged.push(row.connectedAccountId);
    }
  }

  // 4. Apply diff.
  if (toAdd.length > 0 || toRemoveTargetIds.length > 0) {
    await deps.asUser(
      { orgId: opts.orgId, userId: opts.userId },
      async (tx) => {
        if (toRemoveTargetIds.length > 0) {
          await tx
            .delete(postTargets)
            .where(inArray(postTargets.id, toRemoveTargetIds));
        }
        if (toAdd.length > 0) {
          await tx
            .insert(postTargets)
            .values(
              toAdd.map((accountId) => ({
                organizationId: opts.orgId,
                postId: opts.postId,
                connectedAccountId: accountId,
              })),
            );
        }
      },
    );

    // Audit the diff. Same out-of-tx pattern as other publish
    // mutations (TODO.md#audit-events-atomicity).
    try {
      await deps.asAdmin(async (tx) =>
        tx.insert(auditEvents).values({
          organizationId: opts.orgId,
          userId: opts.userId,
          actorType: 'user',
          action: 'post.targets.updated',
          entityType: 'post',
          entityId: opts.postId,
          after: { added: toAdd, removed: toRemoveAccountIds },
          riskLevel: 'low',
        }),
      );
    } catch (cause) {
      throw new AppError('INTERNAL_ERROR', 'Failed to write audit event for set-targets.', {
        cause,
        meta: { postId: opts.postId },
      });
    }
  }

  return ok({ added: toAdd, removed: toRemoveAccountIds, unchanged });
}
