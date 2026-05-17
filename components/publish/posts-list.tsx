'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useTransition } from 'react';
import { Virtuoso } from 'react-virtuoso';

import { Button } from '@/components/ui/button';
import type { PostListItem } from '@/lib/publish/queries';

import { PostListRow } from './post-list-row';

interface PostsListProps {
  posts: ReadonlyArray<PostListItem>;
  timeZone: string;
  locale: string;
  /**
   * Encoded cursor for the next page, or null when this is the last
   * page. Drives the "Cargar más" footer; clicking it appends
   * `?cursor=…` to the current URL — the Server Component reloads
   * with the next batch (Commit 21 — real pagination).
   */
  nextCursor: string | null;
}

/**
 * Virtualized list used by the named tabs (drafts / scheduled /
 * published / failed). react-virtuoso keeps rendering cheap even
 * with 500+ rows.
 *
 * Cursor pagination: each click on "Cargar más" navigates to
 * `?cursor=<encoded>`. The Server Component re-runs with the new
 * cursor; the URL stays in sync so a bookmark resumes mid-list.
 */
export function PostsList({
  posts,
  timeZone,
  locale,
  nextCursor,
}: PostsListProps): React.ReactElement {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  void startTransition;

  const loadMoreHref = nextCursor
    ? `${pathname}?${appendCursor(searchParams, nextCursor)}`
    : null;

  return (
    <div
      data-testid="publish-posts-list"
      className="flex flex-col"
      style={{ height: 'calc(100vh - 22rem)' }}
    >
      <Virtuoso
        data={posts as PostListItem[]}
        itemContent={(_index, post) => (
          <PostListRow post={post} timeZone={timeZone} locale={locale} />
        )}
        components={{
          Footer: loadMoreHref
            ? () => (
                <div className="border-t bg-card/20 px-6 py-3 text-center">
                  <Button asChild variant="outline" size="sm">
                    <Link href={loadMoreHref} prefetch={false} scroll={false}>
                      {pending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                      ) : null}
                      Cargar más
                    </Link>
                  </Button>
                </div>
              )
            : undefined,
        }}
      />
    </div>
  );
}

function appendCursor(searchParams: URLSearchParams, cursor: string): string {
  const next = new URLSearchParams(searchParams);
  next.set('cursor', cursor);
  return next.toString();
}
