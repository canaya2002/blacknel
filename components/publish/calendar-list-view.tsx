import { dateKeyInZone } from '@/lib/publish/calendar-grid';
import type { CalendarPost } from '@/lib/publish/queries';

import { DayCellPost } from './day-cell-post';

interface CalendarListViewProps {
  posts: ReadonlyArray<CalendarPost>;
  timeZone: string;
  locale: string;
}

/**
 * Chronological list view of the month — same data the grid
 * renders, just stacked vertically with day-headers. This is also
 * the mobile-default layout (Ajuste B: at narrow viewports the
 * parent page hides the grid and shows this).
 *
 * Posts are grouped by their day-key in `timeZone`; days with zero
 * posts are skipped (unlike the grid, which always shows the full
 * month).
 */
export function CalendarListView({
  posts,
  timeZone,
  locale,
}: CalendarListViewProps): React.ReactElement {
  const grouped = groupForList(posts, timeZone);

  if (grouped.length === 0) {
    return (
      <div className="px-6 py-6 text-sm text-muted-foreground">
        Sin posts en este mes con los filtros actuales.
      </div>
    );
  }

  const dayFormatter = new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  return (
    <div className="flex flex-col gap-4 px-6 py-4">
      {grouped.map(({ dateKey, posts: dayPosts }) => {
        const [year, month, day] = dateKey.split('-').map(Number);
        const anchor = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
        return (
          <section key={dateKey} className="flex flex-col gap-1.5">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {dayFormatter.format(anchor)}
            </h3>
            <ul className="flex flex-col gap-1 rounded-lg border bg-card p-2">
              {dayPosts.map((p) => (
                <li key={p.id}>
                  <DayCellPost post={p} timeZone={timeZone} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function groupForList(
  posts: ReadonlyArray<CalendarPost>,
  timeZone: string,
): Array<{ dateKey: string; posts: CalendarPost[] }> {
  const byKey = new Map<string, CalendarPost[]>();
  for (const p of posts) {
    const utc = p.scheduledAt ?? p.publishedAt;
    if (!utc) continue;
    const key = dateKeyInZone(utc, timeZone);
    const bucket = byKey.get(key) ?? [];
    bucket.push(p);
    byKey.set(key, bucket);
  }
  return Array.from(byKey.entries())
    .map(([dateKey, dayPosts]) => ({
      dateKey,
      posts: dayPosts.sort((a, b) => {
        const ta = (a.scheduledAt ?? a.publishedAt)?.getTime() ?? 0;
        const tb = (b.scheduledAt ?? b.publishedAt)?.getTime() ?? 0;
        return ta - tb;
      }),
    }))
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}
