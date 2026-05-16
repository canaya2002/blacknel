import 'server-only';

import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';

import { type AnyPgTx, dbAdmin, dbAs } from '@/lib/db/client';
import { auditEvents, contentAssets } from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { getPlanLimit } from '@/lib/plans/limits';
import type { PlanCode } from '@/lib/plans/plans';
import {
  ALLOWED_EXTENSIONS,
  getStorageProvider,
  type AssetKind,
  type StorageProvider,
} from '@/lib/storage';
import { err, ok, type Result } from '@/lib/types/result';
import { checkUsage, incrementUsage, decrementUsage } from '@/lib/usage/counters';

/**
 * Asset-upload orchestrator: validate the file, generate a storage
 * key, write to disk, insert the `content_assets` row, bump the
 * `assetsInLibrary` + `storageBytes` counters, and audit. Wrapped by
 * `uploadAssetAction` so the Server Action stays thin.
 *
 * Three-cap enforcement (D-19b-1 + D-19b-2):
 *
 *   - **Per-file size** — `file.length <= plan.maxAssetSizeBytes`.
 *     Client validates first for fast feedback; this is the
 *     defense-in-depth check.
 *   - **Library count** — `assetsInLibrary + 1 <= plan.assetsInLibrary`.
 *     Read via `checkUsage`.
 *   - **Total storage** — `storageBytes + file.length <= plan.storageBytes`.
 *     Same `checkUsage` machinery, delta=`file.length`.
 *
 * The counters are bumped *after* the storage write + DB insert
 * succeed. If either step fails after the storage write, the
 * orphaned blob is cleaned up by an explicit `provider.delete`
 * call in the catch path. Phase-7 cron will reconcile any drift
 * (TODO.md#audit-events-atomicity covers the audit edge).
 *
 * Delete path lives in the `deleteAssetAction` because it also
 * decrements counters and writes an audit row — same shape, just
 * inverted.
 */

const KIND_BY_EXT: Readonly<Record<string, AssetKind>> = {
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.webp': 'image',
  '.gif': 'gif',
  '.mp4': 'video',
  '.mov': 'video',
  '.webm': 'video',
  '.pdf': 'pdf',
};

export interface ValidateUploadInput {
  readonly bytes: number;
  readonly contentType: string;
  readonly originalFilename: string;
}

export interface ValidatedUpload {
  readonly kind: AssetKind;
  readonly extension: string;
}

const CONTENT_TYPE_BY_KIND: Readonly<Record<AssetKind, ReadonlyArray<string>>> = {
  image: ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'],
  gif: ['image/gif'],
  video: ['video/mp4', 'video/quicktime', 'video/webm'],
  pdf: ['application/pdf'],
};

/**
 * Static (non-DB) validation: extension whitelist, MIME consistency
 * with the inferred kind, non-zero size. Plan-level size enforcement
 * happens in `uploadAndRecord` because it needs the org's plan code.
 */
export function validateUpload(input: ValidateUploadInput): Result<ValidatedUpload> {
  const trimmed = input.originalFilename.trim();
  if (trimmed.length === 0) {
    return err('VALIDATION_ERROR', 'El archivo no tiene nombre.');
  }
  if (input.bytes <= 0) {
    return err('VALIDATION_ERROR', 'El archivo está vacío.');
  }
  const ext = extensionOf(trimmed);
  if (!ext) {
    return err('VALIDATION_ERROR', 'El archivo no tiene extensión reconocible.');
  }
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return err(
      'VALIDATION_ERROR',
      `Tipo no soportado: ${ext}. Permitidos: ${[...ALLOWED_EXTENSIONS].join(', ')}.`,
    );
  }
  const kind = KIND_BY_EXT[ext];
  if (!kind) {
    return err('VALIDATION_ERROR', `Tipo no soportado: ${ext}.`);
  }
  const allowedTypes = CONTENT_TYPE_BY_KIND[kind];
  if (!allowedTypes.includes(input.contentType.toLowerCase())) {
    return err(
      'VALIDATION_ERROR',
      `El tipo MIME ${input.contentType} no coincide con la extensión ${ext}.`,
    );
  }
  return ok({ kind, extension: ext });
}

/**
 * Returns the (assetId, key) pair the orchestrator will use. The
 * key is the provider-relative path `<orgId>/<assetId>.<ext>`.
 */
export function generateAssetKey(orgId: string, extension: string): {
  assetId: string;
  key: string;
} {
  const assetId = randomUUID();
  return { assetId, key: `${orgId}/${assetId}${extension}` };
}

// ---------------------------------------------------------------------------
// uploadAndRecord
// ---------------------------------------------------------------------------

export interface UploadAndRecordOpts {
  readonly orgId: string;
  readonly userId: string;
  readonly planCode: PlanCode;
  readonly file: Buffer;
  readonly originalFilename: string;
  readonly contentType: string;
  readonly brandId?: string | null;
  readonly tags?: ReadonlyArray<string>;
}

/**
 * DI seam for tests. Production callers pass nothing; the
 * implementation falls back to `dbAs` / `dbAdmin` and the
 * singleton storage provider. Integration tests inject
 * transactions backed by the fixture pglite plus a temp-dir
 * storage provider.
 */
export interface AssetUploadDeps {
  asUser: <T>(
    ctx: { orgId: string; userId: string },
    fn: (tx: AnyPgTx) => Promise<T>,
  ) => Promise<T>;
  asAdmin: <T>(fn: (tx: AnyPgTx) => Promise<T>) => Promise<T>;
  storage: StorageProvider;
}

function defaultDeps(): AssetUploadDeps {
  return {
    asUser: (ctx, fn) => dbAs(ctx, fn),
    asAdmin: (fn) => dbAdmin(fn),
    storage: getStorageProvider(),
  };
}

export interface UploadAndRecordSuccess {
  readonly assetId: string;
  readonly url: string;
  readonly bytes: number;
  readonly kind: AssetKind;
}

export async function uploadAndRecord(
  opts: UploadAndRecordOpts,
  deps: AssetUploadDeps = defaultDeps(),
): Promise<Result<UploadAndRecordSuccess>> {
  const validation = validateUpload({
    bytes: opts.file.length,
    contentType: opts.contentType,
    originalFilename: opts.originalFilename,
  });
  if (!validation.ok) return validation;
  const { kind, extension } = validation.data;

  // Per-file size cap (plan).
  const maxBytes = getPlanLimit(opts.planCode, 'maxAssetSizeBytes');
  if (maxBytes !== -1 && opts.file.length > maxBytes) {
    return err(
      'PLAN_LIMIT_REACHED',
      `Archivo de ${formatMb(opts.file.length)} excede el cap del plan ${opts.planCode} (${formatMb(maxBytes)}).`,
      { meta: { bytes: opts.file.length, maxBytes, plan: opts.planCode } },
    );
  }

  // Count + total-bytes caps. Both go through `checkUsage` which
  // is RLS-bypass (admin) — usage_counters is service-only.
  const countCheck = await deps.asAdmin((tx) =>
    checkUsage(tx, opts.orgId, opts.planCode, 'assetsInLibrary', 1),
  );
  if (!countCheck.ok) {
    return err(
      'PLAN_LIMIT_REACHED',
      `Has alcanzado el cupo de assets para el plan ${opts.planCode} (${countCheck.current} / ${countCheck.cap}).`,
      { meta: { ...countCheck } },
    );
  }

  const storageCheck = await deps.asAdmin((tx) =>
    checkUsage(tx, opts.orgId, opts.planCode, 'storageBytes', opts.file.length),
  );
  if (!storageCheck.ok) {
    return err(
      'PLAN_LIMIT_REACHED',
      `Subir este archivo supera el espacio disponible (${formatMb(storageCheck.current)} / ${formatMb(storageCheck.cap)}).`,
      { meta: { ...storageCheck } },
    );
  }

  const { assetId, key } = generateAssetKey(opts.orgId, extension);
  const provider = deps.storage;

  let stored;
  try {
    stored = await provider.upload(opts.file, {
      orgId: opts.orgId,
      assetId,
      originalFilename: opts.originalFilename,
      contentType: opts.contentType,
      kind,
    });
  } catch (cause) {
    throw new AppError('INTERNAL_ERROR', 'Storage write failed.', {
      cause,
      meta: { orgId: opts.orgId, assetId, key },
    });
  }

  // Insert the DB row. Rollback the storage write if the insert
  // fails so we don't leave an orphaned blob behind.
  try {
    await deps.asUser(
      { orgId: opts.orgId, userId: opts.userId },
      async (tx) =>
        tx.insert(contentAssets).values({
          id: assetId,
          organizationId: opts.orgId,
          ...(opts.brandId ? { brandId: opts.brandId } : {}),
          kind,
          url: provider.getUrl(stored.key),
          name: opts.originalFilename,
          ...(opts.tags?.length ? { tags: [...opts.tags] } : {}),
          uploadedBy: opts.userId,
          metadata: {
            storageKey: stored.key,
            contentType: stored.contentType,
            bytes: stored.bytes,
          },
        }),
    );
  } catch (cause) {
    await provider.delete(stored.key).catch(() => {});
    throw new AppError('INTERNAL_ERROR', 'Failed to insert content_assets row.', {
      cause,
      meta: { orgId: opts.orgId, assetId, key: stored.key },
    });
  }

  // Bump counters and write audit. Failures from these don't
  // un-create the asset — Phase 7 reconcile catches drift.
  try {
    await deps.asAdmin(async (tx) => {
      await incrementUsage(tx, opts.orgId, 'assetsInLibrary', 1);
      await incrementUsage(tx, opts.orgId, 'storageBytes', stored.bytes);
    });
  } catch (cause) {
    throw new AppError('INTERNAL_ERROR', 'Failed to bump usage counters after upload.', {
      cause,
      meta: { orgId: opts.orgId, assetId },
    });
  }

  await writeAuditWith(deps, {
    orgId: opts.orgId,
    userId: opts.userId,
    action: 'asset.uploaded',
    entityId: assetId,
    after: {
      kind,
      bytes: stored.bytes,
      filename: opts.originalFilename,
      contentType: stored.contentType,
    },
  });

  return ok({
    assetId,
    url: provider.getUrl(stored.key),
    bytes: stored.bytes,
    kind,
  });
}

// ---------------------------------------------------------------------------
// Delete path
// ---------------------------------------------------------------------------

export interface DeleteAssetOpts {
  readonly orgId: string;
  readonly userId: string;
  readonly assetId: string;
}

export interface DeleteAssetSuccess {
  readonly assetId: string;
  readonly freedBytes: number;
}

export async function deleteAsset(
  opts: DeleteAssetOpts,
): Promise<Result<DeleteAssetSuccess>> {
  // Read the row before deletion so we know its bytes for the
  // counter decrement.
  const rows = await dbAs<
    Array<{ id: string; metadata: unknown; usedCount: number }>
  >({ orgId: opts.orgId, userId: opts.userId }, async (tx) =>
    tx
      .select({
        id: contentAssets.id,
        metadata: contentAssets.metadata,
        usedCount: contentAssets.usedCount,
      })
      .from(contentAssets)
      .where(
        and(
          eq(contentAssets.id, opts.assetId),
          eq(contentAssets.organizationId, opts.orgId),
        ),
      )
      .limit(1),
  );
  const row = rows[0];
  if (!row) return err('NOT_FOUND', 'Asset no encontrado.');

  if (row.usedCount > 0) {
    return err(
      'CONFLICT',
      `Este asset está en uso por ${row.usedCount} post${row.usedCount === 1 ? '' : 's'}. Desvincúlalo antes de eliminar.`,
      { meta: { usedCount: row.usedCount } },
    );
  }

  const md = isObject(row.metadata) ? (row.metadata as Record<string, unknown>) : {};
  const bytes = typeof md.bytes === 'number' ? md.bytes : 0;
  const storageKey = typeof md.storageKey === 'string' ? md.storageKey : null;

  // Soft-delete from DB first, then attempt storage cleanup. If
  // the storage delete fails we keep the row gone — a Phase 7
  // cron sweeps orphaned blobs (TODO.md#audit-events-atomicity
  // captures the related atomicity work).
  await dbAs({ orgId: opts.orgId, userId: opts.userId }, (tx) =>
    tx.delete(contentAssets).where(eq(contentAssets.id, opts.assetId)),
  );

  if (storageKey) {
    const provider = getStorageProvider();
    await provider.delete(storageKey).catch(() => {});
  }

  // Decrement counters.
  try {
    await dbAdmin(async (tx) => {
      await decrementUsage(tx, opts.orgId, 'assetsInLibrary', 1);
      if (bytes > 0) {
        await decrementUsage(tx, opts.orgId, 'storageBytes', bytes);
      }
    });
  } catch (cause) {
    throw new AppError('INTERNAL_ERROR', 'Failed to decrement usage counters after delete.', {
      cause,
      meta: { orgId: opts.orgId, assetId: opts.assetId },
    });
  }

  await writeAudit({
    orgId: opts.orgId,
    userId: opts.userId,
    action: 'asset.deleted',
    entityId: opts.assetId,
    before: { bytes, storageKey },
  });

  return ok({ assetId: opts.assetId, freedBytes: bytes });
}

// ---------------------------------------------------------------------------
// used_count diff (called by attach / detach actions)
// ---------------------------------------------------------------------------

export async function bumpUsedCount(opts: {
  orgId: string;
  userId: string;
  assetId: string;
  delta: number;
}): Promise<Result<{ assetId: string; usedCount: number }>> {
  if (opts.delta === 0) {
    return err('VALIDATION_ERROR', 'delta=0 no es válido.');
  }
  const rows = await dbAs<Array<{ usedCount: number }>>(
    { orgId: opts.orgId, userId: opts.userId },
    async (tx) =>
      tx
        .update(contentAssets)
        .set({
          usedCount: sql`GREATEST(0, ${contentAssets.usedCount} + ${opts.delta})`,
        })
        .where(
          and(
            eq(contentAssets.id, opts.assetId),
            eq(contentAssets.organizationId, opts.orgId),
          ),
        )
        .returning({ usedCount: contentAssets.usedCount }),
  );
  const row = rows[0];
  if (!row) return err('NOT_FOUND', 'Asset no encontrado.');
  return ok({ assetId: opts.assetId, usedCount: row.usedCount });
}

// ---------------------------------------------------------------------------
// Audit helper
// ---------------------------------------------------------------------------

interface AuditInput {
  orgId: string;
  userId: string;
  action: string;
  entityId: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

async function writeAudit(input: AuditInput): Promise<void> {
  return writeAuditWith(defaultDeps(), input);
}

async function writeAuditWith(deps: AssetUploadDeps, input: AuditInput): Promise<void> {
  try {
    await deps.asAdmin(async (tx) =>
      tx.insert(auditEvents).values({
        organizationId: input.orgId,
        userId: input.userId,
        actorType: 'user',
        action: input.action,
        entityType: 'content_asset',
        entityId: input.entityId,
        ...(input.before !== undefined ? { before: input.before } : {}),
        ...(input.after !== undefined ? { after: input.after } : {}),
        riskLevel: 'low',
      }),
    );
  } catch (cause) {
    throw new AppError('INTERNAL_ERROR', 'Failed to write audit event for asset.', {
      cause,
      meta: { action: input.action, entityId: input.entityId },
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extensionOf(filename: string): string {
  const idx = filename.lastIndexOf('.');
  if (idx === -1) return '';
  return filename.slice(idx).toLowerCase();
}

function formatMb(bytes: number): string {
  if (bytes === -1) return '∞';
  const mb = bytes / 1_000_000;
  if (mb >= 100) return `${Math.round(mb)} MB`;
  return `${mb.toFixed(1)} MB`;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
