'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { CalendarRange, Filter, Search, X } from 'lucide-react';
import { useTransition } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils/cn';
import {
  ALLOWED_POST_STATUS,
  hasActiveFilters,
  type PostFilterStatus,
  type PublishFilters,
} from '@/lib/publish/filters';
import type {
  BrandOption,
  CampaignOption,
} from '@/lib/publish/picker-data';

interface FilterBarProps {
  filters: PublishFilters;
  brands: ReadonlyArray<BrandOption>;
  campaigns: ReadonlyArray<CampaignOption>;
}

const STATUS_LABELS: Readonly<Record<PostFilterStatus, string>> = {
  draft: 'Borrador',
  pending_approval: 'En aprobación',
  scheduled: 'Agendado',
  publishing: 'Publicando',
  published: 'Publicado',
  failed: 'Fallido',
  cancelled: 'Cancelado',
};

const NONE_VALUE = '__none__';

/**
 * Client-side filter bar. Every interaction writes the next state
 * back into the URL via `router.replace()` so the source of truth
 * stays the searchParams — the page is a Server Component and
 * re-runs the loader on each filter change.
 *
 * Empty values are dropped from the URL (the encoder in
 * `lib/publish/filters.ts` already does this); the bar reads the
 * canonical `PublishFilters` shape that came back from the parser.
 */
export function FilterBar({ filters, brands, campaigns }: FilterBarProps): React.ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  // Search input is uncontrolled — the URL is the source of truth.
  // `defaultValue={filters.q}` seeds the field; we read the value
  // off the form on submit instead of mirroring it into state.
  // Avoids the React-19 setState-in-effect warning.

  const replaceParam = (mutate: (next: URLSearchParams) => void): void => {
    const next = new URLSearchParams(params.toString());
    mutate(next);
    const qs = next.toString();
    startTransition(() => {
      router.replace((qs ? `${pathname}?${qs}` : pathname) as never);
    });
  };

  const onBrandChange = (value: string): void => {
    replaceParam((next) => {
      if (value === NONE_VALUE) next.delete('brandId');
      else next.set('brandId', value);
    });
  };

  const onCampaignChange = (value: string): void => {
    replaceParam((next) => {
      if (value === NONE_VALUE) next.delete('campaignId');
      else next.set('campaignId', value);
    });
  };

  const toggleStatus = (s: PostFilterStatus): void => {
    replaceParam((next) => {
      const current = new Set(filters.status ?? []);
      if (current.has(s)) current.delete(s);
      else current.add(s);
      if (current.size === 0) next.delete('status');
      else next.set('status', Array.from(current).join(','));
    });
  };

  const submitSearch = (e: React.FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const input = e.currentTarget.elements.namedItem('q');
    const raw = input instanceof HTMLInputElement ? input.value : '';
    replaceParam((next) => {
      const trimmed = raw.trim();
      if (trimmed.length === 0) next.delete('q');
      else next.set('q', trimmed);
    });
  };

  const onDateChange = (field: 'scheduledFrom' | 'scheduledTo', value: string): void => {
    replaceParam((next) => {
      if (!value) next.delete(field);
      else next.set(field, value);
    });
  };

  const clearAll = (): void => {
    replaceParam((next) => {
      next.delete('brandId');
      next.delete('campaignId');
      next.delete('status');
      next.delete('q');
      next.delete('scheduledFrom');
      next.delete('scheduledTo');
    });
  };

  const showClear = hasActiveFilters(filters);

  return (
    <div
      className="flex flex-wrap items-center gap-2 border-b bg-card/30 px-6 py-2"
      data-testid="publish-filter-bar"
    >
      {/* Brand */}
      <Select value={filters.brandId ?? NONE_VALUE} onValueChange={onBrandChange}>
        <SelectTrigger className="h-8 w-40 text-xs">
          <SelectValue placeholder="Marca" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE_VALUE}>Todas las marcas</SelectItem>
          {brands.map((b) => (
            <SelectItem key={b.id} value={b.id}>
              {b.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Campaign */}
      <Select
        value={filters.campaignId ?? NONE_VALUE}
        onValueChange={onCampaignChange}
      >
        <SelectTrigger className="h-8 w-44 text-xs">
          <SelectValue placeholder="Campaña" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE_VALUE}>Todas las campañas</SelectItem>
          {campaigns.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Status multi-select */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
            <Filter className="h-3.5 w-3.5" aria-hidden />
            Estado
            {filters.status?.length ? (
              <Badge variant="muted" className="ml-1 h-4 px-1 text-[10px]">
                {filters.status.length}
              </Badge>
            ) : null}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel className="text-xs">Filtrar por estado</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {ALLOWED_POST_STATUS.map((s) => (
            <DropdownMenuCheckboxItem
              key={s}
              checked={filters.status?.includes(s) ?? false}
              onCheckedChange={() => toggleStatus(s)}
              onSelect={(e) => e.preventDefault()}
              className="text-xs"
            >
              {STATUS_LABELS[s]}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Date range */}
      <div className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs">
        <CalendarRange className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        <input
          type="date"
          aria-label="Desde"
          value={filters.scheduledFrom ?? ''}
          onChange={(e) => onDateChange('scheduledFrom', e.target.value)}
          className="bg-transparent text-xs focus:outline-none"
        />
        <span className="text-muted-foreground">→</span>
        <input
          type="date"
          aria-label="Hasta"
          value={filters.scheduledTo ?? ''}
          onChange={(e) => onDateChange('scheduledTo', e.target.value)}
          className="bg-transparent text-xs focus:outline-none"
        />
      </div>

      {/* Search */}
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
            placeholder="Buscar texto del post…"
            aria-label="Buscar"
            className="h-8 w-56 pl-7 text-xs"
          />
        </div>
      </form>

      {showClear ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={clearAll}
          className="h-8 gap-1 text-xs text-muted-foreground"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
          Limpiar
        </Button>
      ) : null}

      {pending ? (
        <Badge variant="muted" className={cn('text-[10px]')}>
          Actualizando…
        </Badge>
      ) : null}
    </div>
  );
}
