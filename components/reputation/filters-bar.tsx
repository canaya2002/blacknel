'use client';

import { CalendarRange } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { dynamicRoute } from '@/lib/routes';
import { useTransition } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { ReputationFilters } from '@/lib/reputation/filters';

interface FiltersBarProps {
  filters: ReputationFilters;
}

/**
 * Lightweight filters bar for /reputation. Phase-5 surface only
 * exposes the date-range preset switcher — brand / location /
 * platform pickers land with Phase 6/7 once the cross-module
 * scoping context is wired in.
 *
 * Every preset click resets the URL to a clean
 * `?preset=N` shape so back/forward navigation lands on consistent
 * snapshots.
 */
export function FiltersBar({ filters }: FiltersBarProps): React.ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const setPreset = (days: 30 | 90 | 365): void => {
    const next = new URLSearchParams(params.toString());
    next.set('preset', String(days));
    next.delete('dateFrom');
    next.delete('dateTo');
    startTransition(() => {
      router.replace(dynamicRoute(`${pathname}?${next.toString()}`));
    });
  };

  const label =
    filters.preset === 'custom'
      ? rangeLabel(filters.dateFrom, filters.dateTo)
      : `Últimos ${filters.preset}d`;

  return (
    <div
      className="flex flex-wrap items-center gap-2 border-b bg-card/30 px-6 py-2"
      data-testid="reputation-filters-bar"
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
            <CalendarRange className="h-3.5 w-3.5" aria-hidden />
            {label}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel className="text-xs">Período</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setPreset(30)} className="text-xs">
            Últimos 30 días
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setPreset(90)} className="text-xs">
            Últimos 90 días
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setPreset(365)} className="text-xs">
            Últimos 365 días
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {pending ? (
        <Badge variant="muted" className="text-[10px]">
          Actualizando…
        </Badge>
      ) : null}
    </div>
  );
}

function rangeLabel(from: Date, to: Date): string {
  return `${iso(from)} → ${iso(to)}`;
}

function iso(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
