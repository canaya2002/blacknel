import * as React from 'react';
import { Heart, MessageCircle, Share2, ThumbsUp } from 'lucide-react';

import { cn } from '@/lib/utils/cn';

import {
  arePreviewPropsEqual,
  initialsFor,
  PLATFORM_DISPLAY,
  type PreviewComponentProps,
} from './preview-shared';

/**
 * Facebook feed-style preview. Pure functional component wrapped
 * in `React.memo` below — no `useState` / `useEffect`. Renders the
 * pre-computed `slice` from the shell as-is.
 */
function PreviewFacebookImpl({ slice }: PreviewComponentProps): React.ReactElement {
  const initials = initialsFor(slice.displayName, slice.handle);
  const display = PLATFORM_DISPLAY.facebook!;
  const firstMedia = slice.media[0];

  return (
    <article
      data-testid="preview-facebook"
      className={cn(
        'flex flex-col gap-3 rounded-lg border p-3 shadow-sm',
        display.chromeClass,
      )}
    >
      <header className="flex items-center gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700 dark:bg-blue-950/60 dark:text-blue-100">
          {initials}
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-semibold">{slice.displayName}</span>
          <span className={cn('text-[11px]', display.accentClass)}>
            {display.label} · Justo ahora
          </span>
        </div>
      </header>

      <p
        className={cn(
          'whitespace-pre-wrap text-sm leading-relaxed',
          slice.over && 'text-red-600',
        )}
      >
        {slice.body}
      </p>

      {firstMedia ? (
        <div className="overflow-hidden rounded-md border bg-muted">
          {firstMedia.kind === 'image' || firstMedia.kind === 'gif' ? (
            // eslint-disable-next-line @next/next/no-img-element -- dev provider serves local URLs
            <img
              src={firstMedia.url}
              alt={firstMedia.name}
              className="aspect-video w-full object-cover"
            />
          ) : (
            <div className="flex aspect-video w-full items-center justify-center text-xs text-muted-foreground">
              {firstMedia.kind === 'video' ? 'Video adjunto' : 'PDF adjunto'}
            </div>
          )}
        </div>
      ) : null}

      {slice.link ? (
        <div className="flex flex-col gap-0.5 rounded-md border bg-muted/40 px-3 py-2 text-[11px]">
          <span className="text-muted-foreground">{hostnameOf(slice.link)}</span>
          <span className="font-medium">{slice.link}</span>
        </div>
      ) : null}

      <footer className="flex items-center justify-between border-t pt-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <ThumbsUp className="h-3 w-3" aria-hidden />
          Me gusta
        </span>
        <span className="inline-flex items-center gap-1">
          <MessageCircle className="h-3 w-3" aria-hidden />
          Comentar
        </span>
        <span className="inline-flex items-center gap-1">
          <Share2 className="h-3 w-3" aria-hidden />
          Compartir
        </span>
        <span className="inline-flex items-center gap-1 text-pink-500">
          <Heart className="h-3 w-3" aria-hidden />
        </span>
      </footer>
    </article>
  );
}

export const PreviewFacebook = React.memo(PreviewFacebookImpl, arePreviewPropsEqual);

/**
 * Un-memoized impl exposed for the perf test — the test wraps it
 * with `React.memo(PreviewFacebookImpl, arePreviewPropsEqual)`
 * itself plus a `vi.fn()` spy to verify the cutoff. Production
 * code imports `PreviewFacebook` only.
 */
export { PreviewFacebookImpl };

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
