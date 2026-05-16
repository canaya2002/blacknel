import Link from 'next/link';
import { LayoutGrid, List } from 'lucide-react';

import { cn } from '@/lib/utils/cn';
import {
  encodePublishFilters,
  type PublishCalLayout,
  type PublishFilters,
} from '@/lib/publish/filters';

interface CalLayoutToggleProps {
  filters: PublishFilters;
}

interface ToggleSpec {
  cal: PublishCalLayout;
  label: string;
  Icon: typeof LayoutGrid;
}

const TOGGLES: ReadonlyArray<ToggleSpec> = [
  { cal: 'month', label: 'Mes', Icon: LayoutGrid },
  { cal: 'list', label: 'Lista', Icon: List },
];

/**
 * Month vs list toggle for the calendar view. Like `ViewTabs`, the
 * source of truth is the URL — `?cal=month|list` — so a refresh or
 * shared link lands on the same layout.
 *
 * Only rendered when `filters.view === 'calendar'`; the named tabs
 * (drafts/scheduled/published/failed) always render the list shape.
 */
export function CalLayoutToggle({ filters }: CalLayoutToggleProps): React.ReactElement {
  return (
    <div
      role="group"
      aria-label="Disposición del calendario"
      className="inline-flex items-center gap-0.5 rounded-md border bg-card p-0.5 text-xs"
    >
      {TOGGLES.map((spec) => {
        const isActive = filters.cal === spec.cal;
        const next = encodePublishFilters({ ...filters, cal: spec.cal });
        const href = next.toString() ? `/publish?${next.toString()}` : '/publish';
        return (
          <Link
            key={spec.cal}
            href={href}
            prefetch={false}
            aria-pressed={isActive}
            className={cn(
              'inline-flex items-center gap-1 rounded px-2 py-1 transition-colors',
              isActive
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <spec.Icon className="h-3.5 w-3.5" aria-hidden />
            <span>{spec.label}</span>
          </Link>
        );
      })}
    </div>
  );
}
