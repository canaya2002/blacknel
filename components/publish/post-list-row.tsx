import Link from 'next/link';
import { AlertTriangle, CalendarClock, Megaphone, Send, Tag, UserSquare2 } from 'lucide-react';

import { RetryButton } from '@/components/publish/retry-button';
import { Badge } from '@/components/ui/badge';
import { MAX_RETRY_COUNT } from '@/lib/jobs/constants';
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

const ERROR_PREVIEW_MAX = 80;

export function PostListRow({
  post,
  timeZone,
  locale,
}: PostListRowProps): React.ReactElement {
  const badge = STATUS_BADGE[post.status];
  const when = post.publishedAt ?? post.scheduledAt;
  const whenLabel = when ? formatWhen(when, timeZone, locale) : null;
  const isFailed = post.status === 'failed';

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
          {isFailed ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-red-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-red-700 dark:bg-red-950/40 dark:text-red-200">
              <AlertTriangle className="h-3 w-3" aria-hidden />
              intentos {post.maxRetryCount}/{MAX_RETRY_COUNT}
            </span>
          ) : null}
        </div>
        <p className="line-clamp-2 text-sm text-foreground">{post.text}</p>
        {isFailed && post.lastErrorMessage ? (
          <p className="line-clamp-1 text-[11px] text-red-700/90 dark:text-red-300/90">
            <span className="font-medium">Error:</span>{' '}
            {truncateError(post.lastErrorMessage)}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-2">
        {post.authorName ? (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Tag className="h-3 w-3" aria-hidden />
            {post.authorName}
          </span>
        ) : null}
        {isFailed ? <RetryButton postId={post.id} variant="row" /> : null}
      </div>
    </Link>
  );
}

function truncateError(s: string): string {
  if (s.length <= ERROR_PREVIEW_MAX) return s;
  return s.slice(0, ERROR_PREVIEW_MAX - 1) + '…';
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
