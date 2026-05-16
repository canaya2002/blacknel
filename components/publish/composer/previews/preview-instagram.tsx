import * as React from 'react';
import { Bookmark, Heart, MessageCircle, Send } from 'lucide-react';

import { cn } from '@/lib/utils/cn';

import {
  arePreviewPropsEqual,
  initialsFor,
  PLATFORM_DISPLAY,
  type PreviewComponentProps,
} from './preview-shared';

/**
 * Instagram feed-style preview. Square media on top, username +
 * action row, then the caption with the same body the editor
 * shows. Pure component — see preview-shared.tsx for the perf
 * contract.
 */
function PreviewInstagramImpl({ slice }: PreviewComponentProps): React.ReactElement {
  const initials = initialsFor(slice.displayName, slice.handle);
  const display = PLATFORM_DISPLAY.instagram!;
  const handle = slice.handle ?? slice.displayName.toLowerCase().replace(/\s+/g, '');
  const firstMedia = slice.media[0];

  return (
    <article
      data-testid="preview-instagram"
      className={cn(
        'flex flex-col rounded-lg border shadow-sm',
        display.chromeClass,
      )}
    >
      <header className="flex items-center gap-2 border-b px-3 py-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-pink-400 via-rose-500 to-amber-500 text-[10px] font-semibold text-white">
          {initials}
        </div>
        <span className="text-sm font-semibold">{handle.replace(/^@/, '')}</span>
        <span className={cn('ml-auto text-[10px]', display.accentClass)}>
          {display.label}
        </span>
      </header>

      <div className="bg-muted">
        {firstMedia ? (
          firstMedia.kind === 'image' || firstMedia.kind === 'gif' ? (
            // eslint-disable-next-line @next/next/no-img-element -- dev provider serves local URLs
            <img
              src={firstMedia.url}
              alt={firstMedia.name}
              className="aspect-square w-full object-cover"
            />
          ) : (
            <div className="flex aspect-square w-full items-center justify-center text-xs text-muted-foreground">
              {firstMedia.kind === 'video' ? 'Video adjunto' : 'PDF adjunto'}
            </div>
          )
        ) : (
          <div className="flex aspect-square w-full items-center justify-center text-[11px] text-muted-foreground">
            Sin imagen — Instagram requiere media
          </div>
        )}
      </div>

      <div className="flex items-center justify-between px-3 py-1.5">
        <div className="flex items-center gap-3 text-zinc-800 dark:text-zinc-200">
          <Heart className="h-5 w-5" aria-hidden />
          <MessageCircle className="h-5 w-5" aria-hidden />
          <Send className="h-5 w-5" aria-hidden />
        </div>
        <Bookmark className="h-5 w-5 text-zinc-800 dark:text-zinc-200" aria-hidden />
      </div>

      <p
        className={cn(
          'whitespace-pre-wrap px-3 pb-3 text-[13px] leading-relaxed',
          slice.over && 'text-red-600',
        )}
      >
        <span className="mr-1 font-semibold">{handle.replace(/^@/, '')}</span>
        {slice.body}
      </p>
    </article>
  );
}

export const PreviewInstagram = React.memo(PreviewInstagramImpl, arePreviewPropsEqual);
export { PreviewInstagramImpl };
