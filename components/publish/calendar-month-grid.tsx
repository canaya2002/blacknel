import {
  buildMonthGrid,
  groupPostsByDay,
  todayKeyInZone,
  weekdayLabels,
} from '@/lib/publish/calendar-grid';
import { cn } from '@/lib/utils/cn';
import type { CalendarPost } from '@/lib/publish/queries';

import { DayCell } from './day-cell';

interface CalendarMonthGridProps {
  monthDate: Date;
  posts: ReadonlyArray<CalendarPost>;
  /** IANA timezone the user lives in — drives day bucketing. */
  timeZone: string;
  /** BCP-47 locale for weekday labels and popover headers. */
  locale: string;
  /** Wall-clock now from the page; resolves "today" in `timeZone`. */
  now: Date;
}

/**
 * Server-rendered month grid. The pure helpers in
 * `lib/publish/calendar-grid.ts` build the 6×7 cells, bucket posts
 * into the user's timezone, and surface failed/pending flags per
 * day — this component just composes the layout.
 *
 * Hidden below the `md` breakpoint (Ajuste B) — the parent page
 * swaps to the list view on mobile. The grid stays on the desktop
 * focus where 7 columns × multiple posts/cell actually fits.
 */
export function CalendarMonthGrid({
  monthDate,
  posts,
  timeZone,
  locale,
  now,
}: CalendarMonthGridProps): React.ReactElement {
  const cells = buildMonthGrid(monthDate, timeZone);
  const groups = groupPostsByDay(posts, cells, timeZone);
  const todayKey = todayKeyInZone(now, timeZone);
  const weekdays = weekdayLabels(locale);

  return (
    <div className="hidden flex-col px-6 py-3 md:flex">
      <div
        className={cn(
          'grid grid-cols-7 overflow-hidden rounded-lg border bg-card',
        )}
      >
        <div className="contents">
          {weekdays.map((label) => (
            <div
              key={label}
              className="border-b border-r bg-muted/40 px-2 py-1.5 text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground last:border-r-0"
            >
              {label}
            </div>
          ))}
        </div>
        {cells.map((cell) => (
          <DayCell
            key={cell.dateKey}
            dateKey={cell.dateKey}
            dayLabel={cell.date.getUTCDate()}
            isOtherMonth={cell.isOtherMonth}
            isToday={cell.dateKey === todayKey}
            group={groups.get(cell.dateKey)}
            timeZone={timeZone}
            locale={locale}
          />
        ))}
      </div>
    </div>
  );
}
