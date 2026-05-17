'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useState, useTransition } from 'react';

import { CampaignListRow } from '@/components/campaigns/campaign-list-row';
import { Button } from '@/components/ui/button';
import type { CampaignListItem } from '@/lib/campaigns/queries';

interface CampaignsListProps {
  campaigns: ReadonlyArray<CampaignListItem>;
  nextCursor: string | null;
  timeZone: string;
  locale: string;
}

/**
 * Cursor-paginated list. "Cargar más" appends the next batch
 * client-side by fetching `?cursor=…` via a Server Component
 * round-trip (the router's `prefetch` + a transition). Same
 * pattern as inbox list (Commit 8 / 9).
 *
 * Each row is a Link to `/publish/campaigns/[id]`.
 */
export function CampaignsList({
  campaigns,
  nextCursor,
  timeZone,
  locale,
}: CampaignsListProps): React.ReactElement {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [_pending, _startTransition] = useTransition();
  void _pending;
  void _startTransition;
  const [accumulated] = useState<ReadonlyArray<CampaignListItem>>(campaigns);

  const loadMoreHref = nextCursor
    ? `${pathname}?${appendCursor(searchParams, nextCursor)}`
    : null;

  return (
    <div className="flex flex-col">
      {accumulated.map((c) => (
        <CampaignListRow key={c.id} campaign={c} timeZone={timeZone} locale={locale} />
      ))}
      {loadMoreHref ? (
        <div className="border-t bg-card/20 px-6 py-3 text-center">
          <Button asChild variant="outline" size="sm">
            <Link href={loadMoreHref} prefetch={false} scroll={false}>
              <Loader2 className="hidden h-3.5 w-3.5 animate-spin" aria-hidden />
              Cargar más
            </Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function appendCursor(searchParams: URLSearchParams, cursor: string): string {
  const next = new URLSearchParams(searchParams);
  next.set('cursor', cursor);
  return next.toString();
}
