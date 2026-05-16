import { FileImage, Film, FileText, ImageIcon } from 'lucide-react';

import { EmptyState } from '@/components/common/empty-state';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils/cn';
import type {
  AssetListFilters,
  AssetListItem,
  AssetListPage,
} from '@/lib/publish/assets/queries';

import { AssetDeleteButton } from './asset-delete-button';

interface AssetGridProps {
  page: AssetListPage;
  currentFilters: AssetListFilters;
}

const KIND_ICONS = {
  image: ImageIcon,
  gif: FileImage,
  video: Film,
  pdf: FileText,
} as const;

const KIND_BADGE_STYLES = {
  image: 'bg-blue-100 text-blue-900 dark:bg-blue-950/40 dark:text-blue-100',
  gif: 'bg-violet-100 text-violet-900 dark:bg-violet-950/40 dark:text-violet-100',
  video: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100',
  pdf: 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100',
} as const;

/**
 * Grid of asset tiles for /publish/assets. Two empty states:
 *
 *   - Filters applied + no results → `"Sin coincidencias"` with
 *     a hint to broaden the query.
 *   - No filters + no results → `"La biblioteca está vacía"` with
 *     a CTA pointing at the upload button in the header.
 */
export function AssetGrid({
  page,
  currentFilters,
}: AssetGridProps): React.ReactElement {
  if (page.assets.length === 0) {
    const filtersActive = Boolean(
      currentFilters.brandId ||
        currentFilters.kind ||
        currentFilters.tag ||
        currentFilters.q,
    );
    return (
      <div className="px-6 py-8">
        <EmptyState
          icon={ImageIcon}
          title={filtersActive ? 'Sin coincidencias' : 'La biblioteca está vacía'}
          description={
            filtersActive
              ? 'Ningún asset coincide con los filtros actuales. Ajusta el filtro o busca con otro término.'
              : 'Sube tu primera imagen, video o PDF con el botón "Subir asset" arriba. Los assets aparecerán aquí y podrás usarlos desde el composer.'
          }
        />
      </div>
    );
  }

  return (
    <ul
      className="grid grid-cols-2 gap-3 px-6 py-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5"
      data-testid="asset-grid"
    >
      {page.assets.map((asset) => (
        <li key={asset.id}>
          <AssetTile asset={asset} />
        </li>
      ))}
    </ul>
  );
}

function AssetTile({ asset }: { asset: AssetListItem }): React.ReactElement {
  const Icon = KIND_ICONS[asset.kind];
  const isImage = asset.kind === 'image' || asset.kind === 'gif';
  const canDelete = asset.usedCount === 0;
  return (
    <div className="group flex flex-col gap-2 rounded-lg border bg-card p-2 transition-shadow hover:shadow-md">
      <div className="relative aspect-square w-full overflow-hidden rounded-md bg-muted">
        {isImage ? (
          // eslint-disable-next-line @next/next/no-img-element -- see media-uploader for rationale
          <img
            src={asset.thumbnailUrl ?? asset.url}
            alt={asset.name}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <Icon className="h-10 w-10" aria-hidden />
          </div>
        )}
        <Badge
          className={cn(
            'absolute left-2 top-2 border-transparent text-[10px]',
            KIND_BADGE_STYLES[asset.kind],
          )}
        >
          {asset.kind.toUpperCase()}
        </Badge>
      </div>
      <div className="flex flex-col gap-1 px-1">
        <span className="line-clamp-1 text-xs font-medium" title={asset.name}>
          {asset.name}
        </span>
        <div className="flex items-center justify-between text-[10px] text-muted-foreground tabular-nums">
          <span>{formatMb(asset.bytes)}</span>
          <span>
            {asset.usedCount > 0
              ? `usado ${asset.usedCount}×`
              : 'sin uso'}
          </span>
        </div>
        {asset.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {asset.tags.slice(0, 3).map((t) => (
              <Badge key={t} variant="muted" className="h-4 px-1 text-[10px]">
                {t}
              </Badge>
            ))}
          </div>
        ) : null}
        <div className="pt-1">
          <AssetDeleteButton assetId={asset.id} disabled={!canDelete} />
        </div>
      </div>
    </div>
  );
}

function formatMb(bytes: number): string {
  if (bytes <= 0) return '—';
  if (bytes < 1_000_000) return `${Math.round(bytes / 1_000)} KB`;
  const mb = bytes / 1_000_000;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}
