import 'server-only';

import { eq } from 'drizzle-orm';

import { type AnyPgTx, dbAdmin, dbAs } from '@/lib/db/client';
import { contentAssets, mediaAssets } from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import type { PlanCode } from '@/lib/plans/plans';
import type { AssetKind, AssetListItem } from '@/lib/publish/assets/queries';
import {
  finalizeUpload,
  publicUrlFor,
  requestUpload,
  type RequestUploadResult,
} from '@/lib/storage/media/client';
import { incrementUsage } from '@/lib/usage/counters';

/**
 * Composer ↔ C44 storage bridge (C45 — first real consumer of C44).
 *
 * The composer's media uploader goes through the C44 direct-to-R2 path
 * (presigned PUT, `media_assets` row, `media.process` event, `mediaStorageBytes`
 * quota). To keep the post→publish pipeline UNCHANGED — `posts.media_ids` holds
 * `content_assets` ids and the publish job resolves `content_assets.url` — we
 * PROJECT the finalized `media_assets` record into a `content_assets` library
 * row and hand the composer that row's id.
 *
 * Quota note: the R2 object's bytes are metered once, by C44's
 * `mediaStorageBytes` counter. The projection bumps only the library COUNT
 * (`assetsInLibrary`), NOT `storageBytes`, so the same physical object is never
 * charged against two byte caps. (Trade-off of running two storage subsystems
 * in parallel during the transition — see C45 report.)
 */

const KIND_BY_CONTENT_TYPE: Readonly<Record<string, AssetKind>> = {
  'image/png': 'image',
  'image/jpeg': 'image',
  'image/webp': 'image',
  'image/gif': 'gif',
  'video/mp4': 'video',
  'video/quicktime': 'video',
  'video/webm': 'video',
};

/** Map a C44-allowed content-type to a content_assets `kind`, or null. */
export function kindForContentType(contentType: string): AssetKind | null {
  return KIND_BY_CONTENT_TYPE[contentType] ?? null;
}

// --- DB deps seam (tenant-isolation tests run against pglite) ---------------

export interface ComposerUploadDeps {
  asUser: <T>(
    ctx: { orgId: string; userId: string },
    fn: (tx: AnyPgTx) => Promise<T>,
  ) => Promise<T>;
  asAdmin: <T>(fn: (tx: AnyPgTx) => Promise<T>) => Promise<T>;
}

function defaultDeps(): ComposerUploadDeps {
  return {
    asUser: (ctx, fn) => dbAs(ctx, fn),
    asAdmin: (fn) => dbAdmin(fn),
  };
}

// --- request -----------------------------------------------------------------

export interface RequestComposerUploadResult extends RequestUploadResult {
  /** True when the issued PUT URL is a mock stub — the client skips the PUT. */
  readonly isMock: boolean;
}

/**
 * Validate + reserve a C44 upload (type/size/quota → presigned PUT + pending
 * media_assets row). The client uploads directly to `url`, then calls
 * finalizeComposerUpload. Throws MediaError (mapped to a Result by the action).
 */
export async function requestComposerUpload(opts: {
  orgId: string;
  userId: string;
  plan: PlanCode;
  contentType: string;
  originalFilename: string;
  sizeBytes: number;
}): Promise<RequestComposerUploadResult> {
  const r = await requestUpload(opts);
  return { ...r, isMock: r.url.startsWith('mock://') };
}

// --- finalize + project ------------------------------------------------------

/**
 * Finalize a C44 upload (ready + quota + media.process) and project it into a
 * content_assets library row the composer can attach to `posts.media_ids`.
 *
 * Reads the authoritative key/content-type/size FROM the media_assets row
 * (RLS-scoped) rather than trusting client input — a cross-tenant or tampered
 * assetId resolves to not_found via RLS. Returns the AssetListItem the uploader
 * threads into the composer's attached-assets list.
 */
export async function finalizeComposerUpload(
  opts: {
    orgId: string;
    userId: string;
    assetId: string;
    brandId?: string | null;
  },
  deps: ComposerUploadDeps = defaultDeps(),
): Promise<AssetListItem> {
  // C44: pending→ready, charge mediaStorageBytes, emit media.process. RLS-scoped
  // to the caller's org (foreign/unknown assetId → MediaError not_found).
  await finalizeUpload({
    orgId: opts.orgId,
    userId: opts.userId,
    assetId: opts.assetId,
  });

  // Authoritative attributes come from the row, not the client.
  const assetRows = await deps.asUser<
    Array<{ key: string; contentType: string; sizeBytes: number; originalFilename: string }>
  >({ orgId: opts.orgId, userId: opts.userId }, (tx) =>
    tx
      .select({
        key: mediaAssets.key,
        contentType: mediaAssets.contentType,
        sizeBytes: mediaAssets.sizeBytes,
        originalFilename: mediaAssets.originalFilename,
      })
      .from(mediaAssets)
      .where(eq(mediaAssets.id, opts.assetId))
      .limit(1),
  );
  const asset = assetRows[0];
  if (!asset) {
    throw new AppError('NOT_FOUND', 'Media asset not found after finalize.', {
      meta: { assetId: opts.assetId },
    });
  }

  const kind = kindForContentType(asset.contentType);
  if (!kind) {
    throw new AppError(
      'VALIDATION_ERROR',
      `Unsupported content-type for composer media: ${asset.contentType}.`,
    );
  }

  const url = await publicUrlFor(asset.key);

  const rows = await deps.asUser<Array<{ id: string; createdAt: Date }>>(
    { orgId: opts.orgId, userId: opts.userId },
    (tx) =>
      tx
        .insert(contentAssets)
        .values({
          organizationId: opts.orgId,
          ...(opts.brandId ? { brandId: opts.brandId } : {}),
          kind,
          url,
          name: asset.originalFilename,
          uploadedBy: opts.userId,
          metadata: {
            storageKey: asset.key,
            contentType: asset.contentType,
            bytes: asset.sizeBytes,
            // Back-reference so a future reconcile can tell projected rows from
            // legacy library uploads (their bytes live on mediaStorageBytes).
            mediaAssetId: opts.assetId,
          },
        })
        .returning({ id: contentAssets.id, createdAt: contentAssets.createdAt }),
  );
  const row = rows[0]!;

  // Library COUNT only — bytes are already metered by mediaStorageBytes.
  await deps.asAdmin((tx) => incrementUsage(tx, opts.orgId, 'assetsInLibrary', 1));

  return {
    id: row.id,
    kind,
    name: asset.originalFilename,
    url,
    thumbnailUrl: null,
    brandId: opts.brandId ?? null,
    tags: [],
    usedCount: 0,
    bytes: asset.sizeBytes,
    contentType: asset.contentType,
    storageKey: asset.key,
    createdAt: row.createdAt,
    approved: true,
  };
}
