'use client';

import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import Link from 'next/link';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils/cn';

import type { ReviewListItem } from '@/lib/reviews/queries';

import { BBBComplaintCard, PlatformExtras } from './platform-extras';
import { Stars } from './stars';

interface ReviewRowProps {
  review: ReviewListItem;
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

const STATUS_TONE: Record<ReviewListItem['status'], string> = {
  pending: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
  in_progress: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  responded: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  archived: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400',
  spam: 'bg-red-500/15 text-red-700 dark:text-red-300',
};

const STATUS_LABEL: Record<ReviewListItem['status'], string> = {
  pending: 'pendiente',
  in_progress: 'en proceso',
  responded: 'respondida',
  archived: 'archivada',
  spam: 'spam',
};

const SENTIMENT_TONE: Record<ReviewListItem['sentiment'], string> = {
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
  if (d < 30) return `${Math.round(d / 7)}sem`;
  return `${Math.round(d / 30)}mes`;
}

export function ReviewRow({ review }: ReviewRowProps): React.ReactElement {
  // BBB is structurally different (complaint, not review). Render
  // the distinct card and short-circuit the standard layout.
  // See `components/reviews/platform-extras/index.tsx`.
  if (review.platform === 'bbb') {
    return (
      <BBBComplaintCard
        data={review.platformSpecific}
        authorName={review.authorName}
        bodyExcerpt={review.bodyExcerpt}
        postedAt={review.postedAt}
        locationName={review.locationName}
        href={`/reviews/${review.id}`}
      />
    );
  }

  const initials =
    review.authorName
      ?.split(' ')
      .map((p) => p[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() ?? PLATFORM_INITIALS[review.platform] ?? '??';

  return (
    <Link
      href={`/reviews/${review.id}` as `/reviews/${string}`}
      className="flex items-start gap-3 border-b px-4 py-3 transition-colors hover:bg-accent/40"
      data-testid="review-row"
    >
      <Avatar className="h-9 w-9 shrink-0">
        {review.authorAvatar ? (
          <AvatarImage src={review.authorAvatar} alt={review.authorName ?? ''} />
        ) : null}
        <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
      </Avatar>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <Stars rating={review.rating} />
          <span className="truncate text-sm font-medium">
            {review.authorName ?? 'Anónimo'}
          </span>
          <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
            {PLATFORM_INITIALS[review.platform] ?? review.platform}
          </span>
          {review.locationName ? (
            <span className="hidden truncate text-[11px] text-muted-foreground sm:inline">
              · {review.locationName}
            </span>
          ) : null}
          <span className="ml-auto shrink-0 text-xs text-muted-foreground">
            {timeAgo(review.postedAt)}
          </span>
        </div>

        {review.bodyExcerpt ? (
          <span className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {review.bodyExcerpt}
          </span>
        ) : null}

        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
              STATUS_TONE[review.status],
            )}
          >
            {STATUS_LABEL[review.status]}
          </span>
          <span className={cn('text-[10px] capitalize', SENTIMENT_TONE[review.sentiment])}>
            {review.sentiment}
          </span>
          {review.hasPublishedResponse ? (
            <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-3 w-3" />
              respondida
            </span>
          ) : null}
          {review.escalated ? (
            <span className="inline-flex items-center gap-1 text-[10px] text-red-600 dark:text-red-400">
              <AlertTriangle className="h-3 w-3" />
              escalada
            </span>
          ) : null}
          {review.tags.slice(0, 3).map((tag) => (
            <Badge key={tag} variant="muted" className="text-[10px]">
              {tag}
            </Badge>
          ))}
          {review.assignedTo ? null : (
            <span className="text-[10px] italic text-amber-600 dark:text-amber-400">
              sin asignar
            </span>
          )}
          {!review.canReply ? (
            <span className="text-[10px] italic text-zinc-500" title="Esta plataforma no permite responder reseñas desde Blacknel">
              read-only
            </span>
          ) : null}
        </div>

        <PlatformExtras
          platform={review.platform}
          platformSpecific={review.platformSpecific}
        />
      </div>
    </Link>
  );
}
