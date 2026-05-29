'use client';

import { Search, X } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { dynamicRoute } from '@/lib/routes';
import { useCallback, useMemo, useState, useTransition } from 'react';

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
  ALLOWED_KIND,
  ALLOWED_PRIORITY,
  ALLOWED_SENTIMENT,
  ALLOWED_STATUS,
  type InboxFilters,
  type ThreadKind,
  type ThreadPriority,
  type ThreadSentiment,
  type ThreadStatus,
} from '@/lib/inbox/filters';

interface FiltersBarProps {
  filters: InboxFilters;
}

/**
 * URL-bound filter controls for /inbox.
 *
 * Every change pushes to the URL via `router.replace()` so the server
 * component re-runs the query. State stays in the URL — the bar reads
 * its current selection from `searchParams`, not local state. The only
 * exception is the search input, which keeps a local string buffer so
 * typing doesn't trigger a fetch per keystroke; we commit on Enter /
 * blur / explicit search.
 */
export function FiltersBar({ filters }: FiltersBarProps): React.ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const [searchDraft, setSearchDraft] = useState(filters.q ?? '');

  const pushUrl = useCallback(
    (mutate: (next: URLSearchParams) => void) => {
      const next = new URLSearchParams(params.toString());
      next.delete('cursor'); // any filter change resets pagination
      mutate(next);
      startTransition(() => {
        router.replace(dynamicRoute(`${pathname}?${next.toString()}`));
      });
    },
    [params, pathname, router],
  );

  const toggleMulti = useCallback(
    <T extends string>(key: keyof InboxFilters, value: T) => {
      pushUrl((next) => {
        const current = next.get(key as string);
        const set = new Set(current ? current.split(',') : []);
        if (set.has(value)) {
          set.delete(value);
        } else {
          set.add(value);
        }
        if (set.size === 0) next.delete(key as string);
        else next.set(key as string, [...set].join(','));
      });
    },
    [pushUrl],
  );

  const clearAll = useCallback(() => {
    setSearchDraft('');
    pushUrl((next) => {
      Array.from(next.keys()).forEach((k) => next.delete(k));
    });
  }, [pushUrl]);

  const commitSearch = useCallback(() => {
    const trimmed = searchDraft.trim();
    pushUrl((next) => {
      if (trimmed.length === 0) next.delete('q');
      else next.set('q', trimmed);
    });
  }, [pushUrl, searchDraft]);

  const activeCount = useMemo(() => {
    const parts: ReadonlyArray<number | undefined> = [
      filters.status?.length,
      filters.priority?.length,
      filters.kind?.length,
      filters.sentiment?.length,
      filters.platform?.length,
      filters.brandId ? 1 : 0,
      filters.locationId ? 1 : 0,
      filters.assignedTo ? 1 : 0,
      filters.tags?.length,
      filters.q ? 1 : 0,
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
      <div className="relative flex-1 min-w-[200px] max-w-md">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={searchDraft}
          maxLength={200}
          onChange={(e) => setSearchDraft(e.target.value)}
          onBlur={commitSearch}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitSearch();
            }
          }}
          placeholder="Buscar en mensajes…"
          className="pl-7 pr-2 h-8 text-sm"
        />
      </div>

      <MultiFilter
        label="Estado"
        values={ALLOWED_STATUS}
        current={(filters.status as ReadonlyArray<ThreadStatus>) ?? []}
        onToggle={(v) => toggleMulti('status', v)}
      />
      <MultiFilter
        label="Prioridad"
        values={ALLOWED_PRIORITY}
        current={(filters.priority as ReadonlyArray<ThreadPriority>) ?? []}
        onToggle={(v) => toggleMulti('priority', v)}
      />
      <MultiFilter
        label="Tipo"
        values={ALLOWED_KIND}
        current={(filters.kind as ReadonlyArray<ThreadKind>) ?? []}
        onToggle={(v) => toggleMulti('kind', v)}
      />
      <MultiFilter
        label="Sentimiento"
        values={ALLOWED_SENTIMENT}
        current={(filters.sentiment as ReadonlyArray<ThreadSentiment>) ?? []}
        onToggle={(v) => toggleMulti('sentiment', v)}
      />

      {activeCount > 0 ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={clearAll}
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
            className="text-xs capitalize"
          >
            {v}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
