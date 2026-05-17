'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireUser } from '@/lib/auth/server';
import {
  normalizeTone,
  type CampaignGoal,
  type SuggestCaptionOutput,
} from '@/lib/ai/caption-stub';
import { suggestCaption } from '@/lib/ai/skills/caption';
import { dbAdmin, dbAs } from '@/lib/db/client';
import { auditEvents, brands, brandVoices, campaigns, locations, posts } from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { authorize } from '@/lib/permissions/can';
import { validateScheduledAt } from '@/lib/publish/composer/schedule';
import { setPostTargets } from '@/lib/publish/composer/set-targets';
import { updatePostDraft } from '@/lib/publish/posts';
import { err, ok, type Result } from '@/lib/types/result';

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
    mediaIds: z.array(z.string().uuid()).max(20).optional(),
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
      ...(parsed.data.mediaIds !== undefined
        ? { mediaIds: parsed.data.mediaIds }
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

// ---------------------------------------------------------------------------
// setScheduledAtAction (Commit 19c.2)
// ---------------------------------------------------------------------------

const setScheduledAtSchema = z
  .object({
    postId: z.string().uuid(),
    /** ISO 8601 with timezone (UTC). `null` clears the schedule. */
    scheduledAtIso: z.string().datetime().nullable(),
  })
  .strict();

export async function setScheduledAtAction(
  _prev: unknown,
  input: z.infer<typeof setScheduledAtSchema>,
): Promise<Result<{ postId: string; scheduledAtIso: string | null }>> {
  const session = await requireUser();
  authorize(session.role, 'posts:create');

  const parsed = setScheduledAtSchema.safeParse(input);
  if (!parsed.success) {
    return err('VALIDATION_ERROR', 'Datos de programación inválidos.', {
      meta: { issues: parsed.error.flatten() },
    });
  }

  const scheduledAt = parsed.data.scheduledAtIso ? new Date(parsed.data.scheduledAtIso) : null;
  if (scheduledAt !== null) {
    const v = validateScheduledAt(scheduledAt, new Date());
    if (!v.ok) {
      return err('VALIDATION_ERROR', v.error.message, {
        meta: { code: v.error.code },
      });
    }
  }

  // Verify the post exists, belongs to the caller's org, and is
  // in an editable state. Same gate as setPostTargets.
  const rows = await dbAs<Array<{ id: string; status: string }>>(
    { orgId: session.orgId, userId: session.userId },
    (tx) =>
      tx
        .select({ id: posts.id, status: posts.status })
        .from(posts)
        .where(
          and(eq(posts.id, parsed.data.postId), eq(posts.organizationId, session.orgId)),
        )
        .limit(1),
  );
  const row = rows[0];
  if (!row) return err('NOT_FOUND', 'Post no encontrado.');
  if (row.status !== 'draft' && row.status !== 'pending_approval') {
    return err(
      'CONFLICT',
      `No se puede modificar la programación en estado ${row.status}.`,
    );
  }

  await dbAs({ orgId: session.orgId, userId: session.userId }, (tx) =>
    tx
      .update(posts)
      .set({ scheduledAt })
      .where(
        and(eq(posts.id, parsed.data.postId), eq(posts.organizationId, session.orgId)),
      ),
  );

  try {
    await dbAdmin(async (tx) =>
      tx.insert(auditEvents).values({
        organizationId: session.orgId,
        userId: session.userId,
        actorType: 'user',
        action: 'post.scheduled_at.set',
        entityType: 'post',
        entityId: parsed.data.postId,
        after: { scheduledAt: scheduledAt?.toISOString() ?? null },
        riskLevel: 'low',
      }),
    );
  } catch (cause) {
    throw new AppError('INTERNAL_ERROR', 'Failed to write audit event for scheduled_at.', {
      cause,
      meta: { postId: parsed.data.postId },
    });
  }

  revalidatePath(`/publish/composer/${parsed.data.postId}`);
  return ok({
    postId: parsed.data.postId,
    scheduledAtIso: scheduledAt?.toISOString() ?? null,
  });
}

// ---------------------------------------------------------------------------
// AI caption stub: suggest + accept
// ---------------------------------------------------------------------------

const suggestCaptionSchema = z
  .object({
    postId: z.string().uuid(),
    /** Regenerate cycle index — incremented per "Otra opción" click. */
    regenerateIndex: z.number().int().nonnegative().max(50).default(0),
  })
  .strict();

export interface SuggestCaptionActionData {
  readonly body: string;
  readonly variantIndex: number;
  readonly bucket: string;
  readonly fellBackToDefault: boolean;
}

export async function suggestCaptionAction(
  _prev: unknown,
  input: z.infer<typeof suggestCaptionSchema>,
): Promise<Result<SuggestCaptionActionData>> {
  const session = await requireUser();
  authorize(session.role, 'posts:create');

  const parsed = suggestCaptionSchema.safeParse(input);
  if (!parsed.success) {
    return err('VALIDATION_ERROR', 'Petición de caption inválida.', {
      meta: { issues: parsed.error.flatten() },
    });
  }

  const captionContext = await dbAs<
    Array<{
      postId: string;
      brandId: string | null;
      brandName: string | null;
      brandVoiceTone: string | null;
      campaignGoal: string | null;
      locationName: string | null;
    }>
  >({ orgId: session.orgId, userId: session.userId }, (tx) =>
    tx
      .select({
        postId: posts.id,
        brandId: posts.brandId,
        brandName: brands.name,
        brandVoiceTone: brandVoices.tone,
        campaignGoal: campaigns.goal,
        locationName: locations.name,
      })
      .from(posts)
      .leftJoin(brands, eq(brands.id, posts.brandId))
      .leftJoin(brandVoices, eq(brandVoices.id, brands.brandVoiceId))
      .leftJoin(campaigns, eq(campaigns.id, posts.campaignId))
      .leftJoin(locations, eq(locations.brandId, posts.brandId))
      .where(
        and(eq(posts.id, parsed.data.postId), eq(posts.organizationId, session.orgId)),
      )
      .limit(1),
  );
  const ctx = captionContext[0];
  if (!ctx) return err('NOT_FOUND', 'Post no encontrado.');

  // Commit 24 — async path through aiClient. AiContext.entityId
  // is the ROOT posts.id (Ajuste 2) so future joins like "all AI
  // generations for this post" land on the right anchor regardless
  // of how many drafts / regenerate cycles produced them.
  const out: SuggestCaptionOutput = await suggestCaption({
    input: {
      postId: ctx.postId,
      brandId: ctx.brandId,
      brandName: ctx.brandName,
      locationName: ctx.locationName,
      productHint: null,
      goal: (ctx.campaignGoal as CampaignGoal | null) ?? 'evergreen',
      tone: normalizeTone(ctx.brandVoiceTone),
      index: parsed.data.regenerateIndex,
    },
    context: {
      orgId: session.orgId,
      userId: session.userId,
      actorType: 'user',
      entityType: 'post',
      entityId: parsed.data.postId,
    },
  });

  try {
    await dbAdmin(async (tx) =>
      tx.insert(auditEvents).values({
        organizationId: session.orgId,
        userId: session.userId,
        actorType: 'ai',
        action:
          parsed.data.regenerateIndex === 0
            ? 'ai.caption.suggested'
            : 'ai.caption.regenerated',
        entityType: 'post',
        entityId: parsed.data.postId,
        after: {
          bucket: out.bucket,
          variantIndex: out.variantIndex,
          regenerateIndex: parsed.data.regenerateIndex,
          fellBackToDefault: out.fellBackToDefault,
        },
        riskLevel: 'low',
      }),
    );
  } catch (cause) {
    throw new AppError('INTERNAL_ERROR', 'Failed to audit ai.caption.suggested.', {
      cause,
      meta: { postId: parsed.data.postId },
    });
  }

  return ok({
    body: out.body,
    variantIndex: out.variantIndex,
    bucket: out.bucket,
    fellBackToDefault: out.fellBackToDefault,
  });
}

const acceptCaptionSchema = z
  .object({
    postId: z.string().uuid(),
    caption: z.string().min(1).max(64_000),
  })
  .strict();

export async function acceptCaptionAction(
  _prev: unknown,
  input: z.infer<typeof acceptCaptionSchema>,
): Promise<Result<{ postId: string }>> {
  const session = await requireUser();
  authorize(session.role, 'posts:create');

  const parsed = acceptCaptionSchema.safeParse(input);
  if (!parsed.success) {
    return err('VALIDATION_ERROR', 'Caption inválido.');
  }

  const result = await updatePostDraft(
    { orgId: session.orgId, userId: session.userId },
    {
      postId: parsed.data.postId,
      text: parsed.data.caption,
    },
  );
  if (!result.ok) return result;

  try {
    await dbAdmin(async (tx) =>
      tx.insert(auditEvents).values({
        organizationId: session.orgId,
        userId: session.userId,
        actorType: 'user',
        action: 'ai.caption.accepted',
        entityType: 'post',
        entityId: parsed.data.postId,
        after: { length: parsed.data.caption.length },
        riskLevel: 'low',
      }),
    );
  } catch (cause) {
    throw new AppError('INTERNAL_ERROR', 'Failed to audit ai.caption.accepted.', {
      cause,
      meta: { postId: parsed.data.postId },
    });
  }

  revalidatePath(`/publish/composer/${parsed.data.postId}`);
  return ok({ postId: parsed.data.postId });
}
