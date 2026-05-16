import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  monthLabel,
  monthParamValue,
  nextMonth,
  prevMonth,
  thisMonthIn,
} from '@/lib/publish/calendar-grid';
import {
  encodePublishFilters,
  type PublishFilters,
} from '@/lib/publish/filters';

import { CalLayoutToggle } from './cal-layout-toggle';

interface CalendarMonthHeaderProps {
  filters: PublishFilters;
  /** Posts that fall in the visible month (after filters). */
  totalPosts: number;
  /** Wall-clock now from the page. Drives the "Hoy" button. */
  now: Date;
  /** IANA timezone for "Hoy" resolution. */
  timeZone: string;
  /** BCP-47 locale for month labels. */
  locale: string;
}

/**
 * Calendar month header: prev/next nav, "Hoy", month/year label,
 * total-posts hint, and the month/list toggle. The nav writes
 * `?month=YYYY-MM` into the URL (Ajuste 1) so refresh and shared
 * links stay coherent.
 *
 * The month/year selector is intentionally a plain dropdown (no
 * popover, no client form) — clicking renders a list of links to
 * the surrounding ±6 months, which is plenty for browsing without a
 * full date picker. Year selection lands with the Phase-8 reports
 * date picker work.
 */
export function CalendarMonthHeader({
  filters,
  totalPosts,
  now,
  timeZone,
  locale,
}: CalendarMonthHeaderProps): React.ReactElement {
  const prev = prevMonth(filters.monthDate);
  const next = nextMonth(filters.monthDate);
  const today = thisMonthIn(now, timeZone);
  const isThisMonth = monthParamValue(filters.monthDate) === monthParamValue(today);

  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-card/30 px-6 py-2">
      <div className="flex items-center gap-1">
        <NavLink filters={filters} target={prev} label="Mes anterior">
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </NavLink>
        <Button
          asChild
          size="sm"
          variant="ghost"
          className="h-8 text-xs"
          disabled={isThisMonth}
        >
          {isThisMonth ? (
            <span aria-disabled className="opacity-60">Hoy</span>
          ) : (
            <Link
              href={buildHref({ ...filters, monthDate: today })}
              prefetch={false}
            >
              Hoy
            </Link>
          )}
        </Button>
        <NavLink filters={filters} target={next} label="Mes siguiente">
          <ChevronRight className="h-4 w-4" aria-hidden />
        </NavLink>
        <h2 className="ml-2 text-sm font-semibold capitalize tracking-tight">
          {monthLabel(filters.monthDate, locale)}
        </h2>
        <span className="ml-2 text-xs text-muted-foreground">
          · {totalPosts} {totalPosts === 1 ? 'post' : 'posts'}
        </span>
      </div>
      <CalLayoutToggle filters={filters} />
    </header>
  );
}

function NavLink({
  filters,
  target,
  label,
  children,
}: {
  filters: PublishFilters;
  target: Date;
  label: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <Button asChild size="icon" variant="ghost" className="h-8 w-8">
      <Link
        href={buildHref({ ...filters, monthDate: target })}
        prefetch={false}
        aria-label={label}
      >
        {children}
      </Link>
    </Button>
  );
}

function buildHref(nextFilters: PublishFilters): string {
  // The encoder drops defaults; we always emit `month=` when it's
  // not the page's "now" anchor so the URL is shareable.
  const params = encodePublishFilters(nextFilters);
  params.set('month', monthParamValue(nextFilters.monthDate));
  return `/publish?${params.toString()}`;
}
