import 'server-only';

import { and, eq } from 'drizzle-orm';

import { type AnyPgTx, dbAdmin, dbAs } from '@/lib/db/client';
import { auditEvents, posts } from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { err, ok, type Result } from '@/lib/types/result';

/**
 * Idempotent "create-or-fetch empty draft" used by
 * `/publish/composer/new`.
 *
 * # Why this lives outside `lib/publish/posts.ts`
 *
 * The C17 `createPost` orchestrator enforces a non-empty
 * `accountIds`. That's the correct constraint for the publish
 * action — you can't publish to zero targets — but a *draft*
 * opens precisely with zero accounts: the user hasn't picked
 * targets yet. Rather than relax the C17 contract everywhere,
 * we carve out this narrower entry-point that inserts only the
 * `posts` row.
 *
 * # Idempotency contract (Ajuste Y)
 *
 * The caller (the C18 "Nuevo post" CTA Client wrapper) generates
 * a `crypto.randomUUID()` and threads it into
 * `/composer/new?key=…`. If the user double-clicks, refreshes,
 * or the navigation retries under a flaky connection, the same
 * key arrives twice. We:
 *
 *   1. Insert with that key.
 *   2. If the partial-unique constraint
 *      `posts (organization_id, idempotency_key) WHERE NOT NULL`
 *      rejects, fall back to a SELECT by `(org, idempotency_key)`
 *      and return the existing row. Same `postId`, both branches.
 *
 * The DI seam mirrors `lib/publish/posts.ts` — production uses
 * `dbAs` / `dbAdmin`; the integration test injects fixture-bound
 * transactions.
 */

// ---------------------------------------------------------------------------
// DI seam
// ---------------------------------------------------------------------------

export interface NewDraftDeps {
  asUser: <T>(
    ctx: { orgId: string; userId: string },
    fn: (tx: AnyPgTx) => Promise<T>,
  ) => Promise<T>;
  asAdmin: <T>(fn: (tx: AnyPgTx) => Promise<T>) => Promise<T>;
}

const defaultDeps: NewDraftDeps = {
  asUser: (ctx, fn) => dbAs(ctx, fn),
  asAdmin: (fn) => dbAdmin(fn),
};

// ---------------------------------------------------------------------------
// createOrFetchDraft
// ---------------------------------------------------------------------------

export interface CreateOrFetchDraftOpts {
  readonly orgId: string;
  readonly userId: string;
  /** Client-supplied UUID. Caller validates with Zod before invoking. */
  readonly idempotencyKey: string;
  /** Optional brand the draft belongs to. */
  readonly brandId?: string | null;
}

export interface CreateOrFetchDraftSuccess {
  readonly postId: string;
  /** True when this call did the insert; false when the key matched an existing row. */
  readonly created: boolean;
}

const UNIQUE_HINTS = [
  'posts_org_idempotency_unique',
  'unique constraint',
  'duplicate key value',
];

export async function createOrFetchDraft(
  opts: CreateOrFetchDraftOpts,
  deps: NewDraftDeps = defaultDeps,
): Promise<Result<CreateOrFetchDraftSuccess>> {
  let postId: string | null = null;
  let created = false;

  try {
    const rows = await deps.asUser<Array<{ id: string }>>(
      { orgId: opts.orgId, userId: opts.userId },
      async (tx) =>
        tx
          .insert(posts)
          .values({
            organizationId: opts.orgId,
            ...(opts.brandId ? { brandId: opts.brandId } : {}),
            authorId: opts.userId,
            status: 'draft',
            text: '',
            idempotencyKey: opts.idempotencyKey,
          })
          .returning({ id: posts.id }),
    );
    postId = rows[0]?.id ?? null;
    created = true;
  } catch (e) {
    const msg = (e as Error).message ?? '';
    if (!UNIQUE_HINTS.some((hint) => msg.includes(hint))) throw e;
    const existing = await deps.asUser<Array<{ id: string }>>(
      { orgId: opts.orgId, userId: opts.userId },
      async (tx) =>
        tx
          .select({ id: posts.id })
          .from(posts)
          .where(
            and(
              eq(posts.organizationId, opts.orgId),
              eq(posts.idempotencyKey, opts.idempotencyKey),
            ),
          )
          .limit(1),
    );
    postId = existing[0]?.id ?? null;
    created = false;
  }

  if (!postId) {
    return err(
      'INTERNAL_ERROR',
      'No fue posible resolver el borrador con la clave de idempotencia.',
      { meta: { idempotencyKey: opts.idempotencyKey } },
    );
  }

  // Audit only the create branch. A repeat-key request that
  // returns an existing row is not a state-changing event.
  if (created) {
    try {
      await deps.asAdmin(async (tx) =>
        tx.insert(auditEvents).values({
          organizationId: opts.orgId,
          userId: opts.userId,
          actorType: 'user',
          action: 'post.draft.opened',
          entityType: 'post',
          entityId: postId,
          after: { idempotencyKey: opts.idempotencyKey },
          riskLevel: 'low',
        }),
      );
    } catch (cause) {
      throw new AppError('INTERNAL_ERROR', 'Failed to write audit event for new draft.', {
        cause,
        meta: { postId },
      });
    }
  }

  return ok({ postId, created });
}
