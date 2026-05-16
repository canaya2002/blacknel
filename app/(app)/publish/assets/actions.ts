'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireUser } from '@/lib/auth/server';
import { authorize } from '@/lib/permissions/can';
import {
  bumpUsedCount,
  deleteAsset,
  uploadAndRecord,
  type UploadAndRecordSuccess,
} from '@/lib/publish/assets/upload';
import { getOrgPlanCode } from '@/lib/queries/plan';
import { err, type Result } from '@/lib/types/result';

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
