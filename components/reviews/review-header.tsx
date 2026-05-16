import { AlertTriangle, ArrowLeft, ExternalLink } from 'lucide-react';
import Link from 'next/link';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils/cn';
import type { ReviewHeader as ReviewHeaderShape } from '@/lib/reviews/review-detail';

import { Stars } from './stars';

interface ReviewHeaderProps {
  review: ReviewHeaderShape;
}

const PLATFORM_LABEL: Record<string, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  gbp: 'Google Business Profile',
  whatsapp: 'WhatsApp',
  tiktok: 'TikTok',
  linkedin: 'LinkedIn',
  x: 'X',
  youtube: 'YouTube',
  pinterest: 'Pinterest',
  reddit: 'Reddit',
  yelp: 'Yelp',
  tripadvisor: 'TripAdvisor',
  trustpilot: 'Trustpilot',
  bbb: 'BBB',
  avvo: 'Avvo',
};

const SENTIMENT_TONE: Record<ReviewHeaderShape['sentiment'], string> = {
  positive: 'text-emerald-600 dark:text-emerald-400',
  neutral: 'text-zinc-500',
  negative: 'text-red-600 dark:text-red-400',
  unknown: 'text-zinc-400',
};

const STATUS_TONE: Record<ReviewHeaderShape['status'], string> = {
  pending: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
  in_progress: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  responded: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  archived: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400',
  spam: 'bg-red-500/15 text-red-700 dark:text-red-300',
};

export function ReviewHeader({
  review,
}: ReviewHeaderProps): React.ReactElement {
  const initials =
    review.authorName
      ?.split(' ')
      .map((p) => p[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() ?? '??';

  return (
    <header className="flex flex-col gap-4 border-b px-6 py-5">
      <div className="flex items-center gap-3">
        <Link
          href="/reviews"
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
          aria-label="Volver a la lista"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <Avatar className="h-10 w-10 shrink-0">
          {review.authorAvatar ? (
            <AvatarImage src={review.authorAvatar} alt={review.authorName ?? ''} />
          ) : null}
          <AvatarFallback className="text-[11px]">{initials}</AvatarFallback>
        </Avatar>
        <div className="flex flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <Stars rating={review.rating} size="detail" />
            <span className="text-sm font-semibold">
              {review.authorName ?? 'Anónimo'}
            </span>
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {PLATFORM_LABEL[review.platform] ?? review.platform}
            </span>
            {review.externalReviewId ? (
              <a
                href="#"
                aria-label="Abrir en plataforma origen (mock)"
                className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground"
                title="Phase-11 integrará el enlace real al origen"
              >
                origen <ExternalLink className="h-2.5 w-2.5" />
              </a>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <time dateTime={review.postedAt.toISOString()}>
              {review.postedAt.toLocaleString()}
            </time>
            {review.brandName ? <span>· {review.brandName}</span> : null}
            {review.locationName ? <span>· {review.locationName}</span> : null}
            {review.language ? (
              <span className="uppercase">· {review.language}</span>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
              STATUS_TONE[review.status],
            )}
          >
            {review.status.replace('_', ' ')}
          </span>
          <span className={cn('text-[10px] capitalize', SENTIMENT_TONE[review.sentiment])}>
            {review.sentiment}
          </span>
          {review.escalated ? (
            <span className="inline-flex items-center gap-1 text-[10px] text-red-600 dark:text-red-400">
              <AlertTriangle className="h-3 w-3" />
              escalada
            </span>
          ) : null}
        </div>
      </div>

      <blockquote className="rounded-md border bg-card/40 p-4 text-sm leading-relaxed text-foreground/90">
        {review.body}
      </blockquote>

      {review.tags.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {review.tags.map((tag) => (
            <Badge key={tag} variant="muted" className="text-[10px]">
              {tag}
            </Badge>
          ))}
        </div>
      ) : null}
    </header>
  );
}
