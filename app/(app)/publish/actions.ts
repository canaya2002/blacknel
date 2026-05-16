'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireUser } from '@/lib/auth/server';
import { authorize } from '@/lib/permissions/can';
import { applySchedule } from '@/lib/publish/composer/apply-schedule';
import { createOrFetchDraft } from '@/lib/publish/composer/new-draft';
import {
  cancelPost,
  createPost,
  updatePostDraft,
  type CreatePostSuccess,
} from '@/lib/publish/posts';
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
): Promise<
  Result<{
    postId: string;
    from: string;
    to: string;
    routedToApproval: boolean;
    approvalId: string | null;
  }>
> {
  const session = await requireUser();
  authorize(session.role, 'posts:publish');
  const parsed = scheduleSchema.safeParse({ postId: formData.get('postId') });
  if (!parsed.success) return err('VALIDATION_ERROR', 'ID inválido.');

  // Plan-cap enforcement. Both branches (schedule + publish-now)
  // consume a post-budget seat. Approval-routed posts also
  // consume the seat the moment they're scheduled, even before a
  // human approves — the budget is for *intent to publish*, not
  // for the moment of publication.
  const plan = await getOrgPlanCode(session);
  const gate = await assertPostsCap(session.orgId, plan);
  if (!gate.ok) return gate;

  // Delegate to `applySchedule`. It reads scheduled_at + approval
  // rules from the DB, runs the evaluator, writes the right
  // approvals + audit rows, and transitions to the matching
  // status. Three end states: pending_approval, scheduled,
  // published.
  const result = await applySchedule({
    orgId: session.orgId,
    userId: session.userId,
    postId: parsed.data.postId,
  });
  if (!result.ok) return result;

  revalidatePath('/publish');
  revalidatePath(`/publish/composer/${parsed.data.postId}`);
  return {
    ok: true,
    data: {
      postId: parsed.data.postId,
      from: result.data.from,
      to: result.data.to,
      routedToApproval: result.data.routedToApproval,
      approvalId: result.data.approvalId,
    },
  };
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
