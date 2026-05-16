import 'server-only';

import { and, asc, count, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';

import { type AnyPgTx, dbAs } from '@/lib/db/client';
import { contentAssets } from '@/lib/db/schema';

/**
 * Read paths for the asset library.
 *
 *   - `listAssetsForOrg` / `listAssetsWithTx` — paginated list with
 *     brand / kind / tag / search filters and three sort modes
 *     (recent, mostUsed, name).
 *   - `getAssetById` — single asset for the detail drawer.
 *   - `getAssetsCountForOrg` — feeds the assetsInLibrary counter
 *     refresh path (Phase-11 reconcile job will re-sync drift).
 *
 * Write helpers live in `lib/publish/assets/upload.ts` (insert) and
 * the Server Actions (delete / used-count diff).
 */

export type AssetKind = 'image' | 'video' | 'pdf' | 'gif';

const ALLOWED_KINDS: ReadonlyArray<AssetKind> = ['image', 'video', 'pdf', 'gif'];
const ALLOWED_SORTS = ['recent', 'mostUsed', 'name'] as const;
export type AssetSort = (typeof ALLOWED_SORTS)[number];
export { ALLOWED_KINDS, ALLOWED_SORTS };

export interface AssetListItem {
  readonly id: string;
  readonly kind: AssetKind;
  readonly name: string;
  readonly url: string;
  readonly thumbnailUrl: string | null;
  readonly brandId: string | null;
  readonly tags: ReadonlyArray<string>;
  readonly usedCount: number;
  readonly bytes: number;
  readonly contentType: string | null;
  readonly storageKey: string | null;
  readonly createdAt: Date;
  readonly approved: boolean;
}

export interface AssetListFilters {
  readonly brandId?: string;
  readonly kind?: AssetKind;
  readonly tag?: string;
  readonly q?: string;
  readonly sort?: AssetSort;
  /** When true, only approved assets are returned. */
  readonly approvedOnly?: boolean;
}

export interface AssetListPage {
  readonly assets: ReadonlyArray<AssetListItem>;
  readonly nextCursor: string | null;
}

export interface ListAssetsOpts {
  readonly orgId: string;
  readonly userId: string;
  readonly filters: AssetListFilters;
  readonly pageSize?: number;
  /** Opaque cursor returned by a previous call. */
  readonly cursor?: string | null;
}

const DEFAULT_PAGE_SIZE = 48;
const MAX_PAGE_SIZE = 200;

export async function listAssetsForOrg(opts: ListAssetsOpts): Promise<AssetListPage> {
  return dbAs({ orgId: opts.orgId, userId: opts.userId }, async (tx) =>
    listAssetsWithTx(tx, opts),
  );
}

export async function listAssetsWithTx(
  tx: AnyPgTx,
  opts: ListAssetsOpts,
): Promise<AssetListPage> {
  const pageSize = Math.min(opts.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const sort: AssetSort = opts.filters.sort ?? 'recent';

  const conditions: SQL[] = [eq(contentAssets.organizationId, opts.orgId)];

  if (opts.filters.brandId) {
    conditions.push(eq(contentAssets.brandId, opts.filters.brandId));
  }
  if (opts.filters.kind) {
    conditions.push(eq(contentAssets.kind, opts.filters.kind));
  }
  if (opts.filters.tag) {
    // jsonb `tags` is an array of strings; the `?` operator works
    // for element membership.
    conditions.push(sql`${contentAssets.tags} ? ${opts.filters.tag}`);
  }
  if (opts.filters.q) {
    const escaped = '%' + opts.filters.q.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
    conditions.push(sql`${contentAssets.name} ILIKE ${escaped}`);
  }
  if (opts.filters.approvedOnly) {
    conditions.push(eq(contentAssets.approved, true));
  }
  applyCursor(conditions, sort, opts.cursor);

  type Row = {
    id: string;
    kind: AssetKind;
    name: string;
    url: string;
    thumbnailUrl: string | null;
    brandId: string | null;
    tags: unknown;
    usedCount: number;
    metadata: unknown;
    createdAt: Date;
    approved: boolean;
  };

  const rows: Row[] = await tx
    .select({
      id: contentAssets.id,
      kind: contentAssets.kind,
      name: contentAssets.name,
      url: contentAssets.url,
      thumbnailUrl: contentAssets.thumbnailUrl,
      brandId: contentAssets.brandId,
      tags: contentAssets.tags,
      usedCount: contentAssets.usedCount,
      metadata: contentAssets.metadata,
      createdAt: contentAssets.createdAt,
      approved: contentAssets.approved,
    })
    .from(contentAssets)
    .where(and(...conditions))
    .orderBy(...orderByFor(sort))
    .limit(pageSize + 1);

  const hasMore = rows.length > pageSize;
  const visible = hasMore ? rows.slice(0, pageSize) : rows;

  const assets = visible.map((r): AssetListItem => {
    const md = isObject(r.metadata) ? (r.metadata as Record<string, unknown>) : {};
    return {
      id: r.id,
      kind: r.kind,
      name: r.name,
      url: r.url,
      thumbnailUrl: r.thumbnailUrl,
      brandId: r.brandId,
      tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
      usedCount: r.usedCount,
      bytes: typeof md.bytes === 'number' ? md.bytes : 0,
      contentType: typeof md.contentType === 'string' ? md.contentType : null,
      storageKey: typeof md.storageKey === 'string' ? md.storageKey : null,
      createdAt: r.createdAt,
      approved: r.approved,
    };
  });

  const nextCursor =
    hasMore && visible.length > 0
      ? encodeCursor(sort, visible[visible.length - 1]!)
      : null;

  return { assets, nextCursor };
}

export async function getAssetById(opts: {
  orgId: string;
  userId: string;
  assetId: string;
}): Promise<AssetListItem | null> {
  const rows = await dbAs<Array<unknown>>(
    { orgId: opts.orgId, userId: opts.userId },
    (tx) =>
      tx
        .select({
          id: contentAssets.id,
          kind: contentAssets.kind,
          name: contentAssets.name,
          url: contentAssets.url,
          thumbnailUrl: contentAssets.thumbnailUrl,
          brandId: contentAssets.brandId,
          tags: contentAssets.tags,
          usedCount: contentAssets.usedCount,
          metadata: contentAssets.metadata,
          createdAt: contentAssets.createdAt,
          approved: contentAssets.approved,
        })
        .from(contentAssets)
        .where(
          and(
            eq(contentAssets.organizationId, opts.orgId),
            eq(contentAssets.id, opts.assetId),
          ),
        )
        .limit(1),
  );
  const row = rows[0] as
    | {
        id: string;
        kind: AssetKind;
        name: string;
        url: string;
        thumbnailUrl: string | null;
        brandId: string | null;
        tags: unknown;
        usedCount: number;
        metadata: unknown;
        createdAt: Date;
        approved: boolean;
      }
    | undefined;
  if (!row) return null;
  const md = isObject(row.metadata) ? (row.metadata as Record<string, unknown>) : {};
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    url: row.url,
    thumbnailUrl: row.thumbnailUrl,
    brandId: row.brandId,
    tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
    usedCount: row.usedCount,
    bytes: typeof md.bytes === 'number' ? md.bytes : 0,
    contentType: typeof md.contentType === 'string' ? md.contentType : null,
    storageKey: typeof md.storageKey === 'string' ? md.storageKey : null,
    createdAt: row.createdAt,
    approved: row.approved,
  };
}

/**
 * Resolve a known id list back to `AssetListItem` rows — used by
 * the composer to hydrate `posts.media_ids` into something with
 * URLs / kinds / thumbnails ready to render. Preserves input
 * order; missing or cross-tenant ids drop out (RLS hides them).
 */
export async function hydrateAssetsByIds(opts: {
  orgId: string;
  userId: string;
  assetIds: ReadonlyArray<string>;
}): Promise<ReadonlyArray<AssetListItem>> {
  if (opts.assetIds.length === 0) return [];
  const rows = await dbAs<
    Array<{
      id: string;
      kind: AssetKind;
      name: string;
      url: string;
      thumbnailUrl: string | null;
      brandId: string | null;
      tags: unknown;
      usedCount: number;
      metadata: unknown;
      createdAt: Date;
      approved: boolean;
    }>
  >({ orgId: opts.orgId, userId: opts.userId }, (tx) =>
    tx
      .select({
        id: contentAssets.id,
        kind: contentAssets.kind,
        name: contentAssets.name,
        url: contentAssets.url,
        thumbnailUrl: contentAssets.thumbnailUrl,
        brandId: contentAssets.brandId,
        tags: contentAssets.tags,
        usedCount: contentAssets.usedCount,
        metadata: contentAssets.metadata,
        createdAt: contentAssets.createdAt,
        approved: contentAssets.approved,
      })
      .from(contentAssets)
      .where(
        and(
          eq(contentAssets.organizationId, opts.orgId),
          inArray(contentAssets.id, [...opts.assetIds]),
        ),
      ),
  );
  const byId = new Map<string, AssetListItem>();
  for (const row of rows) {
    const md = isObject(row.metadata) ? (row.metadata as Record<string, unknown>) : {};
    byId.set(row.id, {
      id: row.id,
      kind: row.kind,
      name: row.name,
      url: row.url,
      thumbnailUrl: row.thumbnailUrl,
      brandId: row.brandId,
      tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
      usedCount: row.usedCount,
      bytes: typeof md.bytes === 'number' ? md.bytes : 0,
      contentType: typeof md.contentType === 'string' ? md.contentType : null,
      storageKey: typeof md.storageKey === 'string' ? md.storageKey : null,
      createdAt: row.createdAt,
      approved: row.approved,
    });
  }
  return opts.assetIds
    .map((id) => byId.get(id))
    .filter((a): a is AssetListItem => a !== undefined);
}

export async function getAssetsCountForOrg(opts: {
  orgId: string;
  userId: string;
}): Promise<number> {
  const rows = await dbAs<Array<{ n: number | string }>>(
    { orgId: opts.orgId, userId: opts.userId },
    (tx) =>
      tx
        .select({ n: count(contentAssets.id) })
        .from(contentAssets)
        .where(eq(contentAssets.organizationId, opts.orgId)),
  );
  return toNum(rows[0]?.n) ?? 0;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function orderByFor(sort: AssetSort): SQL[] {
  switch (sort) {
    case 'mostUsed':
      return [desc(contentAssets.usedCount), desc(contentAssets.createdAt), desc(contentAssets.id)];
    case 'name':
      return [asc(contentAssets.name), asc(contentAssets.id)];
    case 'recent':
    default:
      return [desc(contentAssets.createdAt), desc(contentAssets.id)];
  }
}

interface CursorPayloadV1 {
  v: 1;
  sort: AssetSort;
  /** ISO date string for the row's primary sort tiebreaker. */
  createdAt: string;
  /** Asset id — final tiebreaker. */
  id: string;
  /** Used-count anchor when `sort='mostUsed'`. */
  usedCount?: number;
  /** Name anchor when `sort='name'`. */
  name?: string;
}

function encodeCursor(sort: AssetSort, row: {
  id: string;
  createdAt: Date;
  usedCount?: number;
  name?: string;
}): string {
  const payload: CursorPayloadV1 = {
    v: 1,
    sort,
    createdAt: row.createdAt.toISOString(),
    id: row.id,
    ...(sort === 'mostUsed' ? { usedCount: row.usedCount ?? 0 } : {}),
    ...(sort === 'name' && row.name ? { name: row.name } : {}),
  };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeCursor(raw: string | null | undefined): CursorPayloadV1 | null {
  if (!raw) return null;
  try {
    const decoded = JSON.parse(
      Buffer.from(raw, 'base64url').toString('utf8'),
    ) as Partial<CursorPayloadV1>;
    if (decoded.v !== 1) return null;
    if (!decoded.sort || !decoded.createdAt || !decoded.id) return null;
    return decoded as CursorPayloadV1;
  } catch {
    return null;
  }
}

function applyCursor(
  conditions: SQL[],
  sort: AssetSort,
  raw: string | null | undefined,
): void {
  const cursor = decodeCursor(raw);
  if (!cursor) return;
  // Cursors are stable within a sort mode; a mismatch means the
  // page was loaded under a different sort. Ignore the cursor.
  if (cursor.sort !== sort) return;

  const createdAtIso = cursor.createdAt;
  if (sort === 'mostUsed' && typeof cursor.usedCount === 'number') {
    conditions.push(sql`(
      ${contentAssets.usedCount} < ${cursor.usedCount}
      OR (
        ${contentAssets.usedCount} = ${cursor.usedCount}
        AND ${contentAssets.createdAt} < ${createdAtIso}::timestamptz
      )
      OR (
        ${contentAssets.usedCount} = ${cursor.usedCount}
        AND ${contentAssets.createdAt} = ${createdAtIso}::timestamptz
        AND ${contentAssets.id} < ${cursor.id}
      )
    )`);
  } else if (sort === 'name' && cursor.name) {
    conditions.push(sql`(
      ${contentAssets.name} > ${cursor.name}
      OR (${contentAssets.name} = ${cursor.name} AND ${contentAssets.id} > ${cursor.id})
    )`);
  } else {
    conditions.push(sql`(
      ${contentAssets.createdAt} < ${createdAtIso}::timestamptz
      OR (
        ${contentAssets.createdAt} = ${createdAtIso}::timestamptz
        AND ${contentAssets.id} < ${cursor.id}
      )
    )`);
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function toNum(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
