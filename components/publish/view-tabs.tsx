import Link from 'next/link';

import { cn } from '@/lib/utils/cn';
import { encodePublishFilters, type PublishFilters, type PublishView } from '@/lib/publish/filters';
import type { PostKpiCounts } from '@/lib/publish/queries';

interface ViewTabsProps {
  filters: PublishFilters;
  kpis: PostKpiCounts;
}

interface TabSpec {
  view: PublishView;
  label: string;
  count: (kpis: PostKpiCounts) => number | null;
}

const TABS: ReadonlyArray<TabSpec> = [
  { view: 'calendar', label: 'Calendario', count: () => null },
  { view: 'drafts', label: 'Borradores', count: (k) => k.drafts + k.pendingApproval },
  { view: 'scheduled', label: 'Agendados', count: (k) => k.scheduled + k.publishing },
  { view: 'published', label: 'Publicados', count: (k) => k.published },
  { view: 'failed', label: 'Fallidos', count: (k) => k.failed },
];

/**
 * URL-driven tab bar (Ajuste 1). Each tab is a `<Link>` that writes
 * `?view=<value>` while preserving every other filter — bookmarking
 * `/publish?view=failed&brandId=<uuid>` lands on the same view on
 * refresh.
 *
 * A11y (Ajuste D2): the wrapper carries `role="tablist"` with an
 * `aria-label`; each link is a `role="tab"` with `aria-selected` and
 * `aria-current="page"` on the active tab. We are NOT using Radix
 * Tabs because the source of truth is the URL — Radix's internal
 * client state would just shadow `filters.view`.
 */
export function ViewTabs({ filters, kpis }: ViewTabsProps): React.ReactElement {
  return (
    <nav
      role="tablist"
      aria-label="Vista de publicaciones"
      className="flex flex-wrap items-center gap-1 border-b px-4"
    >
      {TABS.map((tab) => (
        <ViewTab key={tab.view} tab={tab} filters={filters} kpis={kpis} />
      ))}
    </nav>
  );
}

function ViewTab({
  tab,
  filters,
  kpis,
}: {
  tab: TabSpec;
  filters: PublishFilters;
  kpis: PostKpiCounts;
}): React.ReactElement {
  const isActive = filters.view === tab.view;
  const next = encodePublishFilters({ ...filters, view: tab.view });
  const href = next.toString() ? `/publish?${next.toString()}` : '/publish';
  const count = tab.count(kpis);

  return (
    <Link
      role="tab"
      aria-selected={isActive}
      aria-current={isActive ? 'page' : undefined}
      href={href}
      prefetch={false}
      className={cn(
        'inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
        isActive
          ? 'border-foreground text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground',
      )}
    >
      <span>{tab.label}</span>
      {count !== null ? (
        <span
          aria-hidden
          className={cn(
            'inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] tabular-nums',
            isActive
              ? 'bg-foreground text-background'
              : 'bg-muted text-muted-foreground',
          )}
        >
          {count}
        </span>
      ) : null}
    </Link>
  );
}
