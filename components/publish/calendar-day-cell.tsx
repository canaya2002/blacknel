'use client';

import { cn } from '@/lib/utils/cn';

import {
  formatHourEs,
  type CalendarCell,
} from './calendar-utils';
import { leftBorderForCell, statusStyle } from './status-style';

interface CalendarDayCellProps {
  cell: CalendarCell;
  onOverflowClick: (cell: CalendarCell) => void;
}

/** Max posts rendered inline before we collapse the tail into "+N más". */
const VISIBLE_LIMIT = 3;

/**
 * Single day cell in the month grid (Ajuste 2). Three rules:
 *
 *   1. At most {@link VISIBLE_LIMIT} pills render inline; everything
 *      else collapses into a "+N más" button that opens the day
 *      popover.
 *   2. Pills are color-coded by status (status-style.ts) and sorted
 *      by display time ascending — the calendar-utils builder
 *      already sorts.
 *   3. Cells with ≥1 failed or ≥1 pending_approval post get a
 *      colored left border so problems jump out (red beats amber).
 *
 * Today gets a subtle background; cells outside the viewing month
 * are dimmed via `opacity-50`.
 */
export function CalendarDayCell({
  cell,
  onOverflowClick,
}: CalendarDayCellProps): React.ReactElement {
  const statuses = cell.posts.map((p) => p.status);
  const border = leftBorderForCell(statuses);

  const visible = cell.posts.slice(0, VISIBLE_LIMIT);
  const overflow = cell.posts.length - visible.length;

  return (
    <div
      className={cn(
        'relative flex min-h-[7rem] flex-col gap-1 border-b border-r bg-card px-1.5 py-1 text-left',
        !cell.inMonth && 'opacity-50',
        cell.isToday && 'bg-primary/[0.06]',
        // Left ribbon when problems exist in this cell. 3px wide.
        border &&
          "before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:content-['']",
        border === 'red' && 'before:bg-red-500',
        border === 'amber' && 'before:bg-amber-500',
      )}
      data-testid="publish-day-cell"
      data-in-month={cell.inMonth}
      data-today={cell.isToday}
      data-border={border ?? 'none'}
    >
      <div
        className={cn(
          'flex items-center justify-between pl-1 pr-0.5 text-[11px] font-medium tabular-nums',
          cell.isToday ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        <span>{cell.date.getUTCDate()}</span>
        {cell.posts.length > 0 ? (
          <span className="text-[10px] text-muted-foreground/70">
            {cell.posts.length}
          </span>
        ) : null}
      </div>

      <div className="flex flex-col gap-0.5">
        {visible.map((p) => {
          const s = statusStyle(p.status);
          return (
            <a
              key={p.id}
              href={`/publish/composer/${p.id}`}
              title={`${s.label} · ${formatHourEs(p.displayTime)} · ${p.text}`}
              className={cn(
                'flex items-center gap-1 truncate rounded px-1.5 py-0.5 text-[10px] font-medium hover:opacity-80',
                s.chip,
              )}
              data-testid="publish-day-cell-post"
              data-status={p.status}
            >
              <span className="tabular-nums opacity-70">
                {formatHourEs(p.displayTime)}
              </span>
              <span className="truncate">{p.text}</span>
            </a>
          );
        })}

        {overflow > 0 ? (
          <button
            type="button"
            onClick={() => onOverflowClick(cell)}
            className="self-start rounded px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
            data-testid="publish-day-cell-overflow"
          >
            +{overflow} más
          </button>
        ) : null}
      </div>
    </div>
  );
}
