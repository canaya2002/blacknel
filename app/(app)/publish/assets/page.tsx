import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import { AssetGrid } from '@/components/publish/assets/asset-grid';
import { AssetFilters } from '@/components/publish/assets/asset-filters';
import { AssetUploadButton } from '@/components/publish/assets/asset-upload-button';
import { PageHeader } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import { requireUser } from '@/lib/auth/server';
import { authorize } from '@/lib/permissions/can';
import {
  ALLOWED_KINDS,
  ALLOWED_SORTS,
  listAssetsForOrg,
  type AssetListFilters,
} from '@/lib/publish/assets/queries';
import { listBrandOptionsWithTx } from '@/lib/publish/picker-data';
import { dbAs } from '@/lib/db/client';

export const dynamic = 'force-dynamic';

interface AssetsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * /publish/assets — asset library (Commit 19b).
 *
 * Server-rendered list of `content_assets` with filters (brand,
 * kind, tag, search) and three sort modes (recent, mostUsed,
 * name). Cursor pagination via `nextCursor`. The page reuses
 * `lib/publish/picker-data.ts` for brand options so the brand
 * filter mirrors the composer.
 *
 * Upload entry-point: `<AssetUploadButton />` opens a hidden
 * file input + calls `uploadAssetAction`. For uploads from the
 * composer, see `<MediaUploader />`.
 */
export default async function AssetsPage({
  searchParams,
}: AssetsPageProps): Promise<React.ReactElement> {
  const session = await requireUser();
  authorize(session.role, 'posts:read');

  const sp = await searchParams;
  const filters = parseAssetsFilters(sp);
  const cursor = typeof sp.cursor === 'string' ? sp.cursor : null;

  const [page, brandOptions] = await Promise.all([
    listAssetsForOrg({
      orgId: session.orgId,
      userId: session.userId,
      filters,
      ...(cursor ? { cursor } : {}),
    }),
    dbAs({ orgId: session.orgId, userId: session.userId }, (tx) =>
      listBrandOptionsWithTx(tx, session.orgId),
    ),
  ]);

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-3 px-6 pt-6">
        <PageHeader
          title="Asset library"
          description="Imágenes, videos, GIFs y PDFs disponibles para los posts. Las cuotas por plan controlan tamaño por archivo, cantidad de assets y almacenamiento total."
          eyebrow={
            <Link
              href="/publish"
              prefetch={false}
              className="inline-flex items-center gap-1 text-xs"
            >
              <ArrowLeft className="h-3 w-3" aria-hidden />
              Volver al calendario
            </Link>
          }
          actions={<AssetUploadButton />}
        />
      </div>
      <AssetFilters filters={filters} brands={brandOptions} />
      <AssetGrid page={page} currentFilters={filters} />
      <PaginationFooter
        hasMore={page.nextCursor !== null}
        filters={filters}
        nextCursor={page.nextCursor}
      />
    </div>
  );
}

function parseAssetsFilters(
  sp: Record<string, string | string[] | undefined>,
): AssetListFilters {
  const get = (key: string): string | undefined => {
    const v = sp[key];
    if (typeof v === 'string') return v;
    if (Array.isArray(v) && v.length > 0) return v[0];
    return undefined;
  };
  const rawBrand = get('brandId');
  const brandId = rawBrand && UUID_RE.test(rawBrand) ? rawBrand : undefined;
  const rawKind = get('kind');
  const kind =
    rawKind && (ALLOWED_KINDS as ReadonlyArray<string>).includes(rawKind)
      ? (rawKind as NonNullable<AssetListFilters['kind']>)
      : undefined;
  const rawTag = get('tag');
  const tag = rawTag && rawTag.length > 0 && rawTag.length <= 40 ? rawTag : undefined;
  const rawQ = get('q');
  const q =
    rawQ && rawQ.length > 0 && rawQ.length <= 200 ? rawQ.trim().toLowerCase() : undefined;
  const rawSort = get('sort');
  const sort =
    rawSort && (ALLOWED_SORTS as ReadonlyArray<string>).includes(rawSort)
      ? (rawSort as NonNullable<AssetListFilters['sort']>)
      : undefined;
  return {
    ...(brandId ? { brandId } : {}),
    ...(kind ? { kind } : {}),
    ...(tag ? { tag } : {}),
    ...(q ? { q } : {}),
    ...(sort ? { sort } : {}),
  };
}

function PaginationFooter({
  hasMore,
  filters,
  nextCursor,
}: {
  hasMore: boolean;
  filters: AssetListFilters;
  nextCursor: string | null;
}): React.ReactElement | null {
  if (!hasMore || !nextCursor) return null;
  const params = new URLSearchParams();
  if (filters.brandId) params.set('brandId', filters.brandId);
  if (filters.kind) params.set('kind', filters.kind);
  if (filters.tag) params.set('tag', filters.tag);
  if (filters.q) params.set('q', filters.q);
  if (filters.sort) params.set('sort', filters.sort);
  params.set('cursor', nextCursor);
  return (
    <div className="flex justify-center px-6 py-6">
      <Button asChild variant="outline" size="sm">
        <Link href={`/publish/assets?${params.toString()}`} prefetch={false}>
          Cargar más
        </Link>
      </Button>
    </div>
  );
}
