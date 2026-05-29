'use client';

import { X } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { dynamicRoute } from '@/lib/routes';
import { useCallback, useMemo, useTransition } from 'react';

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
import {
  ALLOWED_KIND,
  ALLOWED_RISK_LEVEL,
  ALLOWED_STATUS,
  type ApprovalFilters,
  type ApprovalKind,
  type ApprovalRiskLevel,
  type ApprovalStatus,
} from '@/lib/approvals/filters';

interface FiltersBarProps {
  filters: ApprovalFilters;
  defaulted: boolean;
}

export function FiltersBar({ filters, defaulted }: FiltersBarProps): React.ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const pushUrl = useCallback(
    (mutate: (next: URLSearchParams) => void) => {
      const next = new URLSearchParams(params.toString());
      next.delete('cursor');
      mutate(next);
      startTransition(() => {
        router.replace(dynamicRoute(`${pathname}?${next.toString()}`));
      });
    },
    [params, pathname, router],
  );

  const toggleMulti = useCallback(
    <T extends string>(key: keyof ApprovalFilters, value: T) => {
      pushUrl((next) => {
        const current = next.get(key as string);
        const set = new Set(current ? current.split(',') : []);
        if (set.has(value)) set.delete(value);
        else set.add(value);
        if (set.size === 0) next.delete(key as string);
        else next.set(key as string, [...set].join(','));
      });
    },
    [pushUrl],
  );

  const showDecided = useCallback(() => {
    pushUrl((next) => {
      next.set('status', 'approved,rejected,edited_approved');
      // Decided-history view typically wants all kinds + risk levels.
      next.delete('kind');
      next.delete('riskLevel');
    });
  }, [pushUrl]);

  const showPending = useCallback(() => {
    pushUrl((next) => {
      Array.from(next.keys()).forEach((k) => next.delete(k));
    });
  }, [pushUrl]);

  const activeCount = useMemo(() => {
    const parts: ReadonlyArray<number | undefined> = [
      filters.status?.length,
      filters.kind?.length,
      filters.riskLevel?.length,
      filters.assignedTo ? 1 : 0,
    ];
    let total = 0;
    for (const p of parts) total += p ?? 0;
    return total;
  }, [filters]);

  return (
    <div
      className="flex flex-wrap items-center gap-2 border-b bg-card/30 px-4 py-2"
      data-testid="filters-bar"
    >
      <MultiFilter
        label="Estado"
        values={ALLOWED_STATUS}
        current={(filters.status as ReadonlyArray<ApprovalStatus>) ?? []}
        onToggle={(v) => toggleMulti('status', v)}
      />
      <MultiFilter
        label="Tipo"
        values={ALLOWED_KIND}
        current={(filters.kind as ReadonlyArray<ApprovalKind>) ?? []}
        onToggle={(v) => toggleMulti('kind', v)}
      />
      <MultiFilter
        label="Riesgo"
        values={ALLOWED_RISK_LEVEL}
        current={(filters.riskLevel as ReadonlyArray<ApprovalRiskLevel>) ?? []}
        onToggle={(v) => toggleMulti('riskLevel', v)}
      />

      <div className="ml-auto flex items-center gap-2">
        {defaulted ? (
          <Button variant="ghost" size="sm" onClick={showDecided} disabled={pending} className="h-8 text-xs">
            Ver decididas
          </Button>
        ) : (
          <Button variant="ghost" size="sm" onClick={showPending} disabled={pending} className="h-8 text-xs">
            Ver pendientes
          </Button>
        )}
        {activeCount > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={showPending}
            disabled={pending}
            className="h-8 gap-1 text-xs"
          >
            <X className="h-3 w-3" />
            Limpiar ({activeCount})
          </Button>
        ) : null}
        {pending ? (
          <Badge variant="muted" className="text-[10px]">
            Actualizando…
          </Badge>
        ) : null}
      </div>
    </div>
  );
}

interface MultiFilterProps<T extends string> {
  label: string;
  values: ReadonlyArray<T>;
  current: ReadonlyArray<T>;
  onToggle: (value: T) => void;
}

function MultiFilter<T extends string>({
  label,
  values,
  current,
  onToggle,
}: MultiFilterProps<T>): React.ReactElement {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1 text-xs">
          {label}
          {current.length > 0 ? (
            <Badge variant="muted" className="ml-1 text-[10px]">
              {current.length}
            </Badge>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel className="text-xs">{label}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {values.map((v) => (
          <DropdownMenuCheckboxItem
            key={v}
            checked={current.includes(v)}
            onCheckedChange={() => onToggle(v)}
            className="text-xs"
          >
            {v.replace(/_/g, ' ')}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
