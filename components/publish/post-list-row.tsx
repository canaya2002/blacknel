import Link from 'next/link';
import { CalendarClock, Megaphone, Send, Tag, UserSquare2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils/cn';
import type { PostListItem } from '@/lib/publish/queries';

interface PostListRowProps {
  post: PostListItem;
  timeZone: string;
  locale: string;
}

const STATUS_BADGE: Readonly<
  Record<
    PostListItem['status'],
    { label: string; className: string }
  >
> = {
  draft: {
    label: 'Borrador',
    className: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200',
  },
  pending_approval: {
    label: 'En aprobación',
    className: 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200',
  },
  scheduled: {
    label: 'Agendado',
    className: 'bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-200',
  },
  publishing: {
    label: 'Publicando',
    className: 'bg-blue-100 text-blue-900 dark:bg-blue-950/60 dark:text-blue-100',
  },
  published: {
    label: 'Publicado',
    className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200',
  },
  failed: {
    label: 'Fallido',
    className: 'bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-200',
  },
  cancelled: {
    label: 'Cancelado',
    className: 'bg-zinc-50 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400',
  },
};

export function PostListRow({
  post,
  timeZone,
  locale,
}: PostListRowProps): React.ReactElement {
  const badge = STATUS_BADGE[post.status];
  const when = post.publishedAt ?? post.scheduledAt;
  const whenLabel = when ? formatWhen(when, timeZone, locale) : null;

  return (
    <Link
      href={`/publish/composer/${post.id}`}
      prefetch={false}
      className="flex items-start gap-3 border-b px-6 py-3 transition-colors hover:bg-muted/40"
    >
      <div className="flex flex-1 flex-col gap-1.5 overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge className={cn('border-transparent', badge.className)}>
            {badge.label}
          </Badge>
          {post.brandName ? (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <UserSquare2 className="h-3 w-3" aria-hidden />
              {post.brandName}
            </span>
          ) : null}
          {post.campaignName ? (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Megaphone className="h-3 w-3" aria-hidden />
              {post.campaignName}
            </span>
          ) : null}
          {whenLabel ? (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <CalendarClock className="h-3 w-3" aria-hidden />
              {whenLabel}
            </span>
          ) : null}
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <Send className="h-3 w-3" aria-hidden />
            {post.publishedTargetCount}/{post.targetCount} destinos
          </span>
        </div>
        <p className="line-clamp-2 text-sm text-foreground">{post.text}</p>
      </div>
      {post.authorName ? (
        <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
          <Tag className="h-3 w-3" aria-hidden />
          {post.authorName}
        </span>
      ) : null}
    </Link>
  );
}

function formatWhen(d: Date, timeZone: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}
