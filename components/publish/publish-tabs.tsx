'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

import { Badge } from '@/components/ui/badge';
import {
  ALLOWED_VIEW,
  type PublishView,
} from '@/lib/publish/filters';
import type { PostKpiCounts } from '@/lib/publish/queries';
import { cn } from '@/lib/utils/cn';

interface PublishTabsProps {
  view: PublishView;
  kpis: PostKpiCounts;
}

interface TabSpec {
  view: PublishView;
  label: string;
  /** Returns the badge count for this tab, or null when no badge should render. */
  count: (k: PostKpiCounts) => number | null;
  /** Badge variant — used to flag tabs that need attention. */
  badgeVariant?: 'default' | 'muted' | 'destructive';
}

const TABS: ReadonlyArray<TabSpec> = [
  { view: 'calendar', label: 'Calendario', count: () => null },
  {
    view: 'drafts',
    label: 'Borradores',
    count: (k) => k.drafts + k.pendingApproval,
    badgeVariant: 'muted',
  },
  {
    view: 'scheduled',
    label: 'Agendados',
    count: (k) => k.scheduled + k.publishing,
    badgeVariant: 'default',
  },
  {
    view: 'published',
    label: 'Publicados',
    count: (k) => k.published,
    badgeVariant: 'muted',
  },
  {
    view: 'failed',
    label: 'Fallidos',
    count: (k) => k.failed,
    badgeVariant: 'destructive',
  },
];

/**
 * URL-bound tabs (Ajuste 1). Switching tabs writes `?view=` and
 * preserves every other filter. Defaults to `calendar` — when the
 * user lands on `/publish` with no params we render that variant.
 *
 * Implemented as anchor links so the browser handles back/forward
 * out of the box; the `replace` semantics keep the history clean
 * (each tab change isn't a new history entry).
 */
export function PublishTabs({
  view,
  kpis,
}: PublishTabsProps): React.ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const switchTo = (next: PublishView): void => {
    const out = new URLSearchParams(params.toString());
    if (next === 'calendar') out.delete('view');
    else out.set('view', next);
    // Drop the calendar layout param when leaving the calendar tab —
    // it only applies to that view.
    if (next !== 'calendar') out.delete('cal');
    // Reset the month-nav when leaving calendar so going back lands
    // on the current month, not whatever month we'd navigated to.
    if (next !== 'calendar') out.delete('month');
    const query = out.toString();
    startTransition(() => {
      router.replace(`${pathname}${query ? `?${query}` : ''}` as never);
    });
  };

  return (
    <div
      role="tablist"
      aria-label="Vista de publish"
      className="flex flex-wrap items-center gap-1 border-b bg-card/30 px-6"
      data-testid="publish-tabs"
    >
      {TABS.map((t) => {
        const active = t.view === view;
        const c = t.count(kpis);
        return (
          <button
            key={t.view}
            role="tab"
            aria-selected={active}
            onClick={() => switchTo(t.view)}
            className={cn(
              'group relative inline-flex items-center gap-2 px-3 py-2.5 text-sm font-medium transition-colors',
              active
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
            data-testid={`publish-tab-${t.view}`}
            data-active={active}
          >
            <span>{t.label}</span>
            {c !== null && c > 0 ? (
              <Badge
                variant={t.badgeVariant ?? 'muted'}
                className="h-5 min-w-5 px-1.5 text-[10px] tabular-nums"
              >
                {c}
              </Badge>
            ) : null}
            {active ? (
              <span
                aria-hidden
                className="absolute inset-x-0 -bottom-px h-0.5 bg-primary"
              />
            ) : null}
          </button>
        );
      })}
      {pending ? (
        <Badge variant="muted" className="ml-auto text-[10px]">
          Cambiando…
        </Badge>
      ) : null}
      <noscript>
        <div className="ml-3 text-xs text-muted-foreground">
          Activa JavaScript para cambiar de tab —{' '}
          {ALLOWED_VIEW.filter((v) => v !== view).join(' · ')}
        </div>
      </noscript>
    </div>
  );
}
