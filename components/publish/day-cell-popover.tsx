'use client';

import Link from 'next/link';
import { useState } from 'react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils/cn';
import type { CalendarPost } from '@/lib/publish/queries';

import { DayCellPost } from './day-cell-post';

interface DayCellPopoverProps {
  dateKey: string;
  posts: ReadonlyArray<CalendarPost>;
  timeZone: string;
  locale: string;
}

/**
 * Client-side popover triggered by the `+N más` button on a day
 * cell. Lists the full set of posts for that day (post-list-item
 * styling) and, when the list exceeds the threshold, offers a
 * "Ver todos los posts de este día" link that navigates to the
 * published-tab filtered to the same calendar day. That covers the
 * rare 10+ posts/day edge case without bloating the popover.
 */
const VIEW_ALL_THRESHOLD = 10;

export function DayCellPopover({
  dateKey,
  posts,
  timeZone,
  locale,
}: DayCellPopoverProps): React.ReactElement {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex w-full items-center justify-start rounded px-1 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
          )}
        >
          +{posts.length} más
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        className="w-80 max-w-[calc(100vw-2rem)] p-2"
      >
        <div className="border-b px-1 pb-2 text-xs font-medium text-muted-foreground">
          {formatDayHeader(dateKey, locale, timeZone)}
        </div>
        <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto pt-2">
          {posts.map((post) => (
            <li key={post.id}>
              <DayCellPost post={post} timeZone={timeZone} truncate />
            </li>
          ))}
        </ul>
        {posts.length >= VIEW_ALL_THRESHOLD ? (
          <div className="border-t pt-2">
            <Link
              href={`/publish?view=published&scheduledFrom=${dateKey}&scheduledTo=${dateKey}`}
              prefetch={false}
              className="block px-1 py-1 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setOpen(false)}
            >
              Ver todos los posts de este día →
            </Link>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function formatDayHeader(dateKey: string, locale: string, timeZone: string): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  if (!year || !month || !day) return dateKey;
  // Build a UTC anchor for the abstract Y/M/D label, formatted in
  // `timeZone` so DST never shifts the rendered date.
  const date = new Date(Date.UTC(year, month - 1, day));
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(date) + ` (${timeZone})`;
}
