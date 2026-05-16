'use client';

import { Search, X } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { hasActiveFilters, type PublishFilters } from '@/lib/publish/filters';

interface PublishFiltersBarProps {
  filters: PublishFilters;
}

/**
 * Filters bar for /publish. URL-bound (same pattern as inbox/
 * reviews/reputation). Currently exposes:
 *
 *   - search (`q`)
 *   - active-filter pills with X to clear
 *
 * Brand and campaign pickers land in Commit 19 alongside the
 * composer (they reuse the picker component the composer needs).
 * Date-range UI lands with Commit 21 polish.
 */
export function PublishFiltersBar({
  filters,
}: PublishFiltersBarProps): React.ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const replace = (mutate: (p: URLSearchParams) => void): void => {
    const next = new URLSearchParams(params.toString());
    mutate(next);
    const query = next.toString();
    startTransition(() => {
      router.replace(`${pathname}${query ? `?${query}` : ''}` as never);
    });
  };

  const clearAll = (): void => {
    replace((p) => {
      p.delete('q');
      p.delete('brandId');
      p.delete('campaignId');
      p.delete('status');
      p.delete('scheduledFrom');
      p.delete('scheduledTo');
    });
  };

  const onSearchSubmit = (e: React.FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const q = String(form.get('q') ?? '').trim();
    replace((p) => {
      if (q.length === 0) p.delete('q');
      else p.set('q', q);
    });
  };

  const active = hasActiveFilters(filters);

  return (
    <div
      className="flex flex-wrap items-center gap-2 border-b bg-card/30 px-6 py-2"
      data-testid="publish-filters-bar"
    >
      <form onSubmit={onSearchSubmit} className="flex items-center gap-1.5">
        <div className="relative">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            name="q"
            defaultValue={filters.q ?? ''}
            placeholder="Buscar texto del post…"
            className="h-8 w-64 pl-7 text-xs"
            aria-label="Buscar"
            data-testid="publish-search-input"
          />
        </div>
      </form>

      {active ? (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1 text-xs text-muted-foreground"
          onClick={clearAll}
          data-testid="publish-clear-filters"
        >
          <X className="h-3 w-3" aria-hidden />
          Limpiar filtros
        </Button>
      ) : null}

      <ActivePills filters={filters} />

      {pending ? (
        <Badge variant="muted" className="ml-auto text-[10px]">
          Actualizando…
        </Badge>
      ) : null}
    </div>
  );
}

function ActivePills({
  filters,
}: {
  filters: PublishFilters;
}): React.ReactElement | null {
  const pills: Array<{ key: string; label: string }> = [];
  if (filters.q) pills.push({ key: 'q', label: `texto: "${filters.q}"` });
  if (filters.brandId) pills.push({ key: 'brandId', label: 'marca filtrada' });
  if (filters.campaignId) pills.push({ key: 'campaignId', label: 'campaña filtrada' });
  if (filters.status?.length) {
    pills.push({ key: 'status', label: `estado: ${filters.status.join(', ')}` });
  }
  if (filters.scheduledFrom || filters.scheduledTo) {
    pills.push({
      key: 'date',
      label: `${filters.scheduledFrom ?? '…'} → ${filters.scheduledTo ?? '…'}`,
    });
  }
  if (pills.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {pills.map((p) => (
        <Badge key={p.key} variant="muted" className="text-[10px]">
          {p.label}
        </Badge>
      ))}
    </div>
  );
}
