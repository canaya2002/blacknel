import * as React from 'react';
import { MessageSquare, Repeat2, Send, ThumbsUp } from 'lucide-react';

import { cn } from '@/lib/utils/cn';

import {
  arePreviewPropsEqual,
  initialsFor,
  PLATFORM_DISPLAY,
  type PreviewComponentProps,
} from './preview-shared';

/**
 * LinkedIn feed-style preview (Commit 21). LinkedIn-fidelity chrome:
 *
 *   - Square avatar with rounded corners (LinkedIn uses square,
 *     not circular — distinguishes from Facebook).
 *   - "Posted via Blacknel · 1m · 🌐" meta line.
 *   - Body in serif-leaning typography. LinkedIn caps posts at 3000
 *     chars; truncation logic lives upstream in `truncateBody`.
 *   - Link card with hostname uppercase + bold title (LinkedIn unfurls).
 *   - Image: single image fills width; 2+ images render a 2x2 grid
 *     with the 4th cell showing "+N" when there are more.
 *   - Footer: Like / Comment / Repost / Send (LinkedIn's 4 actions).
 *
 * Same React.memo + arePreviewPropsEqual contract as facebook /
 * instagram / gbp — re-render only when relevant props change.
 *
 * The other 4 platforms in `PLATFORM_DISPLAY` (X, TikTok, Pinterest,
 * YouTube) keep using `<PreviewGeneric />` until Phase 12 / connector
 * cutover; LinkedIn validates the "swap one preview without touching
 * `preview-shell.tsx` dispatch" contract.
 */
function PreviewLinkedInImpl({ slice }: PreviewComponentProps): React.ReactElement {
  const initials = initialsFor(slice.displayName, slice.handle);
  const display = PLATFORM_DISPLAY.linkedin!;
  const mediaCount = slice.media.length;
  const visibleMedia = slice.media.slice(0, 4);
  const overflow = mediaCount > 4 ? mediaCount - 4 : 0;

  return (
    <article
      data-testid="preview-linkedin"
      className={cn(
        'flex flex-col gap-3 rounded-lg border p-3 shadow-sm',
        display.chromeClass,
      )}
    >
      <header className="flex items-start gap-2">
        {/* LinkedIn avatar is square w/ rounded corners. */}
        <div className="flex h-10 w-10 items-center justify-center rounded bg-sky-100 text-xs font-semibold text-sky-700 dark:bg-sky-950/60 dark:text-sky-100">
          {initials}
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-semibold leading-tight">{slice.displayName}</span>
          {slice.handle ? (
            <span className="text-[11px] text-muted-foreground">
              {slice.handle}
            </span>
          ) : null}
          <span className={cn('text-[11px]', display.accentClass)}>
            {display.label} · Justo ahora · 🌐
          </span>
        </div>
      </header>

      <p
        className={cn(
          'whitespace-pre-wrap text-[13px] leading-relaxed',
          slice.over && 'text-red-600',
        )}
      >
        {slice.body}
      </p>

      {visibleMedia.length > 0 ? (
        <div
          className={cn(
            'overflow-hidden rounded-md border bg-muted',
            visibleMedia.length === 1 ? '' : 'grid grid-cols-2 gap-0.5',
          )}
        >
          {visibleMedia.map((m, idx) => {
            const isLastSlot = idx === visibleMedia.length - 1;
            const showOverlay = overflow > 0 && isLastSlot;
            return (
              <div key={m.url + idx} className="relative aspect-video bg-muted">
                {m.kind === 'image' || m.kind === 'gif' ? (
                  // eslint-disable-next-line @next/next/no-img-element -- dev provider serves local URLs
                  <img
                    src={m.url}
                    alt={m.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                    {m.kind === 'video' ? 'Video adjunto' : 'PDF adjunto'}
                  </div>
                )}
                {showOverlay ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-base font-semibold text-white">
                    +{overflow}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {slice.link ? (
        <div className="flex flex-col gap-0.5 rounded-md border bg-muted/40 px-3 py-2 text-[11px]">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {hostnameOf(slice.link)}
          </span>
          <span className="line-clamp-1 font-semibold">{slice.link}</span>
        </div>
      ) : null}

      <footer className="flex items-center justify-between border-t pt-2 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <ThumbsUp className="h-3 w-3" aria-hidden />
          Recomendar
        </span>
        <span className="inline-flex items-center gap-1">
          <MessageCircle className="h-3 w-3" aria-hidden />
        </span>
        <span className="inline-flex items-center gap-1">
          <Repeat2 className="h-3 w-3" aria-hidden />
          Republicar
        </span>
        <span className="inline-flex items-center gap-1">
          <Send className="h-3 w-3" aria-hidden />
          Enviar
        </span>
      </footer>
    </article>
  );
}

function MessageCircle(props: React.SVGProps<SVGSVGElement>): React.ReactElement {
  return <MessageSquare {...props} />;
}

export const PreviewLinkedIn = React.memo(PreviewLinkedInImpl, arePreviewPropsEqual);

/** Un-memoized impl for the perf-cutoff test. */
export { PreviewLinkedInImpl };

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
