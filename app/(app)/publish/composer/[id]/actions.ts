'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireUser } from '@/lib/auth/server';
import { authorize } from '@/lib/permissions/can';
import { setPostTargets } from '@/lib/publish/composer/set-targets';
import { updatePostDraft } from '@/lib/publish/posts';
import { err, type Result } from '@/lib/types/result';

/**
 * Composer-scoped Server Actions for the post draft editor.
 *
 * The "save text/link/utm" path delegates to the C17
 * `updatePostDraft` orchestrator (no behavior change — the
 * action just wraps it with auth + RBAC + Zod).
 *
 * The "save account picker selection" path delegates to the new
 * `setPostTargets` helper which diffs the requested account set
 * against the live `post_targets` rows.
 *
 * Schedule + publish actions stay in `app/(app)/publish/actions.ts`
 * (already wired in C17/C18) — both files target the same `posts`
 * row, just at different lifecycle stages.
 */

const utmSchema = z
  .object({
    source: z.string().max(100).optional(),
    medium: z.string().max(100).optional(),
    campaign: z.string().max(100).optional(),
    term: z.string().max(100).optional(),
    content: z.string().max(100).optional(),
  })
  .strict();

const saveDraftSchema = z
  .object({
    postId: z.string().uuid(),
    text: z.string().max(64_000).optional(),
    link: z.string().url().nullable().optional(),
    utm: utmSchema.optional(),
    campaignId: z.string().uuid().nullable().optional(),
  })
  .strict();

export type SaveDraftInput = z.infer<typeof saveDraftSchema>;

export async function saveDraftAction(
  _prev: unknown,
  input: SaveDraftInput,
): Promise<Result<{ postId: string }>> {
  const session = await requireUser();
  authorize(session.role, 'posts:create');

  const parsed = saveDraftSchema.safeParse(input);
  if (!parsed.success) {
    return err('VALIDATION_ERROR', 'Datos del borrador inválidos.', {
      meta: { issues: parsed.error.flatten() },
    });
  }

  const result = await updatePostDraft(
    { orgId: session.orgId, userId: session.userId },
    {
      postId: parsed.data.postId,
      ...(parsed.data.text !== undefined ? { text: parsed.data.text } : {}),
      ...(parsed.data.link !== undefined ? { link: parsed.data.link } : {}),
      ...(parsed.data.utm
        ? { utm: parsed.data.utm as Record<string, string> }
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
// setPostTargetsAction
// ---------------------------------------------------------------------------

const setTargetsSchema = z
  .object({
    postId: z.string().uuid(),
    accountIds: z.array(z.string().uuid()).max(75),
  })
  .strict();

export type SetPostTargetsInput = z.infer<typeof setTargetsSchema>;

export async function setPostTargetsAction(
  _prev: unknown,
  input: SetPostTargetsInput,
): Promise<
  Result<{
    added: ReadonlyArray<string>;
    removed: ReadonlyArray<string>;
    unchanged: ReadonlyArray<string>;
  }>
> {
  const session = await requireUser();
  authorize(session.role, 'posts:create');

  const parsed = setTargetsSchema.safeParse(input);
  if (!parsed.success) {
    return err('VALIDATION_ERROR', 'Selección de cuentas inválida.', {
      meta: { issues: parsed.error.flatten() },
    });
  }

  const result = await setPostTargets({
    orgId: session.orgId,
    userId: session.userId,
    postId: parsed.data.postId,
    accountIds: parsed.data.accountIds,
  });

  if (result.ok) {
    revalidatePath(`/publish/composer/${parsed.data.postId}`);
  }
  return result;
}
