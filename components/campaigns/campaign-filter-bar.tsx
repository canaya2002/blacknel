'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Search, X } from 'lucide-react';
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
import { hasActiveCampaignFilters, type CampaignFilters } from '@/lib/campaigns/filters';
import {
  CAMPAIGN_GOALS,
  CAMPAIGN_STATUSES,
  type CampaignGoal,
  type CampaignStatus,
} from '@/lib/campaigns/validate';
import type { BrandOption } from '@/lib/publish/picker-data';

interface CampaignFilterBarProps {
  filters: CampaignFilters;
  brandOptions: ReadonlyArray<BrandOption>;
}

const STATUS_LABEL: Readonly<Record<CampaignStatus, string>> = {
  draft: 'Draft',
  active: 'Activa',
  paused: 'En pausa',
  completed: 'Completada',
  archived: 'Archivada',
};
const GOAL_LABEL: Readonly<Record<CampaignGoal, string>> = {
  awareness: 'Awareness',
  engagement: 'Engagement',
  leads: 'Leads',
  reviews: 'Reseñas',
  reputation: 'Reputación',
  event: 'Evento',
  launch: 'Lanzamiento',
  promotion: 'Promoción',
  education: 'Educación',
  crisis: 'Crisis',
  seasonal: 'Estacional',
  evergreen: 'Evergreen',
};
const NONE_VALUE = '__none__';

/**
 * URL-driven filter bar for /publish/campaigns. Same shape as the
 * publish dashboard filter bar (Commit 18): one status select, one
 * goal select, one brand select, one `q` text input. Cursor is
 * dropped when filters change (a stale cursor against a different
 * predicate returns garbage).
 */
export function CampaignFilterBar({
  filters,
  brandOptions,
}: CampaignFilterBarProps): React.ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const pushFilter = (key: string, value: string | undefined): void => {
    const next = new URLSearchParams(searchParams);
    if (!value || value === NONE_VALUE) next.delete(key);
    else next.set(key, value);
    next.delete('cursor');
    startTransition(() => {
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    });
  };

  const clearAll = (): void => {
    startTransition(() => {
      router.replace(pathname, { scroll: false });
    });
  };

  const statusValue = filters.status?.[0] ?? '';

  return (
    <div className="flex flex-wrap items-center gap-2 border-y bg-card/20 px-6 py-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          defaultValue={filters.q ?? ''}
          placeholder="Buscar por nombre"
          aria-label="Buscar campañas"
          className="h-8 w-48 pl-8 text-xs"
          onBlur={(e) => pushFilter('q', e.currentTarget.value || undefined)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              pushFilter('q', (e.target as HTMLInputElement).value || undefined);
            }
          }}
          maxLength={200}
        />
      </div>

      <Select
        value={statusValue || NONE_VALUE}
        onValueChange={(v) => pushFilter('status', v === NONE_VALUE ? undefined : v)}
      >
        <SelectTrigger className="h-8 w-40 text-xs">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE_VALUE}>Todos los estados</SelectItem>
          {CAMPAIGN_STATUSES.map((s) => (
            <SelectItem key={s} value={s}>
              {STATUS_LABEL[s]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={filters.goal ?? NONE_VALUE}
        onValueChange={(v) => pushFilter('goal', v === NONE_VALUE ? undefined : v)}
      >
        <SelectTrigger className="h-8 w-40 text-xs">
          <SelectValue placeholder="Goal" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE_VALUE}>Todos los goals</SelectItem>
          {CAMPAIGN_GOALS.map((g) => (
            <SelectItem key={g} value={g}>
              {GOAL_LABEL[g]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={filters.brandId ?? NONE_VALUE}
        onValueChange={(v) => pushFilter('brandId', v === NONE_VALUE ? undefined : v)}
      >
        <SelectTrigger className="h-8 w-44 text-xs">
          <SelectValue placeholder="Brand" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE_VALUE}>Todas las marcas</SelectItem>
          {brandOptions.map((b) => (
            <SelectItem key={b.id} value={b.id}>
              {b.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {hasActiveCampaignFilters(filters) ? (
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-8 gap-1 text-xs"
          onClick={clearAll}
          disabled={pending}
        >
          <X className="h-3 w-3" aria-hidden />
          Limpiar filtros
          {pending ? <Badge variant="muted">…</Badge> : null}
        </Button>
      ) : null}
    </div>
  );
}
