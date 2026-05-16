'use client';

import { useCallback, useState, useTransition } from 'react';
import { Loader2 } from 'lucide-react';
import { Virtuoso } from 'react-virtuoso';

import { Button } from '@/components/ui/button';
import { loadMoreReviewsAction } from '@/app/(app)/reviews/load-more-action';
import type { ReviewListItem } from '@/lib/reviews/queries';
import type { ReviewFilters } from '@/lib/reviews/filters';

import { ReviewRow } from './review-row';

interface ReviewsListProps {
  initialReviews: ReadonlyArray<ReviewListItem>;
  initialNextCursor: string | null;
  filters: ReviewFilters;
}

/**
 * Virtualized reviews list with an explicit "Cargar más" affordance —
 * same shape and trade-offs as `<ThreadList>` (Commit 8). The first
 * page is rendered by the server component; subsequent pages come from
 * `loadMoreReviewsAction` and accumulate in local state.
 *
 * Polish that we explicitly defer to Phase 12 (carried from the inbox
 * TODO #5 — "polling-scroll-and-url-state"): when the user navigates
 * back to /reviews after opening a review, the accumulated tail is
 * lost. The first-page URL preserves the filters, the load-more state
 * does not, by design — back-button behavior would otherwise change
 * unexpectedly.
 */
export function ReviewsList({
  initialReviews,
  initialNextCursor,
  filters,
}: ReviewsListProps): React.ReactElement {
  const [items, setItems] = useState<ReadonlyArray<ReviewListItem>>(initialReviews);
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor);
  const [pending, startTransition] = useTransition();

  const loadMore = useCallback(() => {
    if (!nextCursor || pending) return;
    startTransition(async () => {
      const result = await loadMoreReviewsAction({
        cursor: nextCursor,
        filters,
      });
      if (result.ok) {
        setItems((prev) => [...prev, ...result.data.reviews]);
        setNextCursor(result.data.nextCursor);
      }
    });
  }, [nextCursor, pending, filters]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-hidden">
        <Virtuoso
          data={items as ReviewListItem[]}
          itemContent={(_, review) => <ReviewRow key={review.id} review={review} />}
          increaseViewportBy={200}
          components={{
            Footer: () =>
              nextCursor ? (
                <div className="flex justify-center px-4 py-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={loadMore}
                    disabled={pending}
                  >
                    {pending ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Cargando…
                      </>
                    ) : (
                      'Cargar más'
                    )}
                  </Button>
                </div>
              ) : (
                <div className="px-4 py-3 text-center text-[11px] text-muted-foreground">
                  Mostrando {items.length} reseña{items.length === 1 ? '' : 's'}.
                </div>
              ),
          }}
        />
      </div>
    </div>
  );
}
