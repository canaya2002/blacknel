import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import type { ThreadHeader } from '@/lib/inbox/thread-detail';
import { cn } from '@/lib/utils/cn';

const STATUS_TONE: Record<ThreadHeader['status'], string> = {
  open: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  pending: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
  closed: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400',
  snoozed: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  spam: 'bg-red-500/15 text-red-700 dark:text-red-300',
};

const PRIORITY_TONE: Record<ThreadHeader['priority'], string> = {
  low: 'text-zinc-500',
  normal: 'text-zinc-500',
  high: 'text-amber-600 dark:text-amber-400',
  urgent: 'text-red-600 dark:text-red-400',
};

interface ThreadHeaderBarProps {
  thread: ThreadHeader;
}

export function ThreadHeaderBar({ thread }: ThreadHeaderBarProps): React.ReactElement {
  const initials =
    thread.contactName
      ?.split(' ')
      .map((p) => p[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() ?? '??';

  return (
    <div className="flex items-center gap-3 border-b bg-card/30 px-4 py-3">
      <Link
        href="/inbox"
        className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
        aria-label="Volver al inbox"
      >
        <ArrowLeft className="h-4 w-4" />
      </Link>

      <Avatar className="h-9 w-9 shrink-0">
        {thread.contactAvatarUrl ? (
          <AvatarImage src={thread.contactAvatarUrl} alt={thread.contactName ?? ''} />
        ) : null}
        <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
      </Avatar>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">
            {thread.contactName ?? thread.contactHandle ?? 'Sin nombre'}
          </span>
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {thread.platform} · {thread.kind}
          </span>
        </div>
        <span className="truncate text-xs text-muted-foreground">
          {thread.subject ?? thread.contactHandle ?? 'Conversación'}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
            STATUS_TONE[thread.status],
          )}
        >
          {thread.status}
        </span>
        <span className={cn('text-[10px] uppercase', PRIORITY_TONE[thread.priority])}>
          {thread.priority}
        </span>
        {thread.tags.slice(0, 3).map((t) => (
          <Badge key={t} variant="muted" className="text-[10px]">
            {t}
          </Badge>
        ))}
      </div>
    </div>
  );
}
