'use client';

import { useCallback, useState, useTransition } from 'react';
import { Loader2 } from 'lucide-react';
import { Virtuoso } from 'react-virtuoso';

import { Button } from '@/components/ui/button';
import { loadMoreThreadsAction } from '@/app/(app)/inbox/load-more-action';
import type { ThreadListItem } from '@/lib/inbox/queries';
import type { InboxFilters } from '@/lib/inbox/filters';

import { ThreadRow } from './thread-row';

interface ThreadListProps {
  initialThreads: ReadonlyArray<ThreadListItem>;
  initialNextCursor: string | null;
  filters: InboxFilters;
}

/**
 * Virtualized thread list with explicit "Cargar más" pagination.
 *
 * We render at most the current page's rows through react-virtuoso so a
 * tab full of 500+ threads stays smooth. Loading the next page is an
 * explicit click — infinite-scroll-on-scroll is UX polish for later;
 * the click avoids surprising overrides of the user's intent (and the
 * occasional rage when they jumped to the bottom for a reason).
 *
 * Local state owns the accumulated `threads` array; the URL still
 * carries the *first* page's filters, so reloading clears the
 * accumulated tail — that's a property, not a bug. Loading a fresh
 * cursor URL deep-links to a continuation; the load-more button keeps
 * the URL untouched so back-button behavior stays predictable.
 */
export function ThreadList({
  initialThreads,
  initialNextCursor,
  filters,
}: ThreadListProps): React.ReactElement {
  const [threads, setThreads] = useState<ReadonlyArray<ThreadListItem>>(initialThreads);
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor);
  const [pending, startTransition] = useTransition();

  const loadMore = useCallback(() => {
    if (!nextCursor || pending) return;
    startTransition(async () => {
      const result = await loadMoreThreadsAction({
        cursor: nextCursor,
        filters,
      });
      if (result.ok) {
        setThreads((prev) => [...prev, ...result.data.threads]);
        setNextCursor(result.data.nextCursor);
      }
    });
  }, [nextCursor, pending, filters]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-hidden">
        <Virtuoso
          data={threads as ThreadListItem[]}
          itemContent={(_, thread) => <ThreadRow key={thread.id} thread={thread} />}
          increaseViewportBy={200}
          components={{
            // Footer renders the load-more affordance inside the
            // virtualized scroll container so it pins at the bottom.
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
                  Mostrando {threads.length} thread{threads.length === 1 ? '' : 's'}.
                </div>
              ),
          }}
        />
      </div>
    </div>
  );
}
