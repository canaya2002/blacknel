import * as React from 'react';
import { Image as ImageIcon } from 'lucide-react';

import { cn } from '@/lib/utils/cn';

import {
  arePreviewPropsEqual,
  initialsFor,
  PLATFORM_DISPLAY,
  type PreviewComponentProps,
} from './preview-shared';

/**
 * Generic placeholder preview used by platforms whose fiel layout
 * is deferred to a Commit 21 polish pass: X, LinkedIn, TikTok,
 * Pinterest, YouTube. Shows the same data the editor has — handle,
 * body, char count, attached-media indicator — without trying to
 * approximate each platform's chrome.
 *
 * Pure component — see preview-shared.tsx for the perf contract.
 */
function PreviewGenericImpl({ slice }: PreviewComponentProps): React.ReactElement {
  const display = PLATFORM_DISPLAY[slice.platform];
  const label = display?.label ?? slice.platform;
  const accent = display?.accentClass ?? 'text-foreground';
  const initials = initialsFor(slice.displayName, slice.handle);

  return (
    <article
      data-testid={`preview-generic-${slice.platform}`}
      className={cn(
        'flex flex-col gap-3 rounded-lg border bg-card p-3 shadow-sm',
      )}
    >
      <header className="flex items-center gap-2">
        <div
          className={cn(
            'flex h-9 w-9 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground',
          )}
        >
          {initials}
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-semibold">{slice.displayName}</span>
          <span className={cn('text-[11px]', accent)}>
            {label}
            {slice.handle ? ` · ${slice.handle}` : ''}
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

      {slice.media.length > 0 ? (
        <div className="inline-flex items-center gap-1.5 self-start rounded-md border bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground">
          <ImageIcon className="h-3 w-3" aria-hidden />
          {slice.media.length} archivo{slice.media.length === 1 ? '' : 's'} adjunto
          {slice.media.length === 1 ? '' : 's'}
        </div>
      ) : null}

      <footer className="flex items-center justify-between border-t pt-2 text-[10px] text-muted-foreground">
        <span>
          {slice.length}
          {slice.charLimit !== null ? ` / ${slice.charLimit}` : ''} caracteres
        </span>
        <span className="italic">Preview detallado próximamente</span>
      </footer>
    </article>
  );
}

export const PreviewGeneric = React.memo(PreviewGenericImpl, arePreviewPropsEqual);
export { PreviewGenericImpl };
