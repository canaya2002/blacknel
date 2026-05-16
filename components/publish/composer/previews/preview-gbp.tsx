import * as React from 'react';
import { ChevronRight, MapPin } from 'lucide-react';

import { cn } from '@/lib/utils/cn';

import {
  arePreviewPropsEqual,
  PLATFORM_DISPLAY,
  type PreviewComponentProps,
} from './preview-shared';

/**
 * Google Business Profile "local post" preview. Different shape
 * from social feeds: it's a card embedded in Search / Maps with
 * the business name, a short body, an optional image, and a CTA
 * row. Pure component — see preview-shared.tsx for the perf
 * contract.
 */
function PreviewGBPImpl({ slice }: PreviewComponentProps): React.ReactElement {
  const display = PLATFORM_DISPLAY.gbp!;
  const firstMedia = slice.media[0];

  return (
    <article
      data-testid="preview-gbp"
      className={cn(
        'flex flex-col gap-2 rounded-lg border p-3 shadow-sm',
        display.chromeClass,
      )}
    >
      <header className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold">
          <MapPin className={cn('h-3.5 w-3.5', display.accentClass)} aria-hidden />
          {slice.displayName}
        </span>
        <span className={cn('text-[10px]', display.accentClass)}>{display.label}</span>
      </header>

      {firstMedia ? (
        <div className="overflow-hidden rounded-md border bg-muted">
          {firstMedia.kind === 'image' || firstMedia.kind === 'gif' ? (
            // eslint-disable-next-line @next/next/no-img-element -- dev provider serves local URLs
            <img
              src={firstMedia.url}
              alt={firstMedia.name}
              className="aspect-[16/10] w-full object-cover"
            />
          ) : (
            <div className="flex aspect-[16/10] w-full items-center justify-center text-xs text-muted-foreground">
              {firstMedia.kind === 'video' ? 'Video adjunto' : 'PDF adjunto'}
            </div>
          )}
        </div>
      ) : null}

      <p
        className={cn(
          'whitespace-pre-wrap text-xs leading-relaxed',
          slice.over && 'text-red-600',
        )}
      >
        {slice.body}
      </p>

      {slice.link ? (
        <a
          href={slice.link}
          className="inline-flex items-center gap-1 self-start text-[11px] font-medium text-emerald-700 hover:underline dark:text-emerald-300"
          rel="noreferrer"
        >
          Más información
          <ChevronRight className="h-3 w-3" aria-hidden />
        </a>
      ) : null}

      <footer className="mt-1 border-t pt-1 text-[10px] text-muted-foreground">
        Publicación local · expira en 7 días
      </footer>
    </article>
  );
}

export const PreviewGBP = React.memo(PreviewGBPImpl, arePreviewPropsEqual);
export { PreviewGBPImpl };
