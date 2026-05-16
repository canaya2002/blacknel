'use client';

import { Loader2 } from 'lucide-react';
import { useCallback, useState, useTransition } from 'react';
import { Virtuoso } from 'react-virtuoso';

import { loadMoreApprovalsAction } from '@/app/(app)/approvals/load-more-action';
import { Button } from '@/components/ui/button';
import type { ApprovalFilters } from '@/lib/approvals/filters';
import type { ApprovalListItem } from '@/lib/approvals/queries';

import { ApprovalRow } from './approval-row';

interface ApprovalsListProps {
  initialApprovals: ReadonlyArray<ApprovalListItem>;
  initialNextCursor: string | null;
  filters: ApprovalFilters;
}

export function ApprovalsList({
  initialApprovals,
  initialNextCursor,
  filters,
}: ApprovalsListProps): React.ReactElement {
  const [items, setItems] = useState<ReadonlyArray<ApprovalListItem>>(initialApprovals);
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor);
  const [pending, startTransition] = useTransition();

  const loadMore = useCallback(() => {
    if (!nextCursor || pending) return;
    startTransition(async () => {
      const result = await loadMoreApprovalsAction({ cursor: nextCursor, filters });
      if (result.ok) {
        setItems((prev) => [...prev, ...result.data.approvals]);
        setNextCursor(result.data.nextCursor);
      }
    });
  }, [filters, nextCursor, pending]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-hidden">
        <Virtuoso
          data={items as ApprovalListItem[]}
          itemContent={(_, approval) => <ApprovalRow key={approval.id} approval={approval} />}
          increaseViewportBy={200}
          components={{
            Footer: () =>
              nextCursor ? (
                <div className="flex justify-center px-4 py-3">
                  <Button variant="outline" size="sm" onClick={loadMore} disabled={pending}>
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
                  Mostrando {items.length} aprobaci{items.length === 1 ? 'ón' : 'ones'}.
                </div>
              ),
          }}
        />
      </div>
    </div>
  );
}
