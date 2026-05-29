'use client';

import { Filter, Search } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { dynamicRoute } from '@/lib/routes';
import { useTransition } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type {
  AssetListFilters,
  AssetSort,
} from '@/lib/publish/assets/queries';
import type { BrandOption } from '@/lib/publish/picker-data';

interface AssetFiltersProps {
  filters: AssetListFilters;
  brands: ReadonlyArray<BrandOption>;
}

const NONE = '__none__';

const KIND_LABELS = {
  image: 'Imágenes',
  gif: 'GIFs',
  video: 'Videos',
  pdf: 'PDFs',
} as const;

const SORT_LABELS: Record<AssetSort, string> = {
  recent: 'Más recientes',
  mostUsed: 'Más usados',
  name: 'Nombre A-Z',
};

/**
 * Client-side filter bar for the asset library. Same `router.replace`
 * pattern as the publish filter bar: URL is the source of truth,
 * every change navigates without pushing onto history.
 *
 * Search is uncontrolled (no setState-in-effect React-19 warning);
 * submitted via form onSubmit. Filters with the `cursor` param
 * present strip it so the user lands on page 1 of the new filter
 * set.
 */
export function AssetFilters({
  filters,
  brands,
}: AssetFiltersProps): React.ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const replaceParam = (mutate: (next: URLSearchParams) => void): void => {
    const next = new URLSearchParams(params.toString());
    next.delete('cursor');
    mutate(next);
    const qs = next.toString();
    startTransition(() => {
      router.replace(dynamicRoute(qs ? `${pathname}?${qs}` : pathname));
    });
  };

  const onBrandChange = (value: string): void => {
    replaceParam((next) => {
      if (value === NONE) next.delete('brandId');
      else next.set('brandId', value);
    });
  };

  const onKindChange = (value: string): void => {
    replaceParam((next) => {
      if (value === NONE) next.delete('kind');
      else next.set('kind', value);
    });
  };

  const onSortChange = (value: string): void => {
    replaceParam((next) => {
      if (value === 'recent') next.delete('sort');
      else next.set('sort', value);
    });
  };

  const submitSearch = (e: React.FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const input = e.currentTarget.elements.namedItem('q');
    const raw = input instanceof HTMLInputElement ? input.value.trim() : '';
    replaceParam((next) => {
      if (raw.length === 0) next.delete('q');
      else next.set('q', raw);
    });
  };

  const onTagChange = (e: React.FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const input = e.currentTarget.elements.namedItem('tag');
    const raw = input instanceof HTMLInputElement ? input.value.trim() : '';
    replaceParam((next) => {
      if (raw.length === 0) next.delete('tag');
      else next.set('tag', raw);
    });
  };

  return (
    <div
      className="flex flex-wrap items-center gap-2 border-b bg-card/30 px-6 py-2"
      data-testid="assets-filter-bar"
    >
      <Select value={filters.brandId ?? NONE} onValueChange={onBrandChange}>
        <SelectTrigger className="h-8 w-40 text-xs">
          <SelectValue placeholder="Marca" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>Todas las marcas</SelectItem>
          {brands.map((b) => (
            <SelectItem key={b.id} value={b.id}>
              {b.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={filters.kind ?? NONE} onValueChange={onKindChange}>
        <SelectTrigger className="h-8 w-36 text-xs">
          <SelectValue placeholder="Tipo" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>Todos los tipos</SelectItem>
          {(['image', 'gif', 'video', 'pdf'] as const).map((kind) => (
            <SelectItem key={kind} value={kind}>
              {KIND_LABELS[kind]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={filters.sort ?? 'recent'} onValueChange={onSortChange}>
        <SelectTrigger className="h-8 w-36 text-xs">
          <SelectValue placeholder="Orden" />
        </SelectTrigger>
        <SelectContent>
          {(Object.entries(SORT_LABELS) as Array<[AssetSort, string]>).map(
            ([key, label]) => (
              <SelectItem key={key} value={key}>
                {label}
              </SelectItem>
            ),
          )}
        </SelectContent>
      </Select>

      <form onSubmit={onTagChange} className="inline-flex items-center gap-1">
        <div className="relative">
          <Filter
            className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            name="tag"
            type="text"
            defaultValue={filters.tag ?? ''}
            key={filters.tag ?? '__empty__'}
            placeholder="Filtrar por tag…"
            aria-label="Tag"
            className="h-8 w-36 pl-7 text-xs"
          />
        </div>
      </form>

      <form onSubmit={submitSearch} className="ml-auto inline-flex items-center gap-1">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            name="q"
            defaultValue={filters.q ?? ''}
            key={filters.q ?? '__empty__'}
            placeholder="Buscar nombre…"
            aria-label="Buscar"
            className="h-8 w-56 pl-7 text-xs"
          />
        </div>
      </form>

      {pending ? (
        <Badge variant="muted" className="text-[10px]">
          Actualizando…
        </Badge>
      ) : null}

      <ClearButton filters={filters} />
    </div>
  );
}

function ClearButton({ filters }: { filters: AssetListFilters }): React.ReactElement | null {
  const router = useRouter();
  const pathname = usePathname();
  const hasAny = Boolean(
    filters.brandId || filters.kind || filters.tag || filters.q || filters.sort,
  );
  if (!hasAny) return null;
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-8 text-xs text-muted-foreground"
      onClick={() => router.replace(dynamicRoute(pathname))}
    >
      Limpiar
    </Button>
  );
}
