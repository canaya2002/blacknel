import { cn } from '@/lib/utils/cn';
import type { GroupedDay } from '@/lib/publish/calendar-grid';

import { DayCellPopover } from './day-cell-popover';
import { DayCellPost } from './day-cell-post';

interface DayCellProps {
  /** Calendar day-key (`YYYY-MM-DD` in the org's timezone). */
  dateKey: string;
  /** Numeric day-of-month label (1..31). */
  dayLabel: number;
  /** True if this cell belongs to the previous or next month. */
  isOtherMonth: boolean;
  /** True if this cell is "today" in the org's timezone. */
  isToday: boolean;
  /** Pre-grouped post bucket for this day. May be empty. */
  group: GroupedDay | undefined;
  /** Timezone used for time formatting inside post rows. */
  timeZone: string;
  /** Locale for popover header labels. */
  locale: string;
}

/** Maximum posts rendered inline before falling back to the "+N más" popover. */
const VISIBLE_POSTS = 3;

/**
 * One cell of the month grid. Applies the Ajuste 2 rules:
 *
 *   - up to 3 posts visible, sorted by `scheduled_at` asc;
 *   - color swatch by status (delegated to `DayCellPost`);
 *   - left border in red when the day has a `failed` post, in
 *     amber when it has a `pending_approval` post — failed wins
 *     when both apply (it's strictly more actionable);
 *   - today highlighted with a subtle background;
 *   - other-month days dimmed via `opacity-50`.
 */
export function DayCell({
  dateKey,
  dayLabel,
  isOtherMonth,
  isToday,
  group,
  timeZone,
  locale,
}: DayCellProps): React.ReactElement {
  const posts = group?.posts ?? [];
  const visible = posts.slice(0, VISIBLE_POSTS);
  const overflowCount = posts.length - visible.length;
  const hasFailed = group?.hasFailed ?? false;
  const hasPendingApproval = group?.hasPendingApproval ?? false;

  return (
    <div
      data-testid="publish-day-cell"
      data-date={dateKey}
      data-other-month={isOtherMonth || undefined}
      data-today={isToday || undefined}
      data-has-failed={hasFailed || undefined}
      data-has-pending={hasPendingApproval || undefined}
      className={cn(
        'relative flex min-h-[7rem] flex-col gap-1 border-r border-b border-border p-1.5',
        isOtherMonth && 'opacity-50',
        isToday && 'bg-muted/40',
        // Left-border accent — failed takes precedence over pending.
        hasFailed
          ? 'border-l-2 border-l-red-500'
          : hasPendingApproval
            ? 'border-l-2 border-l-amber-500'
            : 'border-l border-l-transparent',
      )}
    >
      <header className="flex items-center justify-between text-[11px]">
        <span
          className={cn(
            'inline-flex h-5 w-5 items-center justify-center rounded-full tabular-nums',
            isToday
              ? 'bg-foreground text-background font-semibold'
              : 'text-muted-foreground',
          )}
        >
          {dayLabel}
        </span>
      </header>
      <ul className="flex flex-1 flex-col gap-0.5">
        {visible.map((post) => (
          <li key={post.id}>
            <DayCellPost post={post} timeZone={timeZone} />
          </li>
        ))}
      </ul>
      {overflowCount > 0 ? (
        <DayCellPopover
          dateKey={dateKey}
          posts={posts}
          timeZone={timeZone}
          locale={locale}
        />
      ) : null}
    </div>
  );
}
