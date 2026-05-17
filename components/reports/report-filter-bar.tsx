'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { RefreshCcw } from 'lucide-react';
import { useTransition } from 'react';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { BrandOption } from '@/lib/publish/picker-data';
import type { ReportFilters } from '@/lib/reports/period';

interface ReportFilterBarProps {
  filters: ReportFilters;
  brandOptions: ReadonlyArray<BrandOption>;
}

const NONE = '__none__';

/**
 * URL-driven filter bar for /reports. Period (7d/30d/90d) +
 * optional brand scope. "Refresh" button toggles `?fresh=1` to
 * bypass the 60s LRU cache (Ajuste 2).
 */
export function ReportFilterBar({
  filters,
  brandOptions,
}: ReportFilterBarProps): React.ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const push = (key: string, value: string | undefined): void => {
    const next = new URLSearchParams(searchParams);
    if (!value || value === NONE) next.delete(key);
    else next.set(key, value);
    // Drop ?fresh on filter change — the cache miss is implicit.
    next.delete('fresh');
    startTransition(() => {
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    });
  };

  const refresh = (): void => {
    const next = new URLSearchParams(searchParams);
    next.set('fresh', '1');
    startTransition(() => {
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2 border-y bg-card/20 px-6 py-2">
      <Select
        value={filters.period}
        onValueChange={(v) => push('period', v)}
      >
        <SelectTrigger className="h-8 w-36 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="7d">Últimos 7 días</SelectItem>
          <SelectItem value="30d">Últimos 30 días</SelectItem>
          <SelectItem value="90d">Últimos 90 días</SelectItem>
        </SelectContent>
      </Select>

      <Select
        value={filters.brandId ?? NONE}
        onValueChange={(v) => push('brandId', v === NONE ? undefined : v)}
      >
        <SelectTrigger className="h-8 w-48 text-xs">
          <SelectValue placeholder="Todas las marcas" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>Todas las marcas</SelectItem>
          {brandOptions.map((b) => (
            <SelectItem key={b.id} value={b.id}>
              {b.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button
        variant="ghost"
        size="sm"
        className="ml-auto h-8 gap-1 text-xs"
        onClick={refresh}
        disabled={pending}
        title="Bypass cache 60s y recargar"
      >
        <RefreshCcw className="h-3.5 w-3.5" aria-hidden />
        Recargar
      </Button>
    </div>
  );
}
