import 'server-only';

import { randomUUID } from 'node:crypto';

import { and, desc, eq, lt } from 'drizzle-orm';

import { dbAdmin, dbAs, type AnyPgTx } from '@/lib/db/client';
import { mediaAssets } from '@/lib/db/schema';
import { env } from '@/lib/env';
import { isFlagOn } from '@/lib/flags';
import { tryEmit } from '@/lib/inngest/client';
import { log } from '@/lib/log';
import type { PlanCode } from '@/lib/plans/plans';
import { checkUsage, decrementUsage, incrementUsage } from '@/lib/usage/counters';

import { mockAdapter } from './adapter-mock';
import {
  ALLOWED_MEDIA_CONTENT_TYPES,
  EXT_FOR_CONTENT_TYPE,
  MAX_MEDIA_BYTES,
  type MediaStorageAdapter,
} from './types';

/**
 * High-level media storage (C44): tenant-scoped (every DB op runs under
 * dbAs(orgId) so RLS isolates orgs), quota-gated (mediaStorageBytes counter vs
 * plan cap), flag-gated (real R2 only when R2_* env present AND
 * use_real_storage='on', else in-memory mock — fail-safe). Direct-to-R2 via
 * presigned PUT; files never proxy through Vercel functions. Secrets stay
 * server-side.
 */

const MEDIA_METRIC = 'mediaStorageBytes' as const;

export type MediaErrorCode =
  | 'invalid_type'
  | 'too_large'
  | 'quota_exceeded'
  | 'not_found';

export class MediaError extends Error {
  readonly code: MediaErrorCode;
  constructor(code: MediaErrorCode, message: string) {
    super(message);
    this.name = 'MediaError';
    this.code = code;
  }
}

// --- adapter resolution (flag + keys), fail-safe to mock -------------------

function r2KeysPresent(): boolean {
  return Boolean(
    env.R2_ACCOUNT_ID &&
      env.R2_ACCESS_KEY_ID &&
      env.R2_SECRET_ACCESS_KEY &&
      env.R2_BUCKET,
  );
}

let adapterOverride: MediaStorageAdapter | null = null;
export function _setMediaAdapterForTests(a: MediaStorageAdapter | null): void {
  adapterOverride = a;
}

async function resolveAdapter(): Promise<MediaStorageAdapter> {
  if (adapterOverride) return adapterOverride;
  if (r2KeysPresent() && (await isFlagOn('use_real_storage'))) {
    const { r2Adapter } = await import('./adapter-r2');
    return r2Adapter;
  }
  return mockAdapter;
}

function bucketName(): string {
  return env.R2_BUCKET ?? 'blacknel-media-dev';
}

/**
 * Resolve the durable public URL for an object key (CDN URL when
 * R2_PUBLIC_BASE_URL is configured + real adapter, else a `mock://` stub).
 * Used by consumers that persist a long-lived reference to the object (e.g. the
 * composer projecting a media_assets upload into a content_assets library row).
 */
export async function publicUrlFor(key: string): Promise<string> {
  const adapter = await resolveAdapter();
  return adapter.publicUrl(key);
}

// --- DB deps seam (tenant-isolation tests run against pglite) ---------------

type RunAsFn = <T>(
  ctx: { orgId: string; userId: string },
  fn: (tx: AnyPgTx) => Promise<T>,
) => Promise<T>;
type RunAdminFn = <T>(fn: (tx: AnyPgTx) => Promise<T>) => Promise<T>;

let asUser: RunAsFn = dbAs;
let asAdmin: RunAdminFn = dbAdmin;

export function _setMediaDbDepsForTests(d: {
  asUser: RunAsFn;
  asAdmin: RunAdminFn;
}): void {
  asUser = d.asUser;
  asAdmin = d.asAdmin;
}
export function _resetMediaDbDepsForTests(): void {
  asUser = dbAs;
  asAdmin = dbAdmin;
}

// --- ops -------------------------------------------------------------------

export interface RequestUploadInput {
  readonly orgId: string;
  readonly userId: string;
  readonly plan: PlanCode;
  readonly contentType: string;
  readonly originalFilename: string;
  readonly sizeBytes: number;
}

export interface RequestUploadResult {
  readonly assetId: string;
  readonly key: string;
  readonly bucket: string;
  readonly url: string;
  readonly expiresInSec: number;
}

/**
 * Validate type/size/quota → presigned PUT URL → record a `pending`
 * media_assets row. Client uploads directly to R2 then calls finalizeUpload.
 */
export async function requestUpload(
  p: RequestUploadInput,
): Promise<RequestUploadResult> {
  if (!ALLOWED_MEDIA_CONTENT_TYPES.has(p.contentType)) {
    throw new MediaError('invalid_type', `Unsupported content-type: ${p.contentType}.`);
  }
  if (!Number.isFinite(p.sizeBytes) || p.sizeBytes <= 0 || p.sizeBytes > MAX_MEDIA_BYTES) {
    throw new MediaError('too_large', `Invalid/oversized upload: ${p.sizeBytes} bytes.`);
  }

  // Counter ops run under service_role (admin) — usage_counters grants only
  // SELECT to `authenticated`; all writes (and, for consistency with
  // lib/publish/usage-check.ts, the pre-flight check) go through admin, scoped
  // by the explicit orgId arg (not RLS context).
  const quota = await asAdmin((tx) =>
    checkUsage(tx, p.orgId, p.plan, MEDIA_METRIC, p.sizeBytes),
  );
  if (!quota.ok) {
    throw new MediaError(
      'quota_exceeded',
      `Media storage quota reached (${quota.current} + ${p.sizeBytes} > ${quota.cap} bytes).`,
    );
  }

  const ext = EXT_FOR_CONTENT_TYPE[p.contentType] ?? 'bin';
  const key = `orgs/${p.orgId}/media/${randomUUID()}.${ext}`;
  const bucket = bucketName();

  const adapter = await resolveAdapter();
  const { url, expiresInSec } = await adapter.presignUpload(bucket, key, p.contentType);

  const rows = await asUser<Array<{ id: string }>>(
    { orgId: p.orgId, userId: p.userId },
    (tx) =>
      tx
        .insert(mediaAssets)
        .values({
          organizationId: p.orgId,
          key,
          bucket,
          contentType: p.contentType,
          sizeBytes: p.sizeBytes,
          originalFilename: p.originalFilename,
          uploadedBy: p.userId,
          status: 'pending',
        })
        .returning({ id: mediaAssets.id }),
  );

  return { assetId: rows[0]!.id, key, bucket, url, expiresInSec };
}

/**
 * Mark a pending upload ready + charge the quota counter (one tx, RLS-scoped),
 * then emit media.process for post-processing (best-effort; inline-skip when
 * Inngest is off — processing is optional).
 */
export async function finalizeUpload(p: {
  orgId: string;
  userId: string;
  assetId: string;
}): Promise<void> {
  // Flip pending→ready under the caller's RLS context (org-scoped). The counter
  // bump runs separately under admin (usage_counters is admin-write only).
  const sizeBytes = await asUser(
    { orgId: p.orgId, userId: p.userId },
    async (tx) => {
      const rows = (await tx
        .update(mediaAssets)
        .set({ status: 'ready', updatedAt: new Date() })
        .where(
          and(eq(mediaAssets.id, p.assetId), eq(mediaAssets.status, 'pending')),
        )
        .returning({ sizeBytes: mediaAssets.sizeBytes })) as Array<{
        sizeBytes: number;
      }>;
      const row = rows[0];
      if (!row) {
        throw new MediaError(
          'not_found',
          'Pending media asset not found for this org.',
        );
      }
      return row.sizeBytes;
    },
  );
  await asAdmin((tx) => incrementUsage(tx, p.orgId, MEDIA_METRIC, sizeBytes));

  await tryEmit('media.process', { orgId: p.orgId, assetId: p.assetId });
}

/**
 * Soft-delete (status='deleted') + remove the R2 object + release quota. RLS
 * ensures the asset belongs to the caller's org; a cross-tenant id resolves to
 * not_found. Idempotent on already-deleted rows.
 */
export async function deleteAsset(p: {
  orgId: string;
  userId: string;
  assetId: string;
}): Promise<void> {
  const target = await asUser<
    Array<{ key: string; bucket: string; status: string; sizeBytes: number }>
  >({ orgId: p.orgId, userId: p.userId }, async (tx) => {
    const sel = (await tx
      .select({
        key: mediaAssets.key,
        bucket: mediaAssets.bucket,
        status: mediaAssets.status,
        sizeBytes: mediaAssets.sizeBytes,
      })
      .from(mediaAssets)
      .where(eq(mediaAssets.id, p.assetId))
      .limit(1)) as Array<{
      key: string;
      bucket: string;
      status: string;
      sizeBytes: number;
    }>;
    if (!sel[0]) return [];
    if (sel[0].status === 'deleted') return sel; // idempotent
    await tx
      .update(mediaAssets)
      .set({ status: 'deleted', updatedAt: new Date() })
      .where(eq(mediaAssets.id, p.assetId));
    return sel;
  });

  const row = target[0];
  if (!row) {
    throw new MediaError('not_found', 'Media asset not found for this org.');
  }
  // Release the quota under admin (usage_counters is admin-write only). `row`
  // is the pre-update snapshot, so `status === 'ready'` means it was counted.
  if (row.status === 'ready') {
    await asAdmin((tx) => decrementUsage(tx, p.orgId, MEDIA_METRIC, row.sizeBytes));
  }
  if (row.status !== 'deleted') {
    const adapter = await resolveAdapter();
    await adapter.deleteObject(row.bucket, row.key).catch((err: unknown) => {
      // DB row is already marked deleted; a storage-delete failure is logged
      // and reaped later (the object is unreferenced). Don't fail the request.
      log.error(
        { assetId: p.assetId, err: (err as Error).message },
        'media.delete_object_failed',
      );
    });
  }
}

/** Presigned download URL for a ready asset (RLS-scoped to the caller's org). */
export async function getDownloadUrl(p: {
  orgId: string;
  userId: string;
  assetId: string;
}): Promise<string> {
  const rows = await asUser<Array<{ key: string; bucket: string; status: string }>>(
    { orgId: p.orgId, userId: p.userId },
    (tx) =>
      tx
        .select({
          key: mediaAssets.key,
          bucket: mediaAssets.bucket,
          status: mediaAssets.status,
        })
        .from(mediaAssets)
        .where(eq(mediaAssets.id, p.assetId))
        .limit(1),
  );
  const row = rows[0];
  if (!row || row.status !== 'ready') {
    throw new MediaError('not_found', 'Ready media asset not found for this org.');
  }
  const adapter = await resolveAdapter();
  return adapter.presignDownload(row.bucket, row.key);
}

export interface MediaListItem {
  readonly id: string;
  readonly key: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly status: string;
  readonly originalFilename: string;
  readonly createdAt: Date;
}

/** List the org's media (RLS-scoped). Defaults to ready assets. */
export async function listAssets(p: {
  orgId: string;
  userId: string;
  status?: 'pending' | 'ready' | 'deleted';
}): Promise<ReadonlyArray<MediaListItem>> {
  const status = p.status ?? 'ready';
  return asUser({ orgId: p.orgId, userId: p.userId }, (tx) =>
    tx
      .select({
        id: mediaAssets.id,
        key: mediaAssets.key,
        contentType: mediaAssets.contentType,
        sizeBytes: mediaAssets.sizeBytes,
        status: mediaAssets.status,
        originalFilename: mediaAssets.originalFilename,
        createdAt: mediaAssets.createdAt,
      })
      .from(mediaAssets)
      .where(
        and(
          eq(mediaAssets.organizationId, p.orgId),
          eq(mediaAssets.status, status),
        ),
      )
      .orderBy(desc(mediaAssets.createdAt)),
  ) as Promise<ReadonlyArray<MediaListItem>>;
}

/**
 * Used by the cleanup-pending-uploads cron (admin path — runs over all orgs).
 * Reaps `pending` rows older than `olderThanMs` + their R2 objects. The org id
 * lives on each row, so this is org-correct even running admin.
 */
export async function reapStalePendingUploads(olderThanMs: number): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs);
  const stale = await asAdmin<Array<{ id: string; key: string; bucket: string }>>(
    (tx) =>
      tx
        .select({
          id: mediaAssets.id,
          key: mediaAssets.key,
          bucket: mediaAssets.bucket,
        })
        .from(mediaAssets)
        .where(
          and(
            eq(mediaAssets.status, 'pending'),
            lt(mediaAssets.createdAt, cutoff),
          ),
        ),
  );

  const adapter = await resolveAdapter();
  let reaped = 0;
  for (const row of stale) {
    await adapter.deleteObject(row.bucket, row.key).catch(() => {});
    await asAdmin((tx) =>
      tx
        .update(mediaAssets)
        .set({ status: 'deleted', updatedAt: new Date() })
        .where(eq(mediaAssets.id, row.id)),
    );
    reaped += 1;
  }
  return reaped;
}
