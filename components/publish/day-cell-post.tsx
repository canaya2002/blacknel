import Link from 'next/link';

import { cn } from '@/lib/utils/cn';
import type { CalendarPost, PostListStatus } from '@/lib/publish/queries';

interface DayCellPostProps {
  post: CalendarPost;
  timeZone: string;
  /** When true, the row uses single-line ellipsis instead of wrapping. */
  truncate?: boolean;
}

/**
 * Single row representing a post inside a day cell. Status drives
 * the swatch color (Ajuste 2 color taxonomy); the link points at
 * the post-detail / composer route landing in Commit 19. Until
 * then `/publish/composer/[id]` returns the placeholder.
 */
export function DayCellPost({
  post,
  timeZone,
  truncate,
}: DayCellPostProps): React.ReactElement {
  const time = formatTime(post.scheduledAt ?? post.publishedAt, timeZone);
  const excerpt = post.text.trim().slice(0, 120);

  return (
    <Link
      href={`/publish/composer/${post.id}`}
      prefetch={false}
      className={cn(
        'flex items-start gap-1.5 rounded px-1 py-0.5 text-[11px] leading-tight transition-colors',
        statusBgFor(post.status),
        'hover:brightness-95',
      )}
    >
      <span className={cn('mt-0.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full', statusDotFor(post.status))} aria-hidden />
      {time ? (
        <span className="shrink-0 font-medium tabular-nums opacity-80">{time}</span>
      ) : null}
      <span
        className={cn(
          'min-w-0 flex-1',
          truncate ? 'line-clamp-1' : 'line-clamp-1',
        )}
        title={post.text}
      >
        {excerpt}
      </span>
    </Link>
  );
}

function formatTime(d: Date | null | undefined, timeZone: string): string | null {
  if (!d) return null;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

/**
 * Background swatch by status. Light shades; the dot indicator
 * carries the saturated color so the row stays legible. Spec from
 * Ajuste 2 + master prompt §11.4 status taxonomy.
 */
function statusBgFor(status: PostListStatus): string {
  switch (status) {
    case 'draft':
      return 'bg-zinc-100 text-zinc-800 dark:bg-zinc-800/60 dark:text-zinc-200';
    case 'pending_approval':
      return 'bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100';
    case 'scheduled':
    case 'publishing':
      return 'bg-blue-100 text-blue-900 dark:bg-blue-950/40 dark:text-blue-100';
    case 'published':
      return 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100';
    case 'failed':
      return 'bg-red-100 text-red-900 dark:bg-red-950/40 dark:text-red-100';
    case 'cancelled':
    default:
      return 'bg-zinc-50 text-zinc-500 dark:bg-zinc-900/60 dark:text-zinc-400';
  }
}

function statusDotFor(status: PostListStatus): string {
  switch (status) {
    case 'draft':
      return 'bg-zinc-400 dark:bg-zinc-500';
    case 'pending_approval':
      return 'bg-amber-500';
    case 'scheduled':
    case 'publishing':
      return 'bg-blue-500';
    case 'published':
      return 'bg-emerald-500';
    case 'failed':
      return 'bg-red-500';
    case 'cancelled':
    default:
      return 'bg-zinc-300 dark:bg-zinc-600';
  }
}
