'use client';

import { Loader2, RefreshCcw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { retryFailedPostAction } from '@/app/(app)/publish/actions';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';

/**
 * Manual retry trigger for a `failed` post (Commit 20b).
 *
 * Calls `retryFailedPostAction` (Commit 20a), which:
 *
 *   - resets every failed target to `pending` (retry_count=0,
 *     next_retry_at=null, error_message=null);
 *   - transitions the post to `'scheduled'` (if scheduled_at is
 *     still in the future) or `'publishing'` (so the next cron
 *     tick / Set B picks it up immediately via the C20b-extended
 *     selector).
 *
 * The button has two visual variants:
 *
 *   - `'row'` — compact, used on `<PostListRow />` so the user
 *     can retry without opening the composer. Stops link
 *     propagation so the click doesn't navigate.
 *
 *   - `'banner'` — full-width style for the composer's
 *     `<FailedPostBanner />`.
 */

interface RetryButtonProps {
  postId: string;
  variant?: 'row' | 'banner';
}

export function RetryButton({
  postId,
  variant = 'row',
}: RetryButtonProps): React.ReactElement {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onClick = (e: React.MouseEvent<HTMLButtonElement>): void => {
    // The PostListRow wraps the button inside a Link — without
    // these the click both retries AND navigates, which is
    // confusing UX (the user lands on a stale composer route).
    e.preventDefault();
    e.stopPropagation();
    setError(null);
    startTransition(async () => {
      const result = await retryFailedPostAction(null, { postId });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        onClick={onClick}
        disabled={pending}
        size={variant === 'banner' ? 'sm' : 'sm'}
        variant={variant === 'banner' ? 'default' : 'outline'}
        className={cn(variant === 'row' && 'h-7 px-2 text-xs')}
        data-testid="retry-failed-post"
      >
        {pending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        ) : (
          <RefreshCcw className="h-3.5 w-3.5" aria-hidden />
        )}
        {variant === 'banner' ? 'Reintentar' : 'Reintentar'}
      </Button>
      {error ? (
        <span className="text-xs text-destructive">{error}</span>
      ) : null}
    </div>
  );
}
