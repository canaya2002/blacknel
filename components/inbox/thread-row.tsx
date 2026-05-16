'use client';

import { Circle } from 'lucide-react';
import Link from 'next/link';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils/cn';

import type { ThreadListItem } from '@/lib/inbox/queries';

interface ThreadRowProps {
  thread: ThreadListItem;
}

const PLATFORM_INITIALS: Record<string, string> = {
  facebook: 'FB',
  instagram: 'IG',
  gbp: 'GBP',
  whatsapp: 'WA',
  tiktok: 'TK',
  linkedin: 'LI',
  x: 'X',
  youtube: 'YT',
  pinterest: 'PIN',
  reddit: 'RD',
  yelp: 'Y',
  tripadvisor: 'TA',
  trustpilot: 'TP',
  bbb: 'BBB',
  avvo: 'AV',
};

const STATUS_TONE: Record<ThreadListItem['status'], string> = {
  open: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  pending: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
  closed: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400',
  snoozed: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  spam: 'bg-red-500/15 text-red-700 dark:text-red-300',
};

const PRIORITY_DOT: Record<ThreadListItem['priority'], string> = {
  low: 'text-zinc-400',
  normal: 'text-zinc-500',
  high: 'text-amber-500',
  urgent: 'text-red-500',
};

const SENTIMENT_TONE: Record<ThreadListItem['sentiment'], string> = {
  positive: 'text-emerald-600 dark:text-emerald-400',
  neutral: 'text-zinc-500',
  negative: 'text-red-600 dark:text-red-400',
  unknown: 'text-zinc-400',
};

function timeAgo(date: Date): string {
  const ms = Date.now() - date.getTime();
  const m = Math.round(ms / 60000);
  if (m < 1) return 'ahora';
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d`;
  return `${Math.round(d / 7)}sem`;
}

export function ThreadRow({ thread }: ThreadRowProps): React.ReactElement {
  const initials =
    thread.contactName
      ?.split(' ')
      .map((p) => p[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() ?? PLATFORM_INITIALS[thread.platform] ?? '??';

  return (
    <Link
      href={`/inbox/${thread.id}` as `/inbox/${string}`}
      className="flex items-start gap-3 border-b px-4 py-3 transition-colors hover:bg-accent/40"
      data-testid="thread-row"
    >
      <Avatar className="h-9 w-9 shrink-0">
        {thread.contactAvatarUrl ? (
          <AvatarImage src={thread.contactAvatarUrl} alt={thread.contactName ?? ''} />
        ) : null}
        <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
      </Avatar>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <Circle
            className={cn('h-2 w-2 shrink-0 fill-current', PRIORITY_DOT[thread.priority])}
            aria-label={`Priority ${thread.priority}`}
          />
          <span className="truncate text-sm font-medium">
            {thread.contactName ?? thread.contactHandle ?? 'Sin nombre'}
          </span>
          <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
            {PLATFORM_INITIALS[thread.platform] ?? thread.platform}
          </span>
          <span className="ml-auto shrink-0 text-xs text-muted-foreground">
            {timeAgo(thread.lastMessageAt)}
          </span>
        </div>

        {thread.subject ? (
          <span className="truncate text-sm font-medium text-foreground/90">
            {thread.subject}
          </span>
        ) : null}

        {thread.snippet ? (
          <span className="line-clamp-1 text-xs text-muted-foreground">
            {thread.snippet}
          </span>
        ) : null}

        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
              STATUS_TONE[thread.status],
            )}
          >
            {thread.status}
          </span>
          <span className={cn('text-[10px] capitalize', SENTIMENT_TONE[thread.sentiment])}>
            {thread.sentiment}
          </span>
          {thread.tags.slice(0, 3).map((tag) => (
            <Badge key={tag} variant="muted" className="text-[10px]">
              {tag}
            </Badge>
          ))}
          {thread.assignedTo ? null : (
            <span className="text-[10px] italic text-amber-600 dark:text-amber-400">
              sin asignar
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
