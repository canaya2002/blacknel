'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireUser } from '@/lib/auth/server';
import { dbAdmin, dbAs } from '@/lib/db/client';
import { auditEvents, posts } from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { authorize } from '@/lib/permissions/can';
import { createOrFetchDraft } from '@/lib/publish/composer/new-draft';
import {
  cancelPost,
  createPost,
  transitionPostStatus,
  updatePostDraft,
  type CreatePostSuccess,
} from '@/lib/publish/posts';
import type { PostStatus } from '@/lib/publish/status-transitions';
import { assertPostsCap } from '@/lib/publish/usage-check';
import { getOrgPlanCode } from '@/lib/queries/plan';
import { err, type Result } from '@/lib/types/result';

/**
 * Server Actions for /publish (Commit 17 base). Each wraps the
 * orchestrator in `lib/publish/posts.ts` with the usual preamble
 * (auth + RBAC + Zod) and revalidates the affected paths.
 *
 * The composer UI lands in Commit 19, the publish-job + retries +
 * approvals in Commit 20, the calendar + list view in Commit 18.
 * Commit 17 ships these actions early so the seed pipeline and
 * integration tests can drive the same code path the future UI
 * will.
 */

const utmSchema = z.object({
  source: z.string().max(100).optional(),
  medium: z.string().max(100).optional(),
  campaign: z.string().max(100).optional(),
  term: z.string().max(100).optional(),
  content: z.string().max(100).optional(),
});

const createSchema = z.object({
  brandId: z.string().uuid().nullable().optional(),
  campaignId: z.string().uuid().nullable().optional(),
  text: z.string().min(1).max(64_000),
  mediaIds: z.array(z.string().uuid()).max(20).optional(),
  link: z.string().url().nullable().optional(),
  utm: utmSchema.optional(),
  scheduledAt: z.string().datetime().nullable().optional(),
  accountIds: z.array(z.string().uuid()).min(1).max(75),
  platformVariants: z.record(z.string().uuid(), z.record(z.string(), z.unknown())).optional(),
  idempotencyKey: z.string().uuid().optional(),
  initialStatus: z.enum(['draft', 'pending_approval', 'scheduled']).optional(),
});

export type CreatePostActionInput = z.infer<typeof createSchema>;

export async function createPostAction(
  _prev: unknown,
  input: CreatePostActionInput,
): Promise<Result<CreatePostSuccess>> {
  const session = await requireUser();
  authorize(session.role, 'posts:create');

  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return err('VALIDATION_ERROR', 'Datos del post inválidos.', {
      meta: { issues: parsed.error.flatten() },
    });
  }

  // Plan-cap enforcement (Commit 18, Section B). The UI hides the
  // CTA when the cap is reached, but a stale tab / direct action
  // call can still arrive — this is the defense in depth. Drafts
  // and scheduled posts are subject to the cap because they
  // consume future budget (the publish-job will tick the counter
  // on success). Note: this counts the *intent* at create time;
  // the actual postsPerMonth increment happens at
  // status → published (Commit 20 publish-job).
  if (
    parsed.data.initialStatus === 'scheduled' ||
    parsed.data.initialStatus === 'pending_approval'
  ) {
    const plan = await getOrgPlanCode(session);
    const gate = await assertPostsCap(session.orgId, plan);
    if (!gate.ok) return gate;
  }

  const result = await createPost(
    { orgId: session.orgId, userId: session.userId },
    {
      ...(parsed.data.brandId !== undefined ? { brandId: parsed.data.brandId } : {}),
      ...(parsed.data.campaignId !== undefined
        ? { campaignId: parsed.data.campaignId }
        : {}),
      text: parsed.data.text,
      ...(parsed.data.mediaIds ? { mediaIds: parsed.data.mediaIds } : {}),
      ...(parsed.data.link !== undefined ? { link: parsed.data.link } : {}),
      ...(parsed.data.utm
        ? { utm: parsed.data.utm as Record<string, string> }
        : {}),
      ...(parsed.data.scheduledAt !== undefined
        ? {
            scheduledAt: parsed.data.scheduledAt
              ? new Date(parsed.data.scheduledAt)
              : null,
          }
        : {}),
      accountIds: parsed.data.accountIds,
      ...(parsed.data.platformVariants
        ? { platformVariants: parsed.data.platformVariants }
        : {}),
      ...(parsed.data.idempotencyKey
        ? { idempotencyKey: parsed.data.idempotencyKey }
        : {}),
      ...(parsed.data.initialStatus
        ? { initialStatus: parsed.data.initialStatus }
        : {}),
    },
  );

  if (result.ok) {
    revalidatePath('/publish');
  }
  return result;
}

// ---------------------------------------------------------------------------
// update draft
// ---------------------------------------------------------------------------

const updateSchema = z.object({
  postId: z.string().uuid(),
  text: z.string().max(64_000).optional(),
  mediaIds: z.array(z.string().uuid()).max(20).optional(),
  link: z.string().url().nullable().optional(),
  utm: utmSchema.optional(),
  scheduledAt: z.string().datetime().nullable().optional(),
  campaignId: z.string().uuid().nullable().optional(),
});

export async function updatePostAction(
  _prev: unknown,
  input: z.infer<typeof updateSchema>,
): Promise<Result<{ postId: string }>> {
  const session = await requireUser();
  authorize(session.role, 'posts:create');

  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return err('VALIDATION_ERROR', 'Edición inválida.', {
      meta: { issues: parsed.error.flatten() },
    });
  }

  const result = await updatePostDraft(
    { orgId: session.orgId, userId: session.userId },
    {
      postId: parsed.data.postId,
      ...(parsed.data.text !== undefined ? { text: parsed.data.text } : {}),
      ...(parsed.data.mediaIds ? { mediaIds: parsed.data.mediaIds } : {}),
      ...(parsed.data.link !== undefined ? { link: parsed.data.link } : {}),
      ...(parsed.data.utm
        ? { utm: parsed.data.utm as Record<string, string> }
        : {}),
      ...(parsed.data.scheduledAt !== undefined
        ? {
            scheduledAt: parsed.data.scheduledAt
              ? new Date(parsed.data.scheduledAt)
              : null,
          }
        : {}),
      ...(parsed.data.campaignId !== undefined
        ? { campaignId: parsed.data.campaignId }
        : {}),
    },
  );

  if (result.ok) {
    revalidatePath('/publish');
    revalidatePath(`/publish/composer/${parsed.data.postId}`);
  }
  return result;
}

// ---------------------------------------------------------------------------
// schedule post (draft → scheduled)
// ---------------------------------------------------------------------------

const scheduleSchema = z.object({
  postId: z.string().uuid(),
});

export async function schedulePostAction(
  _prev: unknown,
  formData: FormData,
): Promise<Result<{ postId: string; from: string; to: string }>> {
  const session = await requireUser();
  authorize(session.role, 'posts:publish');
  const parsed = scheduleSchema.safeParse({ postId: formData.get('postId') });
  if (!parsed.success) return err('VALIDATION_ERROR', 'ID inválido.');

  // Plan-cap enforcement. Both branches consume a post-budget
  // seat — schedule commits future capacity, publish-now consumes
  // current. Same `checkUsage` path.
  const plan = await getOrgPlanCode(session);
  const gate = await assertPostsCap(session.orgId, plan);
  if (!gate.ok) return gate;

  // Read `posts.scheduled_at` from the DB — NEVER from the client.
  // A user with a stale tab could otherwise submit "schedule now"
  // while the row was previously set to a future date. The
  // persisted value is the only truth.
  const rows = await dbAs<Array<{ scheduledAt: Date | null }>>(
    { orgId: session.orgId, userId: session.userId },
    async (tx) =>
      tx
        .select({ scheduledAt: posts.scheduledAt })
        .from(posts)
        .where(
          and(eq(posts.id, parsed.data.postId), eq(posts.organizationId, session.orgId)),
        )
        .limit(1),
  );
  const persisted = rows[0];
  if (!persisted) return err('NOT_FOUND', 'Post no encontrado.');

  // Branch on scheduled_at: null → publish now (draft →
  // published), otherwise → schedule (draft → scheduled).
  const to: PostStatus = persisted.scheduledAt === null ? 'published' : 'scheduled';
  const result = await transitionPostStatus(
    { orgId: session.orgId, userId: session.userId },
    parsed.data.postId,
    to,
  );
  if (!result.ok) return result;

  // Spec-named audit row, complementing the generic
  // `post.status.${to}` row that `transitionPostStatus` already
  // wrote (see lib/publish/posts.ts).
  try {
    await dbAdmin(async (tx) =>
      tx.insert(auditEvents).values({
        organizationId: session.orgId,
        userId: session.userId,
        actorType: 'user',
        action: to === 'published' ? 'post.published_immediate' : 'post.scheduled',
        entityType: 'post',
        entityId: parsed.data.postId,
        after: { scheduledAt: persisted.scheduledAt?.toISOString() ?? null },
        riskLevel: 'low',
      }),
    );
  } catch (cause) {
    throw new AppError('INTERNAL_ERROR', 'Failed to write schedule audit event.', {
      cause,
      meta: { postId: parsed.data.postId, to },
    });
  }

  revalidatePath('/publish');
  revalidatePath(`/publish/composer/${parsed.data.postId}`);
  return { ok: true, data: { postId: parsed.data.postId, ...result.data } };
}

// ---------------------------------------------------------------------------
// cancel post (terminal)
// ---------------------------------------------------------------------------

const cancelSchema = z.object({
  postId: z.string().uuid(),
});

export async function cancelPostAction(
  _prev: unknown,
  formData: FormData,
): Promise<Result<{ postId: string }>> {
  const session = await requireUser();
  authorize(session.role, 'posts:create');
  const parsed = cancelSchema.safeParse({ postId: formData.get('postId') });
  if (!parsed.success) return err('VALIDATION_ERROR', 'ID inválido.');

  const result = await cancelPost(
    { orgId: session.orgId, userId: session.userId },
    parsed.data.postId,
  );
  if (result.ok) {
    revalidatePath('/publish');
    revalidatePath(`/publish/composer/${parsed.data.postId}`);
  }
  return result;
}

// ---------------------------------------------------------------------------
// createDraftAction — idempotent empty-draft entry point (Ajuste Y)
// ---------------------------------------------------------------------------

const createDraftSchema = z
  .object({
    idempotencyKey: z.string().uuid(),
    brandId: z.string().uuid().nullable().optional(),
  })
  .strict();

export type CreateDraftActionInput = z.infer<typeof createDraftSchema>;

/**
 * Opens (or fetches, when the key has already been used) an empty
 * draft post. Called by the C18-era "Nuevo post" CTA. The client
 * generates a fresh `crypto.randomUUID()` per click — same key on
 * a double-click returns the same `postId` rather than two rows.
 *
 * No plan-cap check here: drafts don't consume `postsPerMonth`.
 * The cap fires on `schedulePostAction` when the user commits the
 * draft to a publish-budget seat.
 */
export async function createDraftAction(
  _prev: unknown,
  input: CreateDraftActionInput,
): Promise<Result<{ postId: string; created: boolean }>> {
  const session = await requireUser();
  authorize(session.role, 'posts:create');

  const parsed = createDraftSchema.safeParse(input);
  if (!parsed.success) {
    return err('VALIDATION_ERROR', 'Identificador de borrador inválido.', {
      meta: { issues: parsed.error.flatten() },
    });
  }

  const result = await createOrFetchDraft({
    orgId: session.orgId,
    userId: session.userId,
    idempotencyKey: parsed.data.idempotencyKey,
    ...(parsed.data.brandId !== undefined ? { brandId: parsed.data.brandId } : {}),
  });

  if (result.ok) {
    revalidatePath('/publish');
  }
  return result;
}
