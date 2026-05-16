'use client';

import { ChevronLeft, ChevronRight, LayoutGrid, List } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { PublishCalLayout } from '@/lib/publish/filters';
import { cn } from '@/lib/utils/cn';

interface CalendarHeaderProps {
  /** Month being viewed (first instant, UTC). */
  monthDate: Date;
  /** Calendar layout: month grid or flat list. */
  cal: PublishCalLayout;
  /** Total count of posts in the filtered month (informational). */
  monthPostCount: number;
}

const MONTH_NAMES_ES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

/**
 * Header for the calendar tab. Renders prev/next month navigation,
 * a "Hoy" jump, a month/year dropdown, the post-count for the
 * current month, and a Month/List layout toggle (Ajuste 1 — toggle
 * lives in the URL as `?cal=`).
 *
 * The month picker exposes ±6 months around the current view —
 * deeper navigation goes through the prev/next arrows. That keeps
 * the dropdown tractable on small viewports.
 */
export function CalendarHeader({
  monthDate,
  cal,
  monthPostCount,
}: CalendarHeaderProps): React.ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const monthName =
    `${MONTH_NAMES_ES[monthDate.getUTCMonth()]} ${monthDate.getUTCFullYear()}`;

  const navigate = (target: Date | null): void => {
    const next = new URLSearchParams(params.toString());
    if (target === null) {
      next.delete('month');
    } else {
      const ym = `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, '0')}`;
      next.set('month', ym);
    }
    const query = next.toString();
    startTransition(() => {
      router.replace(`${pathname}${query ? `?${query}` : ''}` as never);
    });
  };

  const setLayout = (layout: PublishCalLayout): void => {
    const next = new URLSearchParams(params.toString());
    if (layout === 'month') next.delete('cal');
    else next.set('cal', layout);
    const query = next.toString();
    startTransition(() => {
      router.replace(`${pathname}${query ? `?${query}` : ''}` as never);
    });
  };

  const monthOffset = (delta: number): Date =>
    new Date(
      Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth() + delta, 1),
    );

  return (
    <div
      className="flex flex-wrap items-center gap-2 border-b bg-card/30 px-6 py-2"
      data-testid="publish-calendar-header"
    >
      <Button
        size="icon"
        variant="ghost"
        className="h-8 w-8"
        aria-label="Mes anterior"
        onClick={() => navigate(monthOffset(-1))}
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="h-8 w-8"
        aria-label="Mes siguiente"
        onClick={() => navigate(monthOffset(1))}
      >
        <ChevronRight className="h-4 w-4" aria-hidden />
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="h-8 text-xs"
        onClick={() => navigate(null)}
        data-testid="publish-calendar-today"
      >
        Hoy
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-sm font-semibold capitalize"
          >
            {monthName}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {[-6, -3, -1, 0, 1, 3, 6].map((d) => {
            const target = d === 0 ? null : monthOffset(d);
            const label =
              target === null
                ? `Mes actual`
                : `${MONTH_NAMES_ES[target.getUTCMonth()]} ${target.getUTCFullYear()}`;
            return (
              <DropdownMenuItem
                key={d}
                onSelect={() => navigate(target)}
                className="text-xs capitalize"
              >
                {label}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      <span
        className="ml-2 text-xs text-muted-foreground"
        data-testid="publish-calendar-count"
      >
        {monthPostCount} post{monthPostCount === 1 ? '' : 's'} en el mes
      </span>

      <div className="ml-auto flex items-center gap-1">
        <Button
          size="icon"
          variant={cal === 'month' ? 'secondary' : 'ghost'}
          className={cn('h-8 w-8')}
          aria-label="Vista mensual"
          aria-pressed={cal === 'month'}
          onClick={() => setLayout('month')}
        >
          <LayoutGrid className="h-4 w-4" aria-hidden />
        </Button>
        <Button
          size="icon"
          variant={cal === 'list' ? 'secondary' : 'ghost'}
          className={cn('h-8 w-8')}
          aria-label="Vista de lista"
          aria-pressed={cal === 'list'}
          onClick={() => setLayout('list')}
        >
          <List className="h-4 w-4" aria-hidden />
        </Button>
        {pending ? (
          <span className="text-[10px] text-muted-foreground">…</span>
        ) : null}
      </div>
    </div>
  );
}
