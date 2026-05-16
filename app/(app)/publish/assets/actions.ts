'use server';

import { and, desc, eq, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireUser } from '@/lib/auth/server';
import { dbAdmin, dbAs } from '@/lib/db/client';
import { auditEvents, posts } from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { authorize } from '@/lib/permissions/can';
import {
  bumpUsedCount,
  deleteAsset,
  uploadAndRecord,
  type UploadAndRecordSuccess,
} from '@/lib/publish/assets/upload';
import { getOrgPlanCode } from '@/lib/queries/plan';
import { err, ok, type Result } from '@/lib/types/result';

/**
 * Server Actions for the asset library + composer media flow.
 *
 *   - `uploadAssetAction` — multipart upload from
 *     `<MediaUploader />` or the asset-library page.
 *   - `deleteAssetAction` — soft delete + storage cleanup.
 *   - `attachAssetToPostAction` / `detachAssetFromPostAction` —
 *     used_count diff. The composer fires these when the user
 *     toggles an asset on the post's media tray.
 *
 * Auth: `posts:create` covers asset mutations (uploading is part
 * of the publishing workflow). A future "Asset Manager" role
 * could relax this — Phase 10.
 */

// ---------------------------------------------------------------------------
// uploadAssetAction
// ---------------------------------------------------------------------------

const BRAND_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function uploadAssetAction(
  _prev: unknown,
  formData: FormData,
): Promise<Result<UploadAndRecordSuccess>> {
  const session = await requireUser();
  authorize(session.role, 'posts:create');

  const file = formData.get('file');
  if (!(file instanceof File)) {
    return err('VALIDATION_ERROR', 'Falta el archivo a subir.');
  }
  if (file.size === 0) {
    return err('VALIDATION_ERROR', 'El archivo está vacío.');
  }

  const rawBrandId = formData.get('brandId');
  const brandId =
    typeof rawBrandId === 'string' && BRAND_ID_RE.test(rawBrandId)
      ? rawBrandId
      : null;

  const rawTags = formData.get('tags');
  let tags: string[] = [];
  if (typeof rawTags === 'string' && rawTags.length > 0) {
    tags = rawTags
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0 && t.length <= 40)
      .slice(0, 20);
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const plan = await getOrgPlanCode(session);

  return uploadAndRecord({
    orgId: session.orgId,
    userId: session.userId,
    planCode: plan,
    file: buffer,
    originalFilename: file.name,
    contentType: file.type || 'application/octet-stream',
    ...(brandId ? { brandId } : {}),
    ...(tags.length > 0 ? { tags } : {}),
  }).then((result) => {
    if (result.ok) {
      revalidatePath('/publish/assets');
    }
    return result;
  });
}

// ---------------------------------------------------------------------------
// deleteAssetAction
// ---------------------------------------------------------------------------

const deleteSchema = z.object({
  assetId: z.string().uuid(),
});

export async function deleteAssetAction(
  _prev: unknown,
  input: z.infer<typeof deleteSchema>,
): Promise<Result<{ assetId: string; freedBytes: number }>> {
  const session = await requireUser();
  authorize(session.role, 'posts:create');

  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) {
    return err('VALIDATION_ERROR', 'ID de asset inválido.');
  }

  const result = await deleteAsset({
    orgId: session.orgId,
    userId: session.userId,
    assetId: parsed.data.assetId,
  });
  if (result.ok) {
    revalidatePath('/publish/assets');
  }
  return result;
}

// ---------------------------------------------------------------------------
// attach / detach
// ---------------------------------------------------------------------------

const usedCountSchema = z.object({
  assetId: z.string().uuid(),
});

export async function attachAssetToPostAction(
  _prev: unknown,
  input: z.infer<typeof usedCountSchema>,
): Promise<Result<{ assetId: string; usedCount: number }>> {
  const session = await requireUser();
  authorize(session.role, 'posts:create');
  const parsed = usedCountSchema.safeParse(input);
  if (!parsed.success) return err('VALIDATION_ERROR', 'ID de asset inválido.');

  const result = await bumpUsedCount({
    orgId: session.orgId,
    userId: session.userId,
    assetId: parsed.data.assetId,
    delta: 1,
  });
  if (result.ok) revalidatePath('/publish/assets');
  return result;
}

export async function detachAssetFromPostAction(
  _prev: unknown,
  input: z.infer<typeof usedCountSchema>,
): Promise<Result<{ assetId: string; usedCount: number }>> {
  const session = await requireUser();
  authorize(session.role, 'posts:create');
  const parsed = usedCountSchema.safeParse(input);
  if (!parsed.success) return err('VALIDATION_ERROR', 'ID de asset inválido.');

  const result = await bumpUsedCount({
    orgId: session.orgId,
    userId: session.userId,
    assetId: parsed.data.assetId,
    delta: -1,
  });
  if (result.ok) revalidatePath('/publish/assets');
  return result;
}

// ---------------------------------------------------------------------------
// createDraftFromAssetAction — "Usar en post nuevo" (Commit 19c.3)
// ---------------------------------------------------------------------------

const createFromAssetSchema = z.object({
  assetId: z.string().uuid(),
});

export async function createDraftFromAssetAction(
  _prev: unknown,
  input: z.infer<typeof createFromAssetSchema>,
): Promise<Result<{ postId: string }>> {
  const session = await requireUser();
  authorize(session.role, 'posts:create');
  const parsed = createFromAssetSchema.safeParse(input);
  if (!parsed.success) return err('VALIDATION_ERROR', 'ID de asset inválido.');

  let postId: string;
  try {
    const rows = await dbAs<Array<{ id: string }>>(
      { orgId: session.orgId, userId: session.userId },
      (tx) =>
        tx
          .insert(posts)
          .values({
            organizationId: session.orgId,
            authorId: session.userId,
            status: 'draft',
            text: '',
            mediaIds: [parsed.data.assetId],
          })
          .returning({ id: posts.id }),
    );
    postId = rows[0]!.id;
  } catch (cause) {
    throw new AppError(
      'INTERNAL_ERROR',
      'Failed to create draft from asset.',
      { cause, meta: { assetId: parsed.data.assetId } },
    );
  }

  const bump = await bumpUsedCount({
    orgId: session.orgId,
    userId: session.userId,
    assetId: parsed.data.assetId,
    delta: 1,
  });
  if (!bump.ok) return bump;

  try {
    await dbAdmin(async (tx) =>
      tx.insert(auditEvents).values({
        organizationId: session.orgId,
        userId: session.userId,
        actorType: 'user',
        action: 'post.draft.opened_from_asset',
        entityType: 'post',
        entityId: postId,
        after: { assetId: parsed.data.assetId },
        riskLevel: 'low',
      }),
    );
  } catch (cause) {
    throw new AppError(
      'INTERNAL_ERROR',
      'Failed to audit createDraftFromAsset.',
      { cause, meta: { postId } },
    );
  }

  revalidatePath('/publish/assets');
  revalidatePath('/publish');
  return ok({ postId });
}

// ---------------------------------------------------------------------------
// attachToExistingDraftAction — "Usar en post existente"
// ---------------------------------------------------------------------------

const attachToDraftSchema = z.object({
  postId: z.string().uuid(),
  assetId: z.string().uuid(),
});

export async function attachToExistingDraftAction(
  _prev: unknown,
  input: z.infer<typeof attachToDraftSchema>,
): Promise<Result<{ postId: string; assetId: string }>> {
  const session = await requireUser();
  authorize(session.role, 'posts:create');
  const parsed = attachToDraftSchema.safeParse(input);
  if (!parsed.success) return err('VALIDATION_ERROR', 'Datos inválidos.');

  // Load the target post + verify it's editable. The action is
  // idempotent: if the asset is already in `media_ids`, the
  // `used_count` is NOT incremented again.
  const rows = await dbAs<Array<{ id: string; status: string; mediaIds: unknown }>>(
    { orgId: session.orgId, userId: session.userId },
    (tx) =>
      tx
        .select({
          id: posts.id,
          status: posts.status,
          mediaIds: posts.mediaIds,
        })
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
      `No se puede adjuntar media a un post en estado ${row.status}.`,
    );
  }
  const existing = Array.isArray(row.mediaIds) ? (row.mediaIds as string[]) : [];
  if (existing.includes(parsed.data.assetId)) {
    // Idempotent — no change. Return ok with the existing state.
    return ok({ postId: parsed.data.postId, assetId: parsed.data.assetId });
  }

  await dbAs({ orgId: session.orgId, userId: session.userId }, (tx) =>
    tx
      .update(posts)
      .set({ mediaIds: [...existing, parsed.data.assetId] })
      .where(
        and(eq(posts.id, parsed.data.postId), eq(posts.organizationId, session.orgId)),
      ),
  );

  const bump = await bumpUsedCount({
    orgId: session.orgId,
    userId: session.userId,
    assetId: parsed.data.assetId,
    delta: 1,
  });
  if (!bump.ok) return bump;

  try {
    await dbAdmin(async (tx) =>
      tx.insert(auditEvents).values({
        organizationId: session.orgId,
        userId: session.userId,
        actorType: 'user',
        action: 'post.media.attached_from_library',
        entityType: 'post',
        entityId: parsed.data.postId,
        after: { assetId: parsed.data.assetId },
        riskLevel: 'low',
      }),
    );
  } catch (cause) {
    throw new AppError(
      'INTERNAL_ERROR',
      'Failed to audit attachToExistingDraft.',
      { cause, meta: { postId: parsed.data.postId } },
    );
  }

  revalidatePath(`/publish/composer/${parsed.data.postId}`);
  revalidatePath('/publish/assets');
  return ok({ postId: parsed.data.postId, assetId: parsed.data.assetId });
}

// ---------------------------------------------------------------------------
// listDraftsForAttachAction — small picker feed for the drawer
// ---------------------------------------------------------------------------

export interface DraftListItem {
  readonly id: string;
  readonly text: string;
  readonly createdAt: string;
  readonly status: string;
}

export async function listDraftsForAttachAction(): Promise<Result<ReadonlyArray<DraftListItem>>> {
  const session = await requireUser();
  authorize(session.role, 'posts:read');

  type Row = { id: string; text: string; status: string; createdAt: Date };
  const rows = await dbAs<Row[]>(
    { orgId: session.orgId, userId: session.userId },
    (tx) =>
      tx
        .select({
          id: posts.id,
          text: posts.text,
          status: posts.status,
          createdAt: posts.createdAt,
        })
        .from(posts)
        .where(
          and(
            eq(posts.organizationId, session.orgId),
            sql`${posts.status} IN ('draft', 'pending_approval')`,
          ),
        )
        .orderBy(desc(posts.createdAt))
        .limit(20),
  );

  return ok(
    rows.map(
      (r): DraftListItem => ({
        id: r.id,
        text: r.text,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
      }),
    ),
  );
}
