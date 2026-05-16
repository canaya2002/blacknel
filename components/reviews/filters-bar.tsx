'use client';

import { CalendarRange, Lock, Search, Star, X } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo, useState, useTransition } from 'react';

import { fireToast } from '@/components/common/toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import type { PlatformCode } from '@/lib/connectors/base';
import { planAllowsPlatform } from '@/lib/plans/gating';
import { getPlan, type PlanCode } from '@/lib/plans/plans';
import {
  ALLOWED_REVIEW_PLATFORM,
  ALLOWED_REVIEW_RATING,
  ALLOWED_REVIEW_SENTIMENT,
  ALLOWED_REVIEW_STATUS,
  type ReviewFilters,
  type ReviewRating,
  type ReviewSentiment,
  type ReviewStatus,
} from '@/lib/reviews/filters';
import { cn } from '@/lib/utils/cn';

interface FiltersBarProps {
  filters: ReviewFilters;
  /** Active plan for the org — drives the dimmed platform rows + toast copy. */
  plan: PlanCode;
}

/**
 * URL-bound filter controls for /reviews. Same model as the inbox
 * filters bar (Commit 8): the URL is the source of truth, every change
 * pushes through `router.replace`, and the search input keeps a local
 * draft so typing doesn't fetch per-keystroke.
 *
 * Three reviews-specific behaviors:
 *
 *   - **Platform dropdown** (Ajuste 1): shows EVERY platform. The ones
 *     gated by the active plan are dimmed and tagged "Growth" /
 *     "Enterprise". Clicking a gated row never selects it — it fires a
 *     toast directing the user to upgrade. The server parser ALSO
 *     drops gated platforms (defense in depth for URL pastes); a
 *     separate banner above the list explains the drop.
 *
 *   - **Date range** (Ajuste 3): 4 presets (7d / 30d / 90d / custom).
 *     Selecting a preset writes `dateFrom` / `dateTo` to the URL and
 *     ALWAYS deletes `cursor` — leaving the old cursor would point at
 *     a `posted_at` outside the new range and return 0 rows. Custom
 *     opens two date inputs in a popover-style dropdown.
 *
 *   - **Stars rating**: multi-select 1..5 with star previews so the
 *     dropdown reads as "1★, 2★, 3★" rather than just "1, 2, 3".
 */
export function FiltersBar({ filters, plan }: FiltersBarProps): React.ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const [searchDraft, setSearchDraft] = useState(filters.q ?? '');

  const pushUrl = useCallback(
    (mutate: (next: URLSearchParams) => void) => {
      const next = new URLSearchParams(params.toString());
      // Any filter change resets pagination — Ajuste 3 spells this out
      // for date range, but the rule applies to every filter (an old
      // cursor stops being valid once the underlying ORDER BY tuple
      // shifts out of the new slice).
      next.delete('cursor');
      mutate(next);
      startTransition(() => {
        router.replace(`${pathname}?${next.toString()}` as never);
      });
    },
    [params, pathname, router],
  );

  const toggleMulti = useCallback(
    <T extends string>(key: keyof ReviewFilters, value: T) => {
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

  const toggleRating = useCallback(
    (value: ReviewRating) => {
      pushUrl((next) => {
        const current = next.get('rating');
        const set = new Set(current ? current.split(',') : []);
        const s = String(value);
        if (set.has(s)) set.delete(s);
        else set.add(s);
        if (set.size === 0) next.delete('rating');
        else next.set('rating', [...set].join(','));
      });
    },
    [pushUrl],
  );

  const togglePlatform = useCallback(
    (platform: PlatformCode) => {
      if (!planAllowsPlatform(plan, platform)) {
        // Gated row: don't mutate URL, surface the upgrade nudge.
        const required = lowestPlanIncluding(platform);
        fireToast({
          tone: 'warning',
          message: `${platform.toUpperCase()} requiere plan ${
            required ? capitalize(required) : 'superior'
          }.`,
        });
        return;
      }
      pushUrl((next) => {
        const current = next.get('platform');
        const set = new Set(current ? current.split(',') : []);
        if (set.has(platform)) set.delete(platform);
        else set.add(platform);
        if (set.size === 0) next.delete('platform');
        else next.set('platform', [...set].join(','));
      });
    },
    [plan, pushUrl],
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

  const applyPreset = useCallback(
    (days: number | 'all') => {
      pushUrl((next) => {
        if (days === 'all') {
          next.delete('dateFrom');
          next.delete('dateTo');
          return;
        }
        const to = new Date();
        const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
        next.set('dateFrom', isoDate(from));
        next.set('dateTo', isoDate(to));
      });
    },
    [pushUrl],
  );

  const applyCustomDate = useCallback(
    (from: string, to: string) => {
      pushUrl((next) => {
        if (from) next.set('dateFrom', from);
        else next.delete('dateFrom');
        if (to) next.set('dateTo', to);
        else next.delete('dateTo');
      });
    },
    [pushUrl],
  );

  const activeCount = useMemo(() => {
    const parts: ReadonlyArray<number | undefined> = [
      filters.status?.length,
      filters.rating?.length,
      filters.sentiment?.length,
      filters.platform?.length,
      filters.brandId ? 1 : 0,
      filters.locationId ? 1 : 0,
      filters.assignedTo ? 1 : 0,
      filters.q ? 1 : 0,
      filters.dateFrom || filters.dateTo ? 1 : 0,
    ];
    let total = 0;
    for (const p of parts) total += p ?? 0;
    return total;
  }, [filters]);

  return (
    <div
      className="flex flex-wrap items-center gap-2 border-b bg-card/30 px-4 py-2"
      data-testid="reviews-filters-bar"
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
          placeholder="Buscar en reseñas…"
          className="h-8 pl-7 pr-2 text-sm"
        />
      </div>

      <MultiFilter
        label="Estado"
        values={ALLOWED_REVIEW_STATUS}
        current={(filters.status as ReadonlyArray<ReviewStatus>) ?? []}
        onToggle={(v) => toggleMulti('status', v)}
      />

      <RatingFilter
        current={(filters.rating as ReadonlyArray<ReviewRating>) ?? []}
        onToggle={toggleRating}
      />

      <MultiFilter
        label="Sentimiento"
        values={ALLOWED_REVIEW_SENTIMENT}
        current={(filters.sentiment as ReadonlyArray<ReviewSentiment>) ?? []}
        onToggle={(v) => toggleMulti('sentiment', v)}
      />

      <PlatformFilter
        plan={plan}
        current={(filters.platform as ReadonlyArray<PlatformCode>) ?? []}
        onToggle={togglePlatform}
      />

      <DateRangeFilter
        from={filters.dateFrom}
        to={filters.dateTo}
        onPreset={applyPreset}
        onCustom={applyCustomDate}
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

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

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
            {v.replace('_', ' ')}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface RatingFilterProps {
  current: ReadonlyArray<ReviewRating>;
  onToggle: (v: ReviewRating) => void;
}

function RatingFilter({ current, onToggle }: RatingFilterProps): React.ReactElement {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1 text-xs">
          Estrellas
          {current.length > 0 ? (
            <Badge variant="muted" className="ml-1 text-[10px]">
              {current.length}
            </Badge>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel className="text-xs">Estrellas</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {ALLOWED_REVIEW_RATING.map((r) => (
          <DropdownMenuCheckboxItem
            key={r}
            checked={current.includes(r)}
            onCheckedChange={() => onToggle(r)}
            className="text-xs"
          >
            <span className="inline-flex items-center gap-1">
              {Array.from({ length: r }).map((_, i) => (
                <Star
                  key={i}
                  className="h-3 w-3 fill-current text-amber-500"
                  aria-hidden
                />
              ))}
              <span className="ml-1 text-muted-foreground">({r})</span>
            </span>
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface PlatformFilterProps {
  plan: PlanCode;
  current: ReadonlyArray<PlatformCode>;
  onToggle: (v: PlatformCode) => void;
}

function PlatformFilter({
  plan,
  current,
  onToggle,
}: PlatformFilterProps): React.ReactElement {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1 text-xs">
          Plataforma
          {current.length > 0 ? (
            <Badge variant="muted" className="ml-1 text-[10px]">
              {current.length}
            </Badge>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
        <DropdownMenuLabel className="text-xs">Plataforma</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {ALLOWED_REVIEW_PLATFORM.map((p) => {
          const allowed = planAllowsPlatform(plan, p);
          const required = allowed ? null : lowestPlanIncluding(p);
          if (allowed) {
            return (
              <DropdownMenuCheckboxItem
                key={p}
                checked={current.includes(p)}
                onCheckedChange={() => onToggle(p)}
                className="text-xs uppercase"
              >
                {p}
              </DropdownMenuCheckboxItem>
            );
          }
          return (
            <DropdownMenuItem
              key={p}
              onSelect={(e) => {
                e.preventDefault();
                onToggle(p); // fires the toast, never selects
              }}
              className={cn(
                'flex cursor-not-allowed items-center justify-between gap-2 text-xs uppercase opacity-60',
              )}
              title={`Disponible en plan ${required ? capitalize(required) : 'superior'}`}
            >
              <span className="inline-flex items-center gap-1.5">
                <Lock className="h-3 w-3" aria-hidden />
                {p}
              </span>
              <Badge variant="muted" className="ml-2 text-[9px] uppercase">
                {required ? capitalize(required) : 'Pro'}
              </Badge>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface DateRangeFilterProps {
  from: string | undefined;
  to: string | undefined;
  onPreset: (days: number | 'all') => void;
  onCustom: (from: string, to: string) => void;
}

function DateRangeFilter({
  from,
  to,
  onPreset,
  onCustom,
}: DateRangeFilterProps): React.ReactElement {
  const [fromDraft, setFromDraft] = useState(from ?? '');
  const [toDraft, setToDraft] = useState(to ?? '');
  const activeLabel = describeRange(from, to);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
          <CalendarRange className="h-3.5 w-3.5" aria-hidden />
          {activeLabel}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="text-xs">Rango de fechas</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onPreset(7)} className="text-xs">
          Últimos 7 días
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onPreset(30)} className="text-xs">
          Últimos 30 días
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onPreset(90)} className="text-xs">
          Últimos 90 días
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onPreset('all')} className="text-xs">
          Sin rango
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <div
          className="flex flex-col gap-2 px-2 py-2"
          // Keep the dropdown open while the user picks dates.
          onClick={(e) => e.stopPropagation()}
        >
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Custom
          </div>
          <label className="flex items-center justify-between gap-2 text-[11px]">
            Desde
            <input
              type="date"
              value={fromDraft}
              max={toDraft || isoDate(new Date())}
              onChange={(e) => setFromDraft(e.target.value)}
              className="h-7 rounded border bg-background px-1 text-xs"
            />
          </label>
          <label className="flex items-center justify-between gap-2 text-[11px]">
            Hasta
            <input
              type="date"
              value={toDraft}
              min={fromDraft || undefined}
              max={isoDate(new Date())}
              onChange={(e) => setToDraft(e.target.value)}
              className="h-7 rounded border bg-background px-1 text-xs"
            />
          </label>
          <Button
            size="sm"
            variant="default"
            className="h-7 text-xs"
            onClick={() => onCustom(fromDraft, toDraft)}
            disabled={!fromDraft && !toDraft}
          >
            Aplicar
          </Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isoDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function lowestPlanIncluding(platform: PlatformCode): PlanCode | null {
  for (const code of ['standard', 'growth', 'enterprise'] as PlanCode[]) {
    if (planAllowsPlatform(code, platform)) return code;
  }
  return null;
}

function capitalize<S extends string>(s: S): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function describeRange(from: string | undefined, to: string | undefined): string {
  if (!from && !to) return 'Cualquier fecha';
  if (from && to) {
    const presetDays = daysBetween(from, to);
    if (presetDays === 7 && isCloseToToday(to)) return 'Últimos 7d';
    if (presetDays === 30 && isCloseToToday(to)) return 'Últimos 30d';
    if (presetDays === 90 && isCloseToToday(to)) return 'Últimos 90d';
    return `${from} → ${to}`;
  }
  if (from) return `Desde ${from}`;
  return `Hasta ${to}`;
}

function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      (24 * 60 * 60 * 1000),
  );
}

function isCloseToToday(iso: string): boolean {
  const diff = Math.abs(Date.now() - Date.parse(`${iso}T00:00:00Z`));
  return diff < 36 * 60 * 60 * 1000; // within 36h of today
}

// Touch `getPlan` so a future PR that drops it from `lib/plans/plans.ts`
// doesn't silently break the upgrade-prompt copy paths above.
void getPlan;
